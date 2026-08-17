import {
  CallIdSchema,
  type ContractErrorData,
  LOOP_STEP_BUDGET,
  LoopStepLimitExceededError,
  MessageIdSchema,
  ToolNameSchema,
} from "@agentic-chat/contracts"
import {
  completeSimpleLoopRun,
  consumeSimpleLoopStep,
  type DatabaseClient,
  persistSimpleLoopSkill,
  persistSimpleLoopToolOutcome,
  readSimpleLoopRun,
} from "@agentic-chat/db"
import type { ToolRegistry } from "@agentic-chat/tools"
import { isStepCount, ToolLoopAgent } from "ai"
import { z } from "zod"

import type { Clock, IdGenerator } from "../application/dependencies.js"
import type { ModelProvider } from "../provider/contracts.js"
import { prepareAdminGuidance } from "./admin-guidance.js"
import { type SimpleLoopContext, SimpleLoopContextSchema } from "./context.js"
import { type DurableWaitConfiguration, persistDeferredCall } from "./durable-waits.js"
import { toContractError, userExplanation } from "./errors.js"
import { createProviderLanguageModel } from "./provider-model.js"
import { persistMappedToolFailure } from "./runtime-failure.js"
import { claimSimpleLoopSession, mutationIdentity, toModelMessages } from "./runtime-session.js"
import { contextValue, mapAgentFailure, typedContext } from "./runtime-support.js"
import { createSimpleLoopTools, hashToolArguments } from "./tools.js"
import { resolveDeferredCall, waitIsReady } from "./wait-resolution.js"

const executeInputSchema = z
  .object({
    runId: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    durationSeconds: z.number().int().positive().max(3600),
  })
  .strict()

type TerminalResult = {
  readonly runId: string
  readonly status: "completed" | "failed"
  readonly text: string
  readonly consumedSteps: number
  readonly error?: ContractErrorData
}

type WaitingResult = {
  readonly runId: string
  readonly status: "waiting_for_tool" | "waiting_for_admin" | "waiting_for_user"
  readonly consumedSteps: number
  readonly wait: { readonly callId?: string; readonly jobId?: string; readonly approvalId?: string }
}

export type SimpleLoopResult = TerminalResult | WaitingResult

export type SimpleLoopDependencies = {
  readonly database: DatabaseClient
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly provider: ModelProvider
  readonly tools: ToolRegistry
  readonly timeoutMs: number
  readonly durableWaits?: DurableWaitConfiguration
}

const pendingResult = (
  runId: string,
  consumedSteps: number,
  wait: NonNullable<SimpleLoopContext["wait"]>,
): WaitingResult => {
  switch (wait.kind) {
    case "report":
      return {
        runId,
        status: "waiting_for_tool",
        consumedSteps,
        wait: { callId: wait.callId, jobId: wait.jobId },
      }
    case "approval":
      return {
        runId,
        status: "waiting_for_admin",
        consumedSteps,
        wait: { callId: wait.callId, approvalId: wait.approvalId },
      }
    case "user":
      return { runId, status: "waiting_for_user", consumedSteps, wait: {} }
    default: {
      const exhaustiveWait: never = wait
      return exhaustiveWait
    }
  }
}

export const createSimpleLoopRuntime = (dependencies: SimpleLoopDependencies) => ({
  execute: async (input: unknown): Promise<SimpleLoopResult> => {
    const parsed = executeInputSchema.parse(input)
    const beforeClaim = await readSimpleLoopRun(dependencies.database, parsed.runId)
    const parsedContext = SimpleLoopContextSchema.safeParse(beforeClaim?.continuation)
    if (beforeClaim && parsedContext?.success && parsedContext.data.wait !== undefined) {
      const ready =
        parsedContext.data.wait.kind === "user"
          ? beforeClaim.status === "running"
          : await waitIsReady(dependencies, parsed.runId, parsedContext.data.wait)
      if (!ready)
        return pendingResult(parsed.runId, beforeClaim.consumedSteps, parsedContext.data.wait)
    }
    const { run, state, active } = await claimSimpleLoopSession(dependencies, parsed)
    const lastMessage = state.messages.at(-1)
    if (
      state.wait?.kind === "user" &&
      (lastMessage?.role !== "user" || lastMessage.content !== run.userMessage)
    ) {
      state.messages = [...state.messages, { role: "user", content: run.userMessage }]
    }
    await resolveDeferredCall(dependencies, active, state)
    const mutation = () => mutationIdentity(active, state)
    const tools = createSimpleLoopTools(dependencies.tools, state, {
      loadSkill: async (skillInput) => {
        const loaded = dependencies.tools.loadSkill(skillInput)
        if (!loaded.ok) return loaded.error
        state.selectedSkill = loaded.skill
        const persisted = await persistSimpleLoopSkill(dependencies.database, {
          ...mutation(),
          eventId: active.ids.next("event"),
          correlationId: active.ids.next("correlation"),
          skill: loaded.skill,
          context: contextValue(state),
        })
        state.version = persisted.version
        return loaded.skill
      },
      persistTool: async (toolInput) => {
        const persisted = await persistSimpleLoopToolOutcome(dependencies.database, {
          ...mutation(),
          eventId: active.ids.next("event"),
          terminalEventId: active.ids.next("event"),
          correlationId: active.ids.next("correlation"),
          callId: CallIdSchema.parse(toolInput.callId),
          toolName: ToolNameSchema.parse(toolInput.toolName),
          arguments: z.json().parse(toolInput.arguments),
          argumentsHash: hashToolArguments(toolInput.arguments),
          context: contextValue(state),
          outcome: toolInput.outcome,
        })
        state.version = persisted.version
      },
    })
    const model = createProviderLanguageModel(
      dependencies.provider,
      {
        beforeGenerate: async (messages) => {
          const prepared = await prepareAdminGuidance(dependencies, state, active.runId, messages)
          const persisted = await consumeSimpleLoopStep(dependencies.database, {
            ...mutation(),
            eventId: active.ids.next("event"),
            correlationId: active.ids.next("correlation"),
            context: z.json().parse(
              SimpleLoopContextSchema.parse({
                ...typedContext(state),
                consumedSteps: state.consumedSteps + 1,
              }),
            ),
          })
          state.version = persisted.version
          state.consumedSteps = persisted.consumedSteps
          return prepared
        },
        afterGenerate: () => {
          state.guidanceCommandId = undefined
        },
      },
      dependencies.timeoutMs,
    )
    const remainingSteps = LOOP_STEP_BUDGET - state.consumedSteps
    const agent = new ToolLoopAgent({
      model,
      tools,
      stopWhen: isStepCount(remainingSteps),
      maxRetries: 0,
      timeout: { totalMs: dependencies.timeoutMs, stepMs: dependencies.timeoutMs },
      prepareStep: () => ({
        activeTools:
          state.selectedSkill === undefined
            ? (["skill.load"] as const)
            : state.selectedSkill.allowedTools,
      }),
    })

    let generatedText = ""
    let terminalError: ContractErrorData | undefined
    try {
      const result = await agent.generate({ messages: toModelMessages(state.messages) })
      const deferred = result.toolCalls.find(
        (call) =>
          call.toolName === "report.generate" || call.toolName === "notification.send_email",
      )
      if (deferred !== undefined) {
        const waiting = await persistDeferredCall(dependencies, active, state, deferred)
        if (waiting !== undefined) {
          return {
            runId: active.runId,
            consumedSteps: state.consumedSteps,
            wait: waiting,
            status: waiting.status,
          }
        }
      }
      generatedText = result.text
      if (state.fatalError !== undefined) terminalError = state.fatalError
      if (
        terminalError === undefined &&
        state.consumedSteps >= LOOP_STEP_BUDGET &&
        result.finishReason === "tool-calls"
      ) {
        terminalError = toContractError(new LoopStepLimitExceededError(LOOP_STEP_BUDGET))
      }
    } catch (caught) {
      if (!(caught instanceof Error)) throw caught
      const mapped = mapAgentFailure(caught, state.selectedSkill)
      terminalError = state.fatalError ?? mapped.error
      await persistMappedToolFailure(dependencies, active, state, mapped)
    }
    const status = terminalError === undefined ? "completed" : "failed"
    const text = terminalError === undefined ? generatedText : userExplanation(terminalError)
    const completed = await completeSimpleLoopRun(dependencies.database, {
      ...mutation(),
      messageEvent: {
        eventId: active.ids.next("event"),
        correlationId: active.ids.next("correlation"),
      },
      statusEvent: {
        eventId: active.ids.next("event"),
        correlationId: active.ids.next("correlation"),
      },
      messageId: MessageIdSchema.parse(active.ids.next("message")),
      text,
      status,
      context: contextValue(state),
    })
    state.version = completed.version
    return {
      runId: active.runId,
      status,
      text,
      consumedSteps: state.consumedSteps,
      ...(terminalError === undefined ? {} : { error: terminalError }),
    }
  },
})

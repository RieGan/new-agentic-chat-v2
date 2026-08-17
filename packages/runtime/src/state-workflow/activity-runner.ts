import {
  type ContractErrorData,
  LOOP_STEP_BUDGET,
  LoopStepLimitExceededError,
  MessageIdSchema,
  ToolNameSchema,
} from "@agentic-chat/contracts"
import {
  completeStateWorkflowRun,
  consumeStateWorkflowStep,
  persistStateWorkflowToolOutcome,
  readStateWorkflowRun,
} from "@agentic-chat/db"
import { isStepCount, ToolLoopAgent } from "ai"
import { userExplanation } from "../simple-loop/errors.js"
import { createProviderLanguageModel } from "../simple-loop/provider-model.js"
import { toModelMessages } from "../simple-loop/runtime-session.js"
import { mapAgentFailure } from "../simple-loop/runtime-support.js"
import { hashToolArguments } from "../simple-loop/tools.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import { prepareStateWorkflowAdminGuidance } from "./activity-guidance.js"
import {
  restoreStateWorkflowState,
  stableActivityId,
  stateWorkflowContextValue,
} from "./activity-support.js"
import { createStateWorkflowTools } from "./activity-tools.js"
import { canonicalWaitDirective, persistStateWorkflowDeferredCall } from "./activity-waits.js"
import type { AdvanceRunActivityInput, WorkflowDirective } from "./contracts.js"

export const runStateWorkflowActivity = async (
  dependencies: StateWorkflowActivityDependencies,
  input: AdvanceRunActivityInput,
): Promise<WorkflowDirective> => {
  const run = await readStateWorkflowRun(dependencies.database, input.runId)
  if (
    run === null ||
    run.workflowIdentity !== input.workflowId ||
    run.runtime !== "state_workflow"
  ) {
    return { kind: "fail" }
  }
  if (run.status === "completed") return { kind: "complete" }
  if (run.status === "failed") return { kind: "fail" }

  const state = restoreStateWorkflowState(run)
  const pending = canonicalWaitDirective(state)
  if (pending !== undefined && run.status !== "running") return pending
  const mutation = () => ({
    runId: input.runId,
    workflowId: input.workflowId,
    expectedVersion: state.version,
    occurredAt: dependencies.clock.now(),
  })
  const tools = createStateWorkflowTools(dependencies, input, state, mutation)
  const model = createProviderLanguageModel(
    dependencies.provider,
    {
      beforeGenerate: async (messages) => {
        const prepared = await prepareStateWorkflowAdminGuidance(
          dependencies,
          input,
          state,
          messages,
        )
        const nextStep = state.consumedSteps + 1
        const persisted = await consumeStateWorkflowStep(dependencies.database, {
          ...mutation(),
          eventId: stableActivityId("event", `${input.idempotencyKey}/step/${nextStep}`),
          correlationId: stableActivityId(
            "correlation",
            `${input.idempotencyKey}/step/${nextStep}`,
          ),
          context: stateWorkflowContextValue({ ...state, consumedSteps: nextStep }),
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
  const agent = new ToolLoopAgent({
    model,
    tools,
    stopWhen: isStepCount(LOOP_STEP_BUDGET - state.consumedSteps),
    maxRetries: 0,
    timeout: { totalMs: dependencies.timeoutMs, stepMs: dependencies.timeoutMs },
    prepareStep: () => ({
      activeTools:
        state.selectedSkill === undefined
          ? (["skill.load"] as const)
          : state.selectedSkill.allowedTools,
    }),
  })

  let text = ""
  let terminalError: ContractErrorData | undefined
  try {
    const result = await agent.generate({ messages: toModelMessages(state.messages) })
    const deferred = result.toolCalls.find(
      (call) => call.toolName === "report.generate" || call.toolName === "notification.send_email",
    )
    if (deferred !== undefined) {
      const waiting = await persistStateWorkflowDeferredCall(dependencies, input, state, deferred)
      if (waiting !== undefined) return waiting
    }
    text = result.text
    terminalError = state.fatalError
    if (
      terminalError === undefined &&
      state.consumedSteps >= LOOP_STEP_BUDGET &&
      result.finishReason === "tool-calls"
    ) {
      terminalError = {
        code: "LOOP_STEP_LIMIT_EXCEEDED",
        message: new LoopStepLimitExceededError(LOOP_STEP_BUDGET).message,
        limit: LOOP_STEP_BUDGET,
      }
    }
  } catch (caught) {
    if (!(caught instanceof Error)) throw caught
    const mapped = mapAgentFailure(caught, state.selectedSkill)
    terminalError = state.fatalError ?? mapped.error
    state.fatalError = terminalError
    if (mapped.toolName !== undefined && mapped.toolName !== "skill.load") {
      const callId = stableActivityId(
        "call",
        `${input.idempotencyKey}/failure/${state.consumedSteps}/${mapped.toolName}`,
      )
      const status = mapped.error.code === "TOOL_NOT_ALLOWED" ? "rejected" : "failed"
      const persisted = await persistStateWorkflowToolOutcome(dependencies.database, {
        ...mutation(),
        eventId: stableActivityId("event", `${input.idempotencyKey}/failure/${callId}/start`),
        terminalEventId: stableActivityId(
          "event",
          `${input.idempotencyKey}/failure/${callId}/terminal`,
        ),
        correlationId: stableActivityId("correlation", `${input.idempotencyKey}/failure/${callId}`),
        callId,
        toolName: ToolNameSchema.parse(mapped.toolName),
        arguments: {},
        argumentsHash: hashToolArguments({}),
        context: stateWorkflowContextValue(state),
        outcome: { status, error: mapped.error },
      })
      state.version = persisted.version
    }
  }
  const status = terminalError === undefined ? "completed" : "failed"
  const finalText = terminalError === undefined ? text : userExplanation(terminalError)
  if (terminalError === undefined) delete state.fatalError
  else state.fatalError = terminalError
  await completeStateWorkflowRun(dependencies.database, {
    ...mutation(),
    messageEvent: {
      eventId: stableActivityId("event", `${input.idempotencyKey}/final/message`),
      correlationId: stableActivityId("correlation", `${input.idempotencyKey}/final/message`),
    },
    statusEvent: {
      eventId: stableActivityId("event", `${input.idempotencyKey}/final/status`),
      correlationId: stableActivityId("correlation", `${input.idempotencyKey}/final/status`),
    },
    messageId: MessageIdSchema.parse(stableActivityId("message", `${input.idempotencyKey}/final`)),
    text: finalText,
    status,
    context: stateWorkflowContextValue(state),
  })
  return status === "completed" ? { kind: "complete" } : { kind: "fail" }
}

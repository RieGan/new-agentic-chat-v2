import { InvalidSchemaError } from "@agentic-chat/contracts"
import {
  claimRunLease,
  type DatabaseClient,
  readRunAssignment,
  readSimpleLoopRun,
} from "@agentic-chat/db"
import type { ModelMessage } from "ai"

import type { Clock, IdGenerator } from "../application/dependencies.js"
import type { ProviderMessage } from "../provider/contracts.js"
import { SimpleLoopContextSchema } from "./context.js"
import { selectedSkillFromRun } from "./runtime-support.js"
import type { MutableLoopState } from "./tools.js"

export type ActiveSimpleLoopRun = {
  readonly runId: string
  readonly owner: string
  readonly fencingVersion: number
  readonly clock: Clock
  readonly ids: IdGenerator
}

type SessionDependencies = {
  readonly database: DatabaseClient
  readonly clock: Clock
  readonly ids: IdGenerator
}

type ExecuteIdentity = {
  readonly runId: string
  readonly owner: string
  readonly durationSeconds: number
}

export const claimSimpleLoopSession = async (
  dependencies: SessionDependencies,
  input: ExecuteIdentity,
) => {
  const assignment = await readRunAssignment(dependencies.database, input.runId)
  const lease = await claimRunLease(dependencies.database, {
    ...input,
    runtime: "simple_loop",
    expectedVersion: assignment.version,
  })
  const run = await readSimpleLoopRun(dependencies.database, input.runId)
  if (run === null) throw new InvalidSchemaError(["run: missing after lease claim"])
  const restored = SimpleLoopContextSchema.safeParse(run.continuation)
  const selectedSkill = restored.success ? restored.data.selectedSkill : selectedSkillFromRun(run)
  const state: MutableLoopState = {
    version: lease.version,
    consumedSteps: run.consumedSteps,
    messages: restored.success
      ? restored.data.messages
      : ([{ role: "user", content: run.userMessage }] satisfies readonly ProviderMessage[]),
    ...(selectedSkill === undefined ? {} : { selectedSkill }),
    ...(restored.success && restored.data.wait !== undefined ? { wait: restored.data.wait } : {}),
    ...(restored.success && restored.data.guidanceCommandId !== undefined
      ? { guidanceCommandId: restored.data.guidanceCommandId }
      : {}),
  }
  return {
    run,
    state,
    active: {
      runId: input.runId,
      owner: input.owner,
      fencingVersion: lease.fencingVersion,
      clock: dependencies.clock,
      ids: dependencies.ids,
    } satisfies ActiveSimpleLoopRun,
  }
}

export const mutationIdentity = (active: ActiveSimpleLoopRun, state: MutableLoopState) => ({
  runId: active.runId,
  owner: active.owner,
  fencingVersion: active.fencingVersion,
  expectedVersion: state.version,
  occurredAt: active.clock.now(),
})

export const toModelMessages = (messages: readonly ProviderMessage[]): ModelMessage[] =>
  messages.map((message) => {
    switch (message.role) {
      case "system":
      case "user":
        return { role: message.role, content: message.content }
      case "assistant":
        return {
          role: "assistant",
          content: message.content.map((part) =>
            part.kind === "text"
              ? { type: "text" as const, text: part.text }
              : {
                  type: "tool-call" as const,
                  toolCallId: part.callId,
                  toolName: part.toolName,
                  input: part.arguments,
                },
          ),
        }
      case "tool":
        return {
          role: "tool",
          content: message.content.map((part) => ({
            type: "tool-result" as const,
            toolCallId: part.callId,
            toolName: part.toolName,
            output: { type: "json" as const, value: part.output },
          })),
        }
      default: {
        const exhaustiveMessage: never = message
        return exhaustiveMessage
      }
    }
  })

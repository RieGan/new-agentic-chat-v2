import { createHash } from "node:crypto"

import {
  type CallId,
  CallIdSchema,
  type CorrelationId,
  CorrelationIdSchema,
  type EventId,
  EventIdSchema,
  type MessageId,
  MessageIdSchema,
  SkillSnapshotSchema,
} from "@agentic-chat/contracts"
import type { readStateWorkflowRun } from "@agentic-chat/db"
import { z } from "zod"

import {
  type ProviderMessage,
  ProviderToolCallSchema,
  ProviderToolResultSchema,
} from "../provider/contracts.js"
import { toContractError } from "../simple-loop/errors.js"
import type { MutableLoopState } from "../simple-loop/tools.js"
import { StateWorkflowContextSchema } from "./context.js"

export type MutableStateWorkflowRun = MutableLoopState

export function stableActivityId(kind: "call", key: string): CallId
export function stableActivityId(kind: "correlation", key: string): CorrelationId
export function stableActivityId(kind: "event", key: string): EventId
export function stableActivityId(kind: "message", key: string): MessageId
export function stableActivityId(
  kind: "call" | "correlation" | "event" | "message",
  key: string,
): CallId | CorrelationId | EventId | MessageId {
  const value = `${kind}_${createHash("sha256").update(key).digest("hex")}`
  switch (kind) {
    case "call":
      return CallIdSchema.parse(value)
    case "correlation":
      return CorrelationIdSchema.parse(value)
    case "event":
      return EventIdSchema.parse(value)
    case "message":
      return MessageIdSchema.parse(value)
    default: {
      const exhaustiveKind: never = kind
      return exhaustiveKind
    }
  }
}

export const stateWorkflowContextValue = (state: MutableStateWorkflowRun) =>
  z.json().parse(
    StateWorkflowContextSchema.parse({
      kind: "state_workflow",
      consumedSteps: state.consumedSteps,
      messages: state.messages,
      ...(state.selectedSkill === undefined ? {} : { selectedSkill: state.selectedSkill }),
      ...(state.wait === undefined ? {} : { wait: state.wait }),
      ...(state.guidanceCommandId === undefined
        ? {}
        : { guidanceCommandId: state.guidanceCommandId }),
      ...(state.fatalError === undefined ? {} : { terminalError: state.fatalError }),
    }),
  )

export const restoreStateWorkflowState = (
  run: NonNullable<Awaited<ReturnType<typeof readStateWorkflowRun>>>,
): MutableStateWorkflowRun => {
  const restored = StateWorkflowContextSchema.safeParse(run.continuation)
  const selectedSkill =
    run.skillId === null ||
    run.skillVersion === null ||
    run.instructions === null ||
    run.allowedTools === null
      ? undefined
      : SkillSnapshotSchema.parse({
          skillId: run.skillId,
          version: run.skillVersion,
          instructions: run.instructions,
          allowedTools: run.allowedTools,
        })
  return {
    version: run.version,
    consumedSteps: run.consumedSteps,
    messages: restored.success
      ? restored.data.messages
      : ([{ role: "user", content: run.userMessage }] satisfies readonly ProviderMessage[]),
    ...(restored.success && restored.data.selectedSkill !== undefined
      ? { selectedSkill: restored.data.selectedSkill }
      : selectedSkill === undefined
        ? {}
        : { selectedSkill }),
    ...(restored.success && restored.data.terminalError !== undefined
      ? { fatalError: restored.data.terminalError }
      : {}),
    ...(restored.success && restored.data.wait !== undefined ? { wait: restored.data.wait } : {}),
    ...(restored.success && restored.data.guidanceCommandId !== undefined
      ? { guidanceCommandId: restored.data.guidanceCommandId }
      : {}),
  }
}

export const appendToolExchange = (
  state: MutableStateWorkflowRun,
  request: { readonly callId: string; readonly toolName: string; readonly arguments: unknown },
  output: unknown,
): void => {
  const call = ProviderToolCallSchema.parse({
    kind: "tool_call",
    callId: request.callId,
    toolName: request.toolName,
    arguments: request.arguments,
  })
  const result = ProviderToolResultSchema.parse({
    kind: "tool_result",
    callId: request.callId,
    toolName: request.toolName,
    output,
  })
  state.messages = [
    ...state.messages,
    { role: "assistant", content: [call] },
    { role: "tool", content: [result] },
  ]
}

export const terminalErrorFrom = (caught: unknown) => toContractError(caught)

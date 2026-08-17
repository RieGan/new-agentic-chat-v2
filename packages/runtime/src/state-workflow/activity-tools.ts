import { CallIdSchema, ToolNameSchema } from "@agentic-chat/contracts"
import { persistStateWorkflowSkill, persistStateWorkflowToolOutcome } from "@agentic-chat/db"
import { z } from "zod"

import { createSimpleLoopTools, hashToolArguments } from "../simple-loop/tools.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import {
  appendToolExchange,
  type MutableStateWorkflowRun,
  stableActivityId,
  stateWorkflowContextValue,
} from "./activity-support.js"
import type { AdvanceRunActivityInput } from "./contracts.js"

type StateWorkflowMutation = () => {
  readonly runId: string
  readonly workflowId: string
  readonly expectedVersion: number
  readonly occurredAt: Date
}

export const createStateWorkflowTools = (
  dependencies: StateWorkflowActivityDependencies,
  input: AdvanceRunActivityInput,
  state: MutableStateWorkflowRun,
  mutation: StateWorkflowMutation,
) =>
  createSimpleLoopTools(dependencies.tools, state, {
    loadSkill: async (skillInput, callId) => {
      const loaded = dependencies.tools.loadSkill(skillInput)
      if (!loaded.ok) return loaded.error
      state.selectedSkill = loaded.skill
      appendToolExchange(
        state,
        {
          callId,
          toolName: "skill.load",
          arguments: { skillId: skillInput.skillId, version: skillInput.version },
        },
        {
          skillId: loaded.skill.skillId,
          version: loaded.skill.version,
          allowedTools: loaded.skill.allowedTools,
        },
      )
      const persisted = await persistStateWorkflowSkill(dependencies.database, {
        ...mutation(),
        eventId: stableActivityId("event", `${input.idempotencyKey}/skill/${callId}`),
        correlationId: stableActivityId("correlation", `${input.idempotencyKey}/skill/${callId}`),
        skill: loaded.skill,
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      return loaded.skill
    },
    persistTool: async (toolInput) => {
      const output =
        toolInput.outcome.status === "completed"
          ? toolInput.outcome.result
          : { error: toolInput.outcome.error }
      appendToolExchange(state, toolInput, output)
      const persisted = await persistStateWorkflowToolOutcome(dependencies.database, {
        ...mutation(),
        eventId: stableActivityId(
          "event",
          `${input.idempotencyKey}/tool/${toolInput.callId}/start`,
        ),
        terminalEventId: stableActivityId(
          "event",
          `${input.idempotencyKey}/tool/${toolInput.callId}/terminal`,
        ),
        correlationId: stableActivityId(
          "correlation",
          `${input.idempotencyKey}/tool/${toolInput.callId}`,
        ),
        callId: CallIdSchema.parse(toolInput.callId),
        toolName: ToolNameSchema.parse(toolInput.toolName),
        arguments: z.json().parse(toolInput.arguments),
        argumentsHash: hashToolArguments(toolInput.arguments),
        context: stateWorkflowContextValue(state),
        outcome: toolInput.outcome,
      })
      state.version = persisted.version
    },
  })

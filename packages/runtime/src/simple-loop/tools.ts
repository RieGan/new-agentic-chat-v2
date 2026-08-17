import { createHash } from "node:crypto"

import {
  CalculatorArgumentsSchema,
  type ContractErrorData,
  InvalidApprovalError,
  NotificationPreviewArgumentsSchema,
  NotificationSendArgumentsSchema,
  ReportGenerateArgumentsSchema,
  type SkillSnapshot,
  ToolNotAllowedError,
  type ToolResult,
} from "@agentic-chat/contracts"
import type { ToolRegistry } from "@agentic-chat/tools"
import { type ToolSet, tool } from "ai"

import { ProviderSkillLoadArgumentsSchema } from "../provider/contracts.js"
import type { SimpleLoopContext } from "./context.js"
import { toContractError } from "./errors.js"

export type MutableLoopState = {
  version: number
  consumedSteps: number
  messages: readonly import("../provider/contracts.js").ProviderMessage[]
  selectedSkill?: SkillSnapshot
  wait?: SimpleLoopContext["wait"]
  guidanceCommandId?: SimpleLoopContext["guidanceCommandId"]
  fatalError?: ContractErrorData
}

type ToolHooks = {
  readonly loadSkill: (
    input: {
      readonly skillId: string
      readonly version: string
    },
    callId: string,
  ) => Promise<SkillSnapshot | ContractErrorData>
  readonly persistTool: (input: {
    readonly callId: string
    readonly toolName: string
    readonly arguments: unknown
    readonly outcome:
      | { readonly status: "completed"; readonly result: ToolResult }
      | { readonly status: "failed" | "rejected"; readonly error: ContractErrorData }
  }) => Promise<void>
}

type ToolExecution = {
  readonly registry: ToolRegistry
  readonly state: MutableLoopState
  readonly hooks: ToolHooks
  readonly request: {
    readonly callId: string
    readonly toolName: string
    readonly arguments: unknown
  }
}

const executeTool = async ({ registry, state, hooks, request }: ToolExecution) => {
  const skill = state.selectedSkill
  if (skill === undefined) {
    const error = toContractError(new ToolNotAllowedError("no selected skill", request.toolName))
    state.fatalError = error
    await hooks.persistTool({ ...request, outcome: { status: "rejected", error } })
    return { error }
  }
  try {
    const result = registry.executeAiTool(skill, request)
    await hooks.persistTool({ ...request, outcome: { status: "completed", result } })
    return result
  } catch (caught) {
    const error = toContractError(caught)
    const fatal = caught instanceof ToolNotAllowedError || caught instanceof InvalidApprovalError
    if (fatal) state.fatalError = error
    await hooks.persistTool({
      ...request,
      outcome: { status: fatal ? "rejected" : "failed", error },
    })
    return { error }
  }
}

export const createSimpleLoopTools = (
  registry: ToolRegistry,
  state: MutableLoopState,
  hooks: ToolHooks,
): ToolSet => ({
  "skill.load": tool({
    description: "Load an exact versioned skill",
    inputSchema: ProviderSkillLoadArgumentsSchema,
    execute: async (input, options) => {
      const result = await hooks.loadSkill(input, options.toolCallId)
      if ("code" in result) {
        state.fatalError = result
        return { error: result }
      }
      state.selectedSkill = result
      return { skillId: result.skillId, version: result.version, allowedTools: result.allowedTools }
    },
  }),
  "calculator.evaluate": tool({
    description: "Evaluate a bounded arithmetic expression",
    inputSchema: CalculatorArgumentsSchema,
    execute: (arguments_, options) =>
      executeTool({
        registry,
        state,
        hooks,
        request: {
          callId: options.toolCallId,
          toolName: "calculator.evaluate",
          arguments: arguments_,
        },
      }),
  }),
  "notification.preview": tool({
    description: "Preview a notification without sending it",
    inputSchema: NotificationPreviewArgumentsSchema,
    execute: (arguments_, options) =>
      executeTool({
        registry,
        state,
        hooks,
        request: {
          callId: options.toolCallId,
          toolName: "notification.preview",
          arguments: arguments_,
        },
      }),
  }),
  "notification.send_email": tool({
    description: "Request an Admin-approved notification send",
    inputSchema: NotificationSendArgumentsSchema,
  }),
  "report.generate": tool({
    description: "Generate a report asynchronously",
    inputSchema: ReportGenerateArgumentsSchema,
  }),
})

export const hashToolArguments = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex")

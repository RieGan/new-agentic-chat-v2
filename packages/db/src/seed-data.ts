import type { AiToolName } from "@agentic-chat/contracts"

import type { JsonValue } from "./schema/index.js"

export type SkillSeed = {
  readonly id: string
  readonly version: string
  readonly instructions: string
  readonly allowedTools: readonly AiToolName[]
}

export type ToolSeed = {
  readonly id: string
  readonly version: string
  readonly mode: "sync" | "async"
  readonly risk: "read" | "low" | "high"
  readonly approvalRequired: boolean
  readonly inputSchema: JsonValue
  readonly outputSchema: JsonValue
}

const objectSchema = (
  properties: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
): JsonValue => ({ type: "object", additionalProperties: false, properties, required })

export const MVP_SKILLS = [
  {
    id: "calculator_assistant",
    version: "1",
    instructions: "Always use calculator.evaluate for arithmetic requested by the user.",
    allowedTools: ["calculator.evaluate"],
  },
  {
    id: "communication_assistant",
    version: "1",
    instructions: "Preview a message before requesting permission to send it.",
    allowedTools: ["notification.preview", "notification.send_email"],
  },
  {
    id: "report_assistant",
    version: "1",
    instructions: "Use report.generate for report requests and wait for its final result.",
    allowedTools: ["report.generate"],
  },
] as const satisfies readonly SkillSeed[]

export const MVP_TOOLS = [
  {
    id: "skill.load",
    version: "1",
    mode: "sync",
    risk: "read",
    approvalRequired: false,
    inputSchema: objectSchema({ skill_id: { type: "string" }, version: { type: "string" } }, [
      "skill_id",
      "version",
    ]),
    outputSchema: objectSchema(
      {
        skill_id: { type: "string" },
        version: { type: "string" },
        instructions: { type: "string" },
        allowed_tools: { type: "array", items: { type: "string" } },
      },
      ["skill_id", "version", "instructions", "allowed_tools"],
    ),
  },
  {
    id: "calculator.evaluate",
    version: "1",
    mode: "sync",
    risk: "read",
    approvalRequired: false,
    inputSchema: objectSchema({ expression: { type: "string" } }, ["expression"]),
    outputSchema: objectSchema({ value: { type: "number" } }, ["value"]),
  },
  {
    id: "notification.preview",
    version: "1",
    mode: "sync",
    risk: "read",
    approvalRequired: false,
    inputSchema: objectSchema(
      { recipient: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
      ["recipient", "subject", "body"],
    ),
    outputSchema: objectSchema(
      { preview_id: { type: "string" }, normalized_message: { type: "object" } },
      ["preview_id", "normalized_message"],
    ),
  },
  {
    id: "notification.send_email",
    version: "1",
    mode: "sync",
    risk: "high",
    approvalRequired: true,
    inputSchema: objectSchema({ preview_id: { type: "string" } }, ["preview_id"]),
    outputSchema: objectSchema({ message_id: { type: "string" }, status: { const: "sent" } }, [
      "message_id",
      "status",
    ]),
  },
  {
    id: "report.generate",
    version: "1",
    mode: "async",
    risk: "low",
    approvalRequired: false,
    inputSchema: objectSchema(
      { topic: { type: "string" }, sections: { type: "array", items: { type: "string" } } },
      ["topic", "sections"],
    ),
    outputSchema: objectSchema(
      { job_id: { type: "string" }, report_id: { type: "string" }, status: { const: "completed" } },
      ["job_id", "report_id", "status"],
    ),
  },
  {
    id: "job.get_status",
    version: "1",
    mode: "sync",
    risk: "read",
    approvalRequired: false,
    inputSchema: objectSchema({ job_id: { type: "string" } }, ["job_id"]),
    outputSchema: objectSchema(
      { job_id: { type: "string" }, status: { type: "string" }, result: { type: "object" } },
      ["job_id", "status"],
    ),
  },
] as const satisfies readonly ToolSeed[]

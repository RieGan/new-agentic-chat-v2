import {
  type AiToolName,
  AiToolNameSchema,
  type SkillSnapshot,
  SkillSnapshotSchema,
  ToolModeSchema,
  ToolRiskSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

export const RegistryToolIdSchema = z.enum([
  "skill.load",
  "calculator.evaluate",
  "notification.preview",
  "notification.send_email",
  "report.generate",
  "job.get_status",
])
export type RegistryToolId = z.infer<typeof RegistryToolIdSchema>

const JsonPropertySchema = z.union([
  z.object({ type: z.enum(["string", "number", "object"]) }).strict(),
  z
    .object({ type: z.literal("array"), items: z.object({ type: z.literal("string") }).strict() })
    .strict(),
  z.object({ const: z.string() }).strict(),
])
const JsonObjectSchema = z
  .object({
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(z.string(), JsonPropertySchema),
    required: z.array(z.string()),
  })
  .strict()

export const RegistryToolDefinitionSchema = z
  .object({
    id: RegistryToolIdSchema,
    version: z.string().trim().min(1),
    mode: ToolModeSchema,
    risk: ToolRiskSchema,
    approvalRequired: z.boolean(),
    inputSchema: JsonObjectSchema,
    outputSchema: JsonObjectSchema,
  })
  .strict()
export type RegistryToolDefinition = z.infer<typeof RegistryToolDefinitionSchema>

const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
})

const SKILL_DEFINITIONS: readonly SkillSnapshot[] = z.array(SkillSnapshotSchema).parse([
  {
    skillId: "calculator_assistant",
    version: "1",
    instructions: "Always use calculator.evaluate for arithmetic requested by the user.",
    allowedTools: ["calculator.evaluate"],
  },
  {
    skillId: "communication_assistant",
    version: "1",
    instructions: "Preview a message before requesting permission to send it.",
    allowedTools: ["notification.preview", "notification.send_email"],
  },
  {
    skillId: "report_assistant",
    version: "1",
    instructions: "Use report.generate for report requests and wait for its final result.",
    allowedTools: ["report.generate"],
  },
])

const TOOL_DEFINITIONS: readonly RegistryToolDefinition[] = z
  .array(RegistryToolDefinitionSchema)
  .parse([
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
        {
          job_id: { type: "string" },
          report_id: { type: "string" },
          status: { const: "completed" },
        },
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
  ])

export const isAiToolDefinition = (
  definition: RegistryToolDefinition,
): definition is RegistryToolDefinition & { readonly id: AiToolName } =>
  AiToolNameSchema.safeParse(definition.id).success

export const getSkillDefinitions = (): readonly SkillSnapshot[] =>
  structuredClone(SKILL_DEFINITIONS)

export const getToolDefinitions = (): readonly RegistryToolDefinition[] =>
  structuredClone(TOOL_DEFINITIONS)

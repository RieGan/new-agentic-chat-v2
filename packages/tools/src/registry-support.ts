import {
  type AiToolCallRequest,
  CallIdSchema,
  type ContractErrorData,
  InvalidSchemaError,
  JobStatusArgumentsSchema,
  parseContract,
  SkillIdSchema,
  SkillNotFoundError,
  type SkillSnapshot,
  SkillSnapshotSchema,
  SkillVersionSchema,
  ToolNotAllowedError,
  type ToolResult,
} from "@agentic-chat/contracts"
import { z } from "zod"

import type { ApprovalAuthorization } from "./approval-internal.js"
import { getSkillDefinitions, type RegistryToolDefinition } from "./definitions.js"

export const SkillLookupSchema = z
  .object({ skillId: SkillIdSchema, version: SkillVersionSchema })
  .strict()
export const ApprovedSendRequestSchema = z
  .object({ callId: CallIdSchema, arguments: z.unknown() })
  .strict()
export const JobLookupResultSchema = z
  .object({
    jobId: JobStatusArgumentsSchema.shape.jobId,
    status: z.enum(["queued", "running", "completed", "failed"]),
    reportId: z.string().trim().min(1).optional(),
  })
  .strict()

export type SkillLoadResult =
  | { readonly ok: true; readonly skill: SkillSnapshot }
  | { readonly ok: false; readonly error: ContractErrorData }

export type JobStatusLookup = {
  readonly lookup: (jobId: z.output<typeof JobStatusArgumentsSchema>["jobId"]) => unknown
}

export type ToolRegistry = {
  readonly loadSkill: (input: unknown) => SkillLoadResult
  readonly getAllowedAiToolDefinitions: (skill: SkillSnapshot) => readonly RegistryToolDefinition[]
  readonly executeAiTool: (skill: SkillSnapshot, input: unknown) => ToolResult
  readonly executeApprovedSend: (
    skill: SkillSnapshot,
    input: unknown,
    authorization: ApprovalAuthorization,
  ) => ToolResult
  readonly getJobStatus: (input: unknown, dependency: JobStatusLookup) => ToolResult
  readonly snapshotDefinitions: () => {
    readonly skills: readonly SkillSnapshot[]
    readonly tools: readonly RegistryToolDefinition[]
  }
}

export const invalidSchemaData = (error: InvalidSchemaError): ContractErrorData => ({
  code: error.code,
  message: error.message,
  issues: [...error.issues],
})

export const skillNotFoundData = (error: SkillNotFoundError): ContractErrorData => ({
  code: error.code,
  message: error.message,
  skill: error.skill,
})

export const assertAllowed = (skill: SkillSnapshot, request: AiToolCallRequest): void => {
  if (!skill.allowedTools.includes(request.toolName)) {
    throw new ToolNotAllowedError(`${skill.skillId}@${skill.version}`, request.toolName)
  }
}

export const cloneSkill = (skill: SkillSnapshot): SkillSnapshot =>
  parseContract(SkillSnapshotSchema, { ...skill, allowedTools: [...skill.allowedTools] })

export const resolveSelectedSkill = (skillInput: SkillSnapshot): SkillSnapshot => {
  const selected = parseContract(SkillSnapshotSchema, skillInput)
  const canonical = getSkillDefinitions().find(
    (candidate) => candidate.skillId === selected.skillId && candidate.version === selected.version,
  )
  if (canonical === undefined) {
    throw new SkillNotFoundError(`${selected.skillId}@${selected.version}`)
  }
  if (
    selected.instructions !== canonical.instructions ||
    selected.allowedTools.length !== canonical.allowedTools.length ||
    selected.allowedTools.some((tool, index) => tool !== canonical.allowedTools[index])
  ) {
    throw new InvalidSchemaError(["skill: snapshot does not match the versioned registry"])
  }
  return canonical
}

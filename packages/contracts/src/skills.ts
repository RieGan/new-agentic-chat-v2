import { z } from "zod"

import { ToolNotAllowedError } from "./errors.js"
import { RunIdSchema, SkillIdSchema, SkillVersionSchema } from "./primitives.js"
import { type AiToolName, AiToolNameSchema } from "./tools.js"

export const SkillSnapshotSchema = z
  .object({
    skillId: SkillIdSchema,
    version: SkillVersionSchema,
    instructions: z.string().min(1),
    allowedTools: z.array(AiToolNameSchema),
  })
  .strict()
export type SkillSnapshot = z.infer<typeof SkillSnapshotSchema>

export const SkillLoadControlSchema = z
  .object({
    operation: z.literal("skill.load"),
    runId: RunIdSchema,
    skillId: SkillIdSchema,
    version: SkillVersionSchema,
  })
  .strict()
export type SkillLoadControl = z.infer<typeof SkillLoadControlSchema>

export const SkillLoadedSchema = z
  .object({
    operation: z.literal("skill.loaded"),
    runId: RunIdSchema,
    skill: SkillSnapshotSchema,
  })
  .strict()
export type SkillLoaded = z.infer<typeof SkillLoadedSchema>

export const assertToolAllowed = (
  skillId: string,
  allowedTools: readonly string[],
  requestedTool: string,
): AiToolName => {
  const parsedTool = AiToolNameSchema.parse(requestedTool)
  if (!allowedTools.includes(parsedTool)) {
    throw new ToolNotAllowedError(skillId, parsedTool)
  }
  return parsedTool
}

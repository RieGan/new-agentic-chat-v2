import {
  AdminCommandIdSchema,
  ApprovalIdSchema,
  CallIdSchema,
  CorrelationIdSchema,
  JobIdSchema,
  LOOP_STEP_BUDGET,
  ReportIdSchema,
  SkillSnapshotSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

import { ProviderMessageSchema } from "../provider/contracts.js"

export const SimpleLoopContextSchema = z
  .object({
    kind: z.literal("simple_loop"),
    consumedSteps: z.number().int().min(0).max(LOOP_STEP_BUDGET),
    messages: z.array(ProviderMessageSchema),
    selectedSkill: SkillSnapshotSchema.optional(),
    wait: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("report"),
            namespace: z.string().trim().min(1),
            ledgerKey: z.string().trim().min(1),
            callId: CallIdSchema,
            jobId: JobIdSchema,
            reportId: ReportIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal("approval"),
            callId: CallIdSchema,
            approvalId: ApprovalIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal("user"),
            correlationId: CorrelationIdSchema,
            commandId: AdminCommandIdSchema.optional(),
          })
          .strict(),
      ])
      .optional(),
    guidanceCommandId: AdminCommandIdSchema.optional(),
  })
  .strict()

export type SimpleLoopContext = z.infer<typeof SimpleLoopContextSchema>

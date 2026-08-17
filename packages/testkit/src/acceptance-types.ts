import {
  AdminProjectionSchema,
  NormalizedParityTraceSchema,
  RuntimeSchema,
  UserProjectionSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

export const ACCEPTANCE_RUNTIMES = ["simple_loop", "state_workflow"] as const
export type AcceptanceRuntime = (typeof ACCEPTANCE_RUNTIMES)[number]

export const ACCEPTANCE_FLOWS = [
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
  "F08",
  "F09",
  "F10",
] as const
export const AcceptanceFlowIdSchema = z.enum(ACCEPTANCE_FLOWS)
export type AcceptanceFlowId = z.infer<typeof AcceptanceFlowIdSchema>

export const ACCEPTANCE_PROMPTS = [
  "P01",
  "P02",
  "P03",
  "P04",
  "P05",
  "P06",
  "P07",
  "P08",
  "P09",
  "P10",
  "P11",
] as const
export const AcceptancePromptIdSchema = z.enum(ACCEPTANCE_PROMPTS)
export type AcceptancePromptId = z.infer<typeof AcceptancePromptIdSchema>

const jsonRecordSchema = z.record(z.string(), z.json())

export const AcceptanceCaptureMetadataSchema = z
  .object({
    runtime: RuntimeSchema,
    testId: AcceptanceFlowIdSchema,
    promptId: AcceptancePromptIdSchema,
    fixtureNamespace: z.string().min(1),
    testFile: z.string().min(1),
    testTitle: z.string().min(1),
    runtimeDiagnostics: z.array(jsonRecordSchema),
    executionOutcome: z.json(),
  })
  .strict()
export type AcceptanceCaptureMetadata = z.infer<typeof AcceptanceCaptureMetadataSchema>

export const AcceptanceCallRecordSchema = z
  .object({
    callId: z.string().min(1),
    toolName: z.string().min(1),
    status: z.string().min(1),
    arguments: z.json(),
    result: z.json().nullable(),
    error: z.json().nullable(),
  })
  .strict()

const observedApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    callId: z.string().min(1),
    status: z.string().min(1),
    actorId: z.string().min(1).nullable(),
    decision: z.string().min(1).nullable(),
  })
  .strict()

const observedJobSchema = z
  .object({
    jobId: z.string().min(1),
    callId: z.string().min(1),
    status: z.string().min(1),
    percent: z.number().int().min(0).max(100),
    result: z.json().nullable(),
  })
  .strict()

export const ObservedAcceptanceCaptureSchema = z
  .object({
    metadata: AcceptanceCaptureMetadataSchema,
    runId: z.string().min(1),
    actors: z.array(z.object({ actor: z.string().min(1), action: z.string().min(1) }).strict()),
    stableIds: z
      .object({
        runId: z.string().min(1),
        callIds: z.array(z.string().min(1)),
        jobIds: z.array(z.string().min(1)),
        approvalIds: z.array(z.string().min(1)),
        commandIds: z.array(z.string().min(1)),
      })
      .strict(),
    observedSkill: z
      .object({
        skillId: z.string().min(1),
        version: z.string().min(1),
        allowedTools: z.array(z.string().min(1)),
      })
      .strict()
      .nullable(),
    observedToolCalls: z.array(AcceptanceCallRecordSchema),
    observedApprovals: z.array(observedApprovalSchema),
    observedJobs: z.array(observedJobSchema),
    finalResponse: z.string().nullable(),
    finalStatus: z.enum(["completed", "failed"]),
    projections: z.object({ user: UserProjectionSchema, admin: AdminProjectionSchema }).strict(),
    normalizedEventTrace: NormalizedParityTraceSchema,
  })
  .strict()
export type ObservedAcceptanceCapture = z.infer<typeof ObservedAcceptanceCaptureSchema>

export const AcceptanceRecordSchema = ObservedAcceptanceCaptureSchema.extend({
  schemaVersion: z.literal(2),
  provenance: z
    .object({
      source: z.literal("postgresql_projection_capture"),
      capturedRunId: z.string().min(1),
      processId: z.number().int().positive(),
      observationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  observedApprovalJobEvents: z.array(NormalizedParityTraceSchema.shape.events.element),
  result: z.literal("PASS"),
  failureDetails: z.null(),
  evidenceLinks: z.array(z.string().min(1)).min(1),
}).strict()
export type AcceptanceRecord = z.infer<typeof AcceptanceRecordSchema>

export type AcceptanceMatrixCell = {
  readonly testId: AcceptanceFlowId
  readonly runtime: AcceptanceRuntime
  readonly promptIds: readonly AcceptancePromptId[]
  readonly result: "PASS"
  readonly evidenceLinks: readonly string[]
}

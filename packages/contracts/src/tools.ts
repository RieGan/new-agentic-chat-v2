import { z } from "zod"

import { ContractErrorSchema } from "./errors.js"
import {
  AggregateVersionSchema,
  ApprovalIdSchema,
  CallIdSchema,
  JobIdSchema,
  PreviewIdSchema,
  ReportIdSchema,
  RunIdSchema,
  TimestampSchema,
} from "./primitives.js"

export const ToolNameSchema = z.enum([
  "calculator.evaluate",
  "notification.preview",
  "notification.send_email",
  "report.generate",
  "job.get_status",
])
export type ToolName = z.infer<typeof ToolNameSchema>

export const AiToolNameSchema = z.enum([
  "calculator.evaluate",
  "notification.preview",
  "notification.send_email",
  "report.generate",
])
export type AiToolName = z.infer<typeof AiToolNameSchema>

export const ToolModeSchema = z.enum(["sync", "async"])
export const ToolRiskSchema = z.enum(["read", "low", "high"])

export const CalculatorArgumentsSchema = z.object({ expression: z.string().trim().min(1) }).strict()
export const NotificationPreviewArgumentsSchema = z
  .object({
    recipient: z.string().trim().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
  })
  .strict()
export const NotificationSendArgumentsSchema = z.object({ previewId: PreviewIdSchema }).strict()
export const ReportGenerateArgumentsSchema = z
  .object({ topic: z.string().trim().min(1), sections: z.array(z.string().trim().min(1)).min(1) })
  .strict()
export const JobStatusArgumentsSchema = z.object({ jobId: JobIdSchema }).strict()

export const ToolArgumentsSchema = z.discriminatedUnion("toolName", [
  z
    .object({ toolName: z.literal("calculator.evaluate"), expression: z.string().trim().min(1) })
    .strict(),
  z
    .object({
      toolName: z.literal("notification.preview"),
      recipient: z.string().trim().min(1),
      subject: z.string().min(1),
      body: z.string().min(1),
    })
    .strict(),
  z.object({ toolName: z.literal("notification.send_email"), previewId: PreviewIdSchema }).strict(),
  z
    .object({
      toolName: z.literal("report.generate"),
      topic: z.string().trim().min(1),
      sections: z.array(z.string().trim().min(1)).min(1),
    })
    .strict(),
  z.object({ toolName: z.literal("job.get_status"), jobId: JobIdSchema }).strict(),
])
export type ToolArguments = z.infer<typeof ToolArgumentsSchema>

export const AiToolCallRequestSchema = z.discriminatedUnion("toolName", [
  z
    .object({
      toolName: z.literal("calculator.evaluate"),
      callId: CallIdSchema,
      arguments: CalculatorArgumentsSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal("notification.preview"),
      callId: CallIdSchema,
      arguments: NotificationPreviewArgumentsSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal("notification.send_email"),
      callId: CallIdSchema,
      arguments: NotificationSendArgumentsSchema,
    })
    .strict(),
  z
    .object({
      toolName: z.literal("report.generate"),
      callId: CallIdSchema,
      arguments: ReportGenerateArgumentsSchema,
    })
    .strict(),
])
export type AiToolCallRequest = z.infer<typeof AiToolCallRequestSchema>

export const ToolResultSchema = z.discriminatedUnion("toolName", [
  z.object({ toolName: z.literal("calculator.evaluate"), value: z.number() }).strict(),
  z
    .object({
      toolName: z.literal("notification.preview"),
      previewId: PreviewIdSchema,
      normalizedMessage: z
        .object({ recipient: z.string(), subject: z.string(), body: z.string() })
        .strict(),
    })
    .strict(),
  z
    .object({
      toolName: z.literal("notification.send_email"),
      messageId: z.string().trim().min(1),
      status: z.literal("sent"),
    })
    .strict(),
  z
    .object({
      toolName: z.literal("report.generate"),
      jobId: JobIdSchema,
      reportId: ReportIdSchema,
      status: z.literal("completed"),
    })
    .strict(),
  z
    .object({
      toolName: z.literal("job.get_status"),
      jobId: JobIdSchema,
      status: z.enum(["queued", "running", "completed", "failed"]),
      reportId: ReportIdSchema.optional(),
    })
    .strict(),
])
export type ToolResult = z.infer<typeof ToolResultSchema>

const toolCallBaseShape = {
  callId: CallIdSchema,
  runId: RunIdSchema,
  toolName: ToolNameSchema,
  arguments: z.union([
    CalculatorArgumentsSchema,
    NotificationPreviewArgumentsSchema,
    NotificationSendArgumentsSchema,
    ReportGenerateArgumentsSchema,
    JobStatusArgumentsSchema,
  ]),
  version: AggregateVersionSchema,
} as const

export const ToolCallEnvelopeSchema = z
  .discriminatedUnion("status", [
    z.object({ ...toolCallBaseShape, status: z.literal("prepared") }).strict(),
    z
      .object({ ...toolCallBaseShape, status: z.literal("running"), startedAt: TimestampSchema })
      .strict(),
    z
      .object({
        ...toolCallBaseShape,
        status: z.literal("approval_required"),
        approvalId: ApprovalIdSchema,
      })
      .strict(),
    z
      .object({ ...toolCallBaseShape, status: z.literal("waiting_job"), jobId: JobIdSchema })
      .strict(),
    z
      .object({ ...toolCallBaseShape, status: z.literal("completed"), result: ToolResultSchema })
      .strict(),
    z
      .object({ ...toolCallBaseShape, status: z.literal("failed"), error: ContractErrorSchema })
      .strict(),
    z
      .object({ ...toolCallBaseShape, status: z.literal("rejected"), reason: z.string().min(1) })
      .strict(),
  ])
  .superRefine((call, context) => {
    const argumentsResult = ToolArgumentsSchema.safeParse({
      toolName: call.toolName,
      ...call.arguments,
    })
    if (!argumentsResult.success) {
      context.addIssue({ code: "custom", message: "Tool arguments do not match toolName" })
    }
    if (call.status === "completed" && call.result.toolName !== call.toolName) {
      context.addIssue({ code: "custom", message: "Tool result does not match toolName" })
    }
  })
export type ToolCallEnvelope = z.infer<typeof ToolCallEnvelopeSchema>

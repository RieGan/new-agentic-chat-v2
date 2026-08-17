import { createHash } from "node:crypto"

import {
  type CallId,
  InvalidApprovalError,
  NotificationPreviewArgumentsSchema,
  NotificationSendArgumentsSchema,
  PreviewIdSchema,
  parseContract,
  type ToolResult,
  ToolResultSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

import type { ApprovalAuthorization } from "./approval-internal.js"

const NormalizedPreviewArgumentsSchema = NotificationPreviewArgumentsSchema.transform((value) => ({
  recipient: value.recipient.toLowerCase(),
  subject: value.subject.trim(),
  body: value.body.replace(/\r\n?/gu, "\n").trim(),
})).pipe(
  z
    .object({
      recipient: z.email(),
      subject: z.string().min(1),
      body: z.string().min(1),
    })
    .strict(),
)

const stableHash = (prefix: string, canonicalContent: string): string =>
  `${prefix}_${createHash("sha256").update(canonicalContent).digest("hex").slice(0, 24)}`

export const hashApprovedArguments = (input: unknown): string => {
  const arguments_ = parseContract(NotificationSendArgumentsSchema, input)
  return createHash("sha256").update(JSON.stringify(arguments_)).digest("hex")
}

export const previewNotification = (input: unknown): ToolResult => {
  const normalizedMessage = parseContract(NormalizedPreviewArgumentsSchema, input)
  const previewId = PreviewIdSchema.parse(stableHash("preview", JSON.stringify(normalizedMessage)))
  return parseContract(ToolResultSchema, {
    toolName: "notification.preview",
    previewId,
    normalizedMessage,
  })
}

export const simulateApprovedSend = (
  callId: CallId,
  input: unknown,
  authorization: ApprovalAuthorization,
): ToolResult => {
  const arguments_ = parseContract(NotificationSendArgumentsSchema, input)
  authorization.consume({ callId, argumentsHash: hashApprovedArguments(arguments_) })
  const messageId = stableHash("message", `${callId}:${JSON.stringify(arguments_)}`)
  return parseContract(ToolResultSchema, {
    toolName: "notification.send_email",
    messageId,
    status: "sent",
  })
}

export const denyDirectSend = (): never => {
  throw new InvalidApprovalError("notification.send_email requires consumed approval authorization")
}

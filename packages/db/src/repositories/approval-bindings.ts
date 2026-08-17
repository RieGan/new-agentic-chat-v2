import {
  InvalidApprovalError,
  NotificationSendArgumentsSchema,
  parseContract,
} from "@agentic-chat/contracts"
import { hashApprovedArguments } from "@agentic-chat/tools"

import type { approvalRequests, toolCalls } from "../schema/index.js"

type ApprovalRow = typeof approvalRequests.$inferSelect
type ToolCallRow = typeof toolCalls.$inferSelect

export const canonicalNotificationArguments = (value: unknown) => {
  const arguments_ = parseContract(NotificationSendArgumentsSchema, value)
  return { arguments: arguments_, hash: hashApprovedArguments(arguments_) }
}

export const assertExactApprovalBinding = (
  approval: ApprovalRow,
  call: ToolCallRow,
): ReturnType<typeof canonicalNotificationArguments> => {
  if (
    call.runId !== approval.runId ||
    call.id !== approval.callId ||
    call.toolId !== approval.toolId ||
    call.toolVersion !== approval.toolVersion
  ) {
    throw new InvalidApprovalError("approval call binding mismatch")
  }
  const approvedArguments = canonicalNotificationArguments(approval.arguments)
  const callArguments = canonicalNotificationArguments(call.arguments)
  if (
    approvedArguments.hash !== approval.argumentsHash ||
    callArguments.hash !== call.argumentsHash ||
    JSON.stringify(approvedArguments.arguments) !== JSON.stringify(callArguments.arguments)
  ) {
    throw new InvalidApprovalError("canonical arguments changed")
  }
  return approvedArguments
}

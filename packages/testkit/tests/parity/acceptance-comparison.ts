import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import type { AcceptancePromptId, AcceptanceRecord } from "../../src/index.js"

type AcceptanceEventType = AcceptanceRecord["normalizedEventTrace"]["events"][number]["type"]

const GENERATED_IDENTITY = {
  approval: "<approvalId>",
  approvalArguments: "<argumentsHash:notification.send_email>",
  call: "<callId>",
  command: "<commandId>",
  job: "<jobId>",
  message: "<messageId>",
  preview: "<previewId>",
  report: "<reportId>",
  runtimeProse: "<runtime-prose>",
} as const

const TRACE_IDENTITY_PATHS: Readonly<Partial<Record<AcceptanceEventType, readonly string[]>>> = {
  "message.completed": ["messageId"],
  "tool.call.started": ["callId"],
  "tool.call.approval_required": ["callId"],
  "tool.call.waiting_job": ["callId"],
  "tool.call.completed": ["callId", "result.messageId", "result.jobId", "result.reportId"],
  "tool.call.failed": ["callId"],
  "tool.call.rejected": ["callId"],
  "approval.requested": ["approvalId", "callId"],
  "approval.approved": ["approvalId", "callId"],
  "approval.rejected": ["approvalId", "callId"],
  "approval.expired": ["approvalId", "callId"],
  "job.accepted": ["jobId", "callId"],
  "job.progress": ["jobId", "callId"],
  "job.completed": ["jobId", "callId", "reportId"],
  "job.failed": ["jobId", "callId"],
  "admin.command.accepted": ["commandId"],
  "admin.command.applied": ["commandId"],
  "admin.command.rejected": ["commandId"],
  "admin.command.expired": ["commandId"],
}

const RUNTIME_PROSE_PROMPTS = new Set<AcceptancePromptId>(["P04", "P08"])

const markerForPath = (path: string): string => {
  switch (path.split(".").at(-1)) {
    case "approvalId":
      return GENERATED_IDENTITY.approval
    case "argumentsHash":
      return GENERATED_IDENTITY.approvalArguments
    case "callId":
      return GENERATED_IDENTITY.call
    case "commandId":
      return GENERATED_IDENTITY.command
    case "content":
      return GENERATED_IDENTITY.runtimeProse
    case "jobId":
      return GENERATED_IDENTITY.job
    case "messageId":
      return GENERATED_IDENTITY.message
    case "previewId":
      return GENERATED_IDENTITY.preview
    case "reportId":
      return GENERATED_IDENTITY.report
    default:
      throw new TypeError(`Unsupported generated identity path: ${path}`)
  }
}

const normalizeAtPaths = (
  value: unknown,
  paths: ReadonlySet<string>,
  currentPath = "",
): unknown => {
  if (paths.has(currentPath)) return markerForPath(currentPath)
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeAtPaths(entry, paths, `${currentPath}[${index}]`))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeAtPaths(entryValue, paths, currentPath ? `${currentPath}.${entryKey}` : entryKey),
      ]),
    )
  }
  return value
}

const hasDerivedApprovalHash = (
  record: AcceptanceRecord,
  callId: string,
  argumentsHash: string,
): boolean => {
  const call = record.observedToolCalls.find(
    (candidate) => candidate.callId === callId && candidate.toolName === "notification.send_email",
  )
  if (call === undefined) return false
  const derived = createHash("sha256").update(JSON.stringify(call.arguments)).digest("hex")
  return derived === argumentsHash
}

export const sharedTrace = (record: AcceptanceRecord) =>
  record.normalizedEventTrace.events.map((event) => {
    const paths = new Set<string>(TRACE_IDENTITY_PATHS[event.type] ?? [])
    if (
      event.type === "approval.requested" &&
      "callId" in event.payload &&
      "argumentsHash" in event.payload &&
      hasDerivedApprovalHash(record, event.payload.callId, event.payload.argumentsHash)
    ) {
      paths.add("argumentsHash")
    }
    if (
      event.type === "message.completed" &&
      "actor" in event.payload &&
      event.payload.actor === "ai" &&
      RUNTIME_PROSE_PROMPTS.has(record.metadata.promptId)
    ) {
      paths.add("content")
    }
    return {
      position: event.position,
      type: event.type,
      visibility: event.visibility,
      payload: normalizeAtPaths(event.payload, paths),
    }
  })

const normalizeToolCall = (call: AcceptanceRecord["observedToolCalls"][number]) => {
  const argumentPaths =
    call.toolName === "notification.send_email" ? new Set(["previewId"]) : new Set<string>()
  const resultPaths = new Set<string>()
  if (call.toolName === "notification.send_email") resultPaths.add("messageId")
  if (call.toolName === "report.generate") {
    resultPaths.add("jobId")
    resultPaths.add("reportId")
  }
  return {
    callId: GENERATED_IDENTITY.call,
    toolName: call.toolName,
    status: call.status,
    arguments: normalizeAtPaths(call.arguments, argumentPaths),
    result: normalizeAtPaths(call.result, resultPaths),
    error: call.error,
  }
}

export const sharedOutcome = (record: AcceptanceRecord) => ({
  finalStatus: record.finalStatus,
  finalResponse: RUNTIME_PROSE_PROMPTS.has(record.metadata.promptId)
    ? GENERATED_IDENTITY.runtimeProse
    : record.finalResponse,
  observedSkill: record.observedSkill,
  selectedSkill: record.projections.admin.run.selectedSkill ?? null,
  calls: record.observedToolCalls.map(normalizeToolCall),
  approvals: record.observedApprovals.map(({ status, actorId, decision }) => ({
    approvalId: GENERATED_IDENTITY.approval,
    callId: GENERATED_IDENTITY.call,
    status,
    actorId,
    decision,
  })),
  jobs: record.observedJobs.map(({ status, percent, result }) => ({
    jobId: GENERATED_IDENTITY.job,
    callId: GENERATED_IDENTITY.call,
    status,
    percent,
    result: normalizeAtPaths(result, new Set(["jobId", "reportId"])),
  })),
  finalMessages: record.normalizedEventTrace.events.filter(
    (event) =>
      event.type === "message.completed" &&
      "actor" in event.payload &&
      event.payload.actor === "ai",
  ).length,
})

export const assertAcceptanceParity = (
  simple: AcceptanceRecord,
  workflow: AcceptanceRecord,
  label: string,
): void => {
  assert.deepStrictEqual(sharedTrace(simple), sharedTrace(workflow), `${label} trace mismatch`)
  assert.deepStrictEqual(
    sharedOutcome(simple),
    sharedOutcome(workflow),
    `${label} outcome mismatch`,
  )
}

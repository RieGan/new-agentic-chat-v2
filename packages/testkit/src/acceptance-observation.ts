import { createHash } from "node:crypto"

import {
  AdminProjectionSchema,
  CanonicalEventSchema,
  normalizeParityTrace,
  projectEvents,
  RunSnapshotSchema,
  UserProjectionSchema,
} from "@agentic-chat/contracts"
import type { DatabaseClient } from "@agentic-chat/db"
import { z } from "zod"

import {
  type AcceptanceCaptureMetadata,
  AcceptanceCaptureMetadataSchema,
  type ObservedAcceptanceCapture,
  ObservedAcceptanceCaptureSchema,
} from "./acceptance-types.js"

type CaptureInput = Readonly<{ runId: string; metadata: AcceptanceCaptureMetadata }>

const runRowSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string(),
    runtime: z.enum(["simple_loop", "state_workflow"]),
    status: z.string(),
    version: z.number().int(),
    consumed_steps: z.number().int(),
    skill_id: z.string().nullable(),
    skill_version: z.string().nullable(),
    instructions: z.string().nullable(),
    allowed_tools: z.array(z.string()).nullable(),
  })
  .strict()

const eventRowSchema = z
  .object({
    id: z.string(),
    sequence: z.number().int(),
    type: z.string(),
    visibility: z.string(),
    payload: z.unknown(),
    correlation_id: z.string(),
    occurred_at: z.date(),
  })
  .strict()

const callRowSchema = z
  .object({
    id: z.string(),
    tool_id: z.string(),
    status: z.string(),
    arguments: z.unknown(),
    result: z.unknown().nullable(),
    error: z.unknown().nullable(),
  })
  .strict()

export const captureActualAcceptance = async (
  database: DatabaseClient,
  unparsedInput: CaptureInput,
): Promise<ObservedAcceptanceCapture> => {
  const input = {
    runId: z.string().min(1).parse(unparsedInput.runId),
    metadata: AcceptanceCaptureMetadataSchema.parse(unparsedInput.metadata),
  }
  const [
    runResult,
    eventResult,
    messageResult,
    callResult,
    approvalResult,
    jobResult,
    commandResult,
  ] = await Promise.all([
    database.pool.query(
      `select r.id, r.conversation_id, r.runtime, r.status, r.version, r.consumed_steps,
          s.skill_id, s.skill_version, s.instructions, s.allowed_tools
         from runs r left join run_skill_snapshots s on s.run_id = r.id where r.id = $1`,
      [input.runId],
    ),
    database.pool.query(
      `select id, sequence, type, visibility, payload, correlation_id, occurred_at
         from run_events where run_id = $1 order by sequence`,
      [input.runId],
    ),
    database.pool.query(
      `select id, actor, content from messages where run_id = $1 order by created_at, id`,
      [input.runId],
    ),
    database.pool.query(
      `select id, tool_id, status, arguments, result, error
         from tool_calls where run_id = $1 order by created_at, id`,
      [input.runId],
    ),
    database.pool.query(
      `select r.id approval_id, r.call_id, r.status, a.actor_id, a.decision
         from approval_requests r left join approval_actions a on a.approval_id = r.id
         where r.run_id = $1 order by r.created_at, r.id`,
      [input.runId],
    ),
    database.pool.query(
      `select id job_id, call_id, status, percent, result
         from jobs where run_id = $1 order by created_at, ledger_key`,
      [input.runId],
    ),
    database.pool.query(
      `select id command_id, actor_id, status from admin_commands
         where run_id = $1 order by created_at, id`,
      [input.runId],
    ),
  ])
  const run = runRowSchema.parse(runResult.rows[0])
  const events = eventResult.rows.map((row) => {
    const parsed = eventRowSchema.parse(row)
    return CanonicalEventSchema.parse({
      eventId: parsed.id,
      runId: run.id,
      sequence: parsed.sequence,
      type: parsed.type,
      visibility: parsed.visibility,
      payload: parsed.payload,
      correlationId: parsed.correlation_id,
      occurredAt: parsed.occurred_at.toISOString(),
    })
  })
  const selectedSkill =
    run.skill_id === null ||
    run.skill_version === null ||
    run.instructions === null ||
    run.allowed_tools === null
      ? undefined
      : {
          skillId: run.skill_id,
          version: run.skill_version,
          instructions: run.instructions,
          allowedTools: run.allowed_tools,
        }
  const snapshot = RunSnapshotSchema.parse({
    runId: run.id,
    conversationId: run.conversation_id,
    runtime: run.runtime,
    status: run.status,
    version: run.version,
    consumedSteps: run.consumed_steps,
    ...(selectedSkill === undefined ? {} : { selectedSkill }),
    cursor: { runId: run.id, sequence: events.at(-1)?.sequence ?? 0 },
  })
  const user = UserProjectionSchema.parse({
    viewer: "user",
    run: snapshot,
    events: projectEvents(events, "user"),
  })
  const admin = AdminProjectionSchema.parse({ viewer: "admin", run: snapshot, events })
  const messages = z
    .array(
      z.object({ id: z.string(), actor: z.enum(["user", "ai"]), content: z.string() }).strict(),
    )
    .parse(messageResult.rows)
  const calls = callResult.rows.map((row) => {
    const parsed = callRowSchema.parse(row)
    return {
      callId: parsed.id,
      toolName: parsed.tool_id,
      status: parsed.status,
      arguments: z.json().parse(parsed.arguments),
      result: parsed.result === null ? null : z.json().parse(parsed.result),
      error: parsed.error === null ? null : z.json().parse(parsed.error),
    }
  })
  const approvals = z
    .array(
      z
        .object({
          approval_id: z.string(),
          call_id: z.string(),
          status: z.string(),
          actor_id: z.string().nullable(),
          decision: z.string().nullable(),
        })
        .strict(),
    )
    .parse(approvalResult.rows)
  const jobs = z
    .array(
      z
        .object({
          job_id: z.string(),
          call_id: z.string(),
          status: z.string(),
          percent: z.number().int(),
          result: z.unknown().nullable(),
        })
        .strict(),
    )
    .parse(jobResult.rows)
  const commands = z
    .array(z.object({ command_id: z.string(), actor_id: z.string(), status: z.string() }).strict())
    .parse(commandResult.rows)
  const normalizedEventTrace = normalizeParityTrace(events)
  const finalResponse = messages.filter((message) => message.actor === "ai").at(-1)?.content ?? null
  return ObservedAcceptanceCaptureSchema.parse({
    metadata: input.metadata,
    runId: run.id,
    actors: [
      ...messages.map((message) => ({
        actor: message.actor === "user" ? "mvp_user" : "ai",
        action: message.actor === "user" ? "message" : "final_response",
      })),
      ...approvals
        .filter((approval) => approval.actor_id !== null)
        .map((approval) => ({
          actor: approval.actor_id ?? "",
          action: approval.decision ?? "decision",
        })),
      ...commands.map((command) => ({ actor: command.actor_id, action: command.status })),
    ],
    stableIds: {
      runId: run.id,
      callIds: calls.map((call) => call.callId),
      jobIds: jobs.map((job) => job.job_id),
      approvalIds: approvals.map((approval) => approval.approval_id),
      commandIds: commands.map((command) => command.command_id),
    },
    observedSkill:
      selectedSkill === undefined
        ? null
        : {
            skillId: selectedSkill.skillId,
            version: selectedSkill.version,
            allowedTools: selectedSkill.allowedTools,
          },
    observedToolCalls: calls,
    observedApprovals: approvals.map((approval) => ({
      approvalId: approval.approval_id,
      callId: approval.call_id,
      status: approval.status,
      actorId: approval.actor_id,
      decision: approval.decision,
    })),
    observedJobs: jobs.map((job) => ({
      jobId: job.job_id,
      callId: job.call_id,
      status: job.status,
      percent: job.percent,
      result: job.result === null ? null : z.json().parse(job.result),
    })),
    finalResponse,
    finalStatus: run.status,
    projections: { user, admin },
    normalizedEventTrace,
  })
}

export const digestObservedAcceptance = (observation: ObservedAcceptanceCapture): string =>
  createHash("sha256").update(JSON.stringify(observation)).digest("hex")

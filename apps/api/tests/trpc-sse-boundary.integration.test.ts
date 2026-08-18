import { FIXED_ACTORS } from "@agentic-chat/contracts"
import { createApprovalService } from "@agentic-chat/runtime"
import { createToolRegistry, hashApprovedArguments } from "@agentic-chat/tools"
import { TRPCError } from "@trpc/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApiContext } from "../src/context.js"
import { appRouter } from "../src/router.js"
import { createApiServices } from "../src/services.js"
import {
  type ApiTestContext,
  createTestIds,
  ManualRunEventSource,
  startApiTestContext,
  stopApiTestContext,
  testClock,
} from "./trpc-sse-support.js"

describe("tRPC fixed-actor boundary", () => {
  let context: ApiTestContext

  beforeAll(async () => {
    context = await startApiTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApiTestContext(context)
  })

  const callers = (namespace: string) => {
    const services = createApiServices({
      database: context.database,
      clock: testClock,
      ids: createTestIds(namespace),
      tools: createToolRegistry(),
    })
    const events = new ManualRunEventSource()
    return {
      admin: appRouter.createCaller(createApiContext(FIXED_ACTORS.ADMIN, services, events)),
      services,
      user: appRouter.createCaller(createApiContext(FIXED_ACTORS.USER, services, events)),
    }
  }

  const preparedApproval = async (namespace: string) => {
    const conversationId = `conversation_approval_${namespace}`
    const runId = `run_approval_${namespace}`
    const callId = `call_approval_${namespace}`
    const arguments_ = { previewId: `preview_${namespace}` }
    const argumentsHash = hashApprovedArguments(arguments_)
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ($1, 'mvp_user')",
      [conversationId],
    )
    await context.database.pool.query(
      "insert into runs (id, conversation_id, user_id, runtime, status) values ($1, $2, 'mvp_user', 'simple_loop', 'waiting_for_admin')",
      [runId, conversationId],
    )
    await context.database.pool.query(
      `insert into tool_calls
        (id, run_id, tool_id, tool_version, status, arguments, arguments_hash)
       values ($1, $2, 'notification.send_email', '1', 'prepared', $3::jsonb, $4)`,
      [callId, runId, JSON.stringify(arguments_), argumentsHash],
    )
    const approval = await createApprovalService({
      database: context.database,
      clock: testClock,
      ids: createTestIds(`prepare_${namespace}`),
      tools: createToolRegistry(),
    }).prepare({ runId, callId, expiresAt: "2026-08-17T12:05:00.000Z" })
    return { approval, argumentsHash, callId, runId }
  }

  it("returns a durable accepted receipt without executing a runtime when User sends chat", async () => {
    // Given: the fixed User API context and a valid new-run command.
    const { user } = callers("chat_receipt")
    await user.conversations.create({ conversationId: "conversation_chat_receipt" })

    // When: the User admits a chat message.
    const receipt = await user.chat.sendMessage({
      kind: "new_run",
      conversationId: "conversation_chat_receipt",
      runtime: "simple_loop",
      message: "hello",
      idempotencyKey: "idempotency_chat_receipt",
    })

    // Then: admission is durable and only a dispatch intent is queued.
    expect(receipt.status).toBe("accepted")
    const stored = await context.database.pool.query(
      "select count(*)::int as count from dispatch_intents where aggregate_id = $1",
      [receipt.runId],
    )
    expect(stored.rows[0]?.count).toBe(1)
  })

  it("creates, lists, and gets an explicit User conversation", async () => {
    // Given: the fixed User API context and a client-generated branded ID.
    const { user } = callers("conversation_lifecycle")
    const conversationId = "conversation_lifecycle"

    // When: the User creates the session and reads both collection and aggregate views.
    const created = await user.conversations.create({ conversationId })
    const listed = await user.conversations.list({})
    const loaded = await user.conversations.get({ conversationId })

    // Then: every shape carries the same client-provided identity without a generated replacement.
    expect(created.conversationId).toBe(conversationId)
    expect(listed.conversations.some((item) => item.conversationId === conversationId)).toBe(true)
    expect(loaded).toEqual({ conversationId, messages: [], runs: [] })
  })

  it("rejects malformed strict input before application admission", async () => {
    // Given: the fixed User caller and an input carrying an unknown field.
    const { user } = callers("malformed")
    await user.conversations.create({ conversationId: "conversation_malformed" })
    const malformed = {
      kind: "new_run",
      conversationId: "conversation_malformed",
      runtime: "simple_loop",
      message: "hello",
      idempotencyKey: "idempotency_malformed",
      unexpected: "blocked",
    } as const

    // When: the malformed value crosses the tRPC boundary.
    const result = user.chat.sendMessage(malformed)

    // Then: strict Zod validation rejects it.
    await expect(result).rejects.toBeInstanceOf(TRPCError)
  })

  it("denies Admin procedures to User context without leaking hidden content", async () => {
    // Given: one run admitted by User and a secret Admin instruction.
    const { admin, user } = callers("actor_denial")
    await user.conversations.create({ conversationId: "conversation_actor_denial" })
    const receipt = await user.chat.sendMessage({
      kind: "new_run",
      conversationId: "conversation_actor_denial",
      runtime: "simple_loop",
      message: "hello",
      idempotencyKey: "idempotency_actor_denial",
    })
    const secret = "PROVIDER_SECRET_ADMIN_GUIDANCE"

    // When: User invokes the Admin command and Admin targets the persisted session directly.
    const denied = user.admin.command.sendHidden({
      conversationId: "conversation_actor_denial",
      instruction: secret,
      expiresAt: "2026-08-17T12:05:00.000Z",
      idempotencyKey: "idempotency_denied_admin",
    })
    await expect(denied).rejects.toMatchObject({ code: "FORBIDDEN" })
    const adminSessions = await admin.conversations.list({})
    await admin.admin.command.sendHidden({
      conversationId: "conversation_actor_denial",
      instruction: secret,
      expiresAt: "2026-08-17T12:05:00.000Z",
      idempotencyKey: "idempotency_allowed_admin",
    })
    const projection = await user.runs.get({ runId: receipt.runId })

    // Then: the User projection and denial serialization contain no hidden instruction.
    expect(adminSessions.conversations.map((item) => item.conversationId)).toContain(
      "conversation_actor_denial",
    )
    expect(projection.viewer).toBe("user")
    expect(JSON.stringify(projection)).not.toContain(secret)
    await denied.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(secret)
    })
  })

  it("serves every User read procedure from persisted projections", async () => {
    // Given: an admitted run and the seeded skill registry.
    const { services, user } = callers("read_models")
    await user.conversations.create({ conversationId: "conversation_read_models" })
    const receipt = await user.chat.sendMessage({
      kind: "new_run",
      conversationId: "conversation_read_models",
      runtime: "state_workflow",
      message: "persisted message",
      idempotencyKey: "idempotency_read_models",
    })

    // When: the User loads the blueprint read procedures.
    const [conversation, runs, run, events, skill] = await Promise.all([
      user.conversations.get({ conversationId: "conversation_read_models" }),
      user.runs.list({ runtime: "state_workflow" }),
      user.runs.get({ runId: receipt.runId }),
      services.events("user", { runId: receipt.runId }),
      user.skills.get({ skillId: "calculator_assistant", version: "1" }),
    ])

    // Then: each result is canonical persisted data with a cursor.
    expect(conversation.messages.map((message) => message.content)).toEqual(["persisted message"])
    expect(runs.some((snapshot) => snapshot.runId === receipt.runId)).toBe(true)
    expect(run.run.cursor.sequence).toBe(1)
    expect(events.cursor.sequence).toBe(1)
    expect(skill.skillId).toBe("calculator_assistant")
  })

  it("serves and decides persisted approvals only through fixed Admin procedures", async () => {
    // Given: two exact pending approval snapshots.
    const approvedFixture = await preparedApproval("approve")
    const rejectedFixture = await preparedApproval("reject")
    const { admin, user } = callers("approval_decisions")

    // When: Admin reads and decides each exact snapshot.
    const pending = await admin.approvals.listPending({})
    const loaded = await admin.approvals.get({ approvalId: approvedFixture.approval.approvalId })
    const approved = await admin.approvals.approve({
      decision: "approve",
      approvalId: approvedFixture.approval.approvalId,
      callId: approvedFixture.callId,
      expectedArgumentsHash: approvedFixture.argumentsHash,
      expectedVersion: 0,
    })
    const rejected = await admin.approvals.reject({
      decision: "reject",
      approvalId: rejectedFixture.approval.approvalId,
      callId: rejectedFixture.callId,
      expectedArgumentsHash: rejectedFixture.argumentsHash,
      expectedVersion: 0,
      reason: "not authorized",
    })
    const userProjection = await user.runs.get({ runId: rejectedFixture.runId })

    // Then: Admin receives exact decisions while User receives no decision metadata.
    expect(pending.map((approval) => approval.status)).toContain("pending")
    expect(loaded.argumentsHash).toBe(approvedFixture.argumentsHash)
    expect(approved.status).toBe("approved")
    expect(rejected.status).toBe("rejected")
    expect(JSON.stringify(userProjection)).not.toContain("not authorized")
    expect(userProjection.events).toEqual([])
  })

  it("loads a durable queued job through jobs.get", async () => {
    // Given: one persisted queued report job owned by the fixed User.
    const { user } = callers("job_get")
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ('conversation_job_get', 'mvp_user')",
    )
    await context.database.pool.query(
      "insert into runs (id, conversation_id, user_id, runtime, status) values ('run_job_get', 'conversation_job_get', 'mvp_user', 'simple_loop', 'waiting_for_tool')",
    )
    await context.database.pool.query(
      `insert into tool_calls
        (id, run_id, tool_id, tool_version, status, arguments, arguments_hash)
       values ('call_job_get', 'run_job_get', 'report.generate', '1', 'waiting_job',
       '{"topic":"api","sections":["summary"]}'::jsonb, 'hash_job_get')`,
    )
    await context.database.pool.query(
      `insert into jobs
        (ledger_key, namespace, id, run_id, call_id, bullmq_job_id, workflow_identity)
       values ('ledger_job_get', 'api', 'job_get', 'run_job_get', 'call_job_get',
       'bullmq-job-get', 'bullmq/bullmq-job-get')`,
    )

    // When: the User queries the job projection.
    const job = await user.jobs.get({ jobId: "job_get" })

    // Then: only its durable queued envelope is returned.
    expect(job).toMatchObject({ jobId: "job_get", runId: "run_job_get", status: "queued" })
  })
})

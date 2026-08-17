import { describe, expect, it } from "vitest"

import {
  AdminCommandEnvelopeSchema,
  ApprovalEnvelopeSchema,
  JobEnvelopeSchema,
  RunSnapshotSchema,
  SkillSnapshotSchema,
  ToolCallEnvelopeSchema,
  UserProjectionSchema,
} from "../src/index.js"

describe("operation envelopes and snapshots", () => {
  it("parses a selected skill snapshot with exact allowed tools", () => {
    expect(
      SkillSnapshotSchema.parse({
        skillId: "communication_assistant",
        version: "1",
        instructions: "Preview before requesting approval.",
        allowedTools: ["notification.preview", "notification.send_email"],
      }),
    ).toMatchObject({ skillId: "communication_assistant" })
  })

  it("parses a tool call while rejecting status-payload mismatches", () => {
    const prepared = {
      callId: "call_001",
      runId: "run_001",
      toolName: "notification.send_email",
      status: "prepared",
      arguments: { previewId: "preview_001" },
      version: 1,
    }
    expect(ToolCallEnvelopeSchema.parse(prepared)).toMatchObject({ status: "prepared" })
    expect(
      ToolCallEnvelopeSchema.safeParse({
        ...prepared,
        status: "waiting_job",
      }).success,
    ).toBe(false)
    expect(
      ToolCallEnvelopeSchema.safeParse({
        ...prepared,
        toolName: "calculator.evaluate",
      }).success,
    ).toBe(false)
  })

  it("parses immutable approval, job, and Admin command envelopes", () => {
    expect(
      ApprovalEnvelopeSchema.parse({
        approvalId: "approval_001",
        runId: "run_001",
        callId: "call_001",
        toolName: "notification.send_email",
        arguments: { previewId: "preview_001" },
        argumentsHash: "sha256:arguments",
        status: "pending",
        requiredActor: "mvp_admin",
        expiresAt: "2026-08-17T00:00:00.000Z",
        version: 1,
      }),
    ).toMatchObject({ status: "pending" })
    expect(
      JobEnvelopeSchema.parse({
        jobId: "job_001",
        runId: "run_001",
        callId: "call_007",
        status: "running",
        percent: 50,
        version: 2,
      }),
    ).toMatchObject({ percent: 50 })
    expect(
      AdminCommandEnvelopeSchema.parse({
        commandId: "command_001",
        runId: "run_001",
        actorId: "mvp_admin",
        instruction: "hostile-looking text remains data",
        status: "accepted",
        visibility: "model_only",
        expiresAt: "2026-08-17T00:00:00.000Z",
        idempotencyKey: "admin-command-001",
        version: 1,
      }),
    ).toMatchObject({ visibility: "model_only" })
  })

  it("parses a canonical run snapshot with a cursor", () => {
    expect(
      RunSnapshotSchema.parse({
        runId: "run_001",
        conversationId: "conversation_001",
        runtime: "simple_loop",
        status: "waiting_for_user",
        version: 4,
        consumedSteps: 2,
        cursor: { runId: "run_001", sequence: 12, eventId: "event_012" },
      }),
    ).toMatchObject({ status: "waiting_for_user", consumedSteps: 2 })
  })

  it("rejects hidden events embedded in a User projection", () => {
    const run = RunSnapshotSchema.parse({
      runId: "run_001",
      conversationId: "conversation_001",
      runtime: "simple_loop",
      status: "waiting_for_admin",
      version: 2,
      consumedSteps: 2,
      cursor: { runId: "run_001", sequence: 4 },
    })

    expect(
      UserProjectionSchema.safeParse({
        viewer: "user",
        run,
        events: [
          {
            eventId: "event_004",
            runId: "run_001",
            sequence: 4,
            occurredAt: "2026-08-16T10:00:00.000Z",
            correlationId: "correlation_001",
            type: "admin.command.accepted",
            visibility: "model_only",
            payload: { commandId: "command_001", status: "accepted" },
          },
        ],
      }).success,
    ).toBe(false)
  })
})

import { describe, expect, it } from "vitest"

import {
  assertOrderedEvents,
  CanonicalEventSchema,
  ForbiddenVisibilityError,
  NormalizedParityTraceSchema,
  normalizeParityTrace,
  projectEvents,
  RuntimeDiagnosticEventSchema,
} from "../src/index.js"

const baseEvent = {
  eventId: "event_001",
  runId: "run_001",
  sequence: 1,
  occurredAt: "2026-08-16T10:00:00.000Z",
  correlationId: "correlation_001",
}

describe("canonical discrete events", () => {
  it("parses a complete User-visible AI message atomically", () => {
    const event = CanonicalEventSchema.parse({
      ...baseEvent,
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_001", actor: "ai", content: "CHAT_OK" },
    })

    expect(event.type).toBe("message.completed")
    expect(CanonicalEventSchema.safeParse({ ...event, type: "message.delta" }).success).toBe(false)
  })

  it("parses skill.loaded without accepting a tool-call representation", () => {
    expect(
      CanonicalEventSchema.parse({
        ...baseEvent,
        type: "skill.loaded",
        visibility: "user",
        payload: {
          skillId: "calculator_assistant",
          version: "1",
          instructions: "inert registry data",
          allowedTools: ["calculator.evaluate"],
        },
      }),
    ).toMatchObject({ type: "skill.loaded" })
  })

  it("rejects a User-visible Admin command event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...baseEvent,
        type: "admin.command.accepted",
        visibility: "user",
        payload: { commandId: "command_001", status: "accepted" },
      }).success,
    ).toBe(false)
  })

  it("rejects negative and duplicate or out-of-order run sequences", () => {
    const event = {
      ...baseEvent,
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: "queued", current: "running" },
    }
    expect(CanonicalEventSchema.safeParse({ ...event, sequence: -1 }).success).toBe(false)
    expect(() =>
      assertOrderedEvents([
        CanonicalEventSchema.parse({ ...event, sequence: 2 }),
        CanonicalEventSchema.parse({ ...event, eventId: "event_002", sequence: 2 }),
      ]),
    ).toThrow()
  })

  it("rejects an event carrying an illegal run transition", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...baseEvent,
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "completed", current: "running" },
      }).success,
    ).toBe(false)
  })
})

describe("visibility projections", () => {
  const userEvent = CanonicalEventSchema.parse({
    ...baseEvent,
    type: "run.status_changed",
    visibility: "user",
    payload: { previous: "queued", current: "running" },
  })
  const adminEvent = CanonicalEventSchema.parse({
    ...baseEvent,
    eventId: "event_002",
    sequence: 2,
    type: "approval.requested",
    visibility: "admin",
    payload: {
      approvalId: "approval_001",
      callId: "call_001",
      toolName: "notification.send_email",
      argumentsHash: "sha256:arguments",
      expiresAt: "2026-08-17T00:00:00.000Z",
    },
  })
  const modelEvent = CanonicalEventSchema.parse({
    ...baseEvent,
    eventId: "event_003",
    sequence: 3,
    type: "admin.command.accepted",
    visibility: "model_only",
    payload: { commandId: "command_001", status: "accepted" },
  })

  it("returns only User-visible events to the User projection", () => {
    expect(projectEvents([userEvent, adminEvent, modelEvent], "user")).toEqual([userEvent])
  })

  it("returns all shared evidence to the Admin projection", () => {
    expect(projectEvents([userEvent, adminEvent, modelEvent], "admin")).toEqual([
      userEvent,
      adminEvent,
      modelEvent,
    ])
  })

  it("throws a typed error when a forbidden event is projected directly", () => {
    expect(() => projectEvents([adminEvent], "user", { rejectForbidden: true })).toThrow(
      ForbiddenVisibilityError,
    )
  })
})

describe("normalized parity traces", () => {
  it("excludes runtime diagnostics and preserves shared event ordering", () => {
    const started = CanonicalEventSchema.parse({
      ...baseEvent,
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: "queued", current: "running" },
    })
    const diagnostic = RuntimeDiagnosticEventSchema.parse({
      eventId: "diagnostic_001",
      runId: "run_001",
      sequence: 2,
      runtime: "state_workflow",
      type: "runtime.diagnostic",
      occurredAt: "2026-08-16T10:00:01.000Z",
      payload: { state: "THINKING", detail: "history position 42" },
    })
    const completed = CanonicalEventSchema.parse({
      ...baseEvent,
      eventId: "event_003",
      sequence: 3,
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_001", actor: "ai", content: "CHAT_OK" },
    })

    const trace = normalizeParityTrace([started, diagnostic, completed])

    expect(NormalizedParityTraceSchema.parse(trace).events.map((event) => event.type)).toEqual([
      "run.status_changed",
      "message.completed",
    ])
    expect(trace.events.map((event) => event.position)).toEqual([1, 2])
    expect(JSON.stringify(trace)).not.toContain("THINKING")
    expect(JSON.stringify(trace)).not.toContain("state_workflow")
  })
})

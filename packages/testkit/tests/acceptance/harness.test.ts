import {
  AdminProjectionSchema,
  CanonicalEventSchema,
  normalizeParityTrace,
  RunSnapshotSchema,
  UserProjectionSchema,
} from "@agentic-chat/contracts"
import { describe, expect, it } from "vitest"

import {
  assertNormalizedTrace,
  writeAcceptanceFlowEvidence,
  writeNegativeHarnessEvidence,
} from "../../src/index.js"

const actualF01Observation = () => {
  const runId = "run_actual_f01"
  const eventCandidates = [
    {
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_user_actual", actor: "user", content: "P01" },
    },
    {
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: "queued", current: "running" },
    },
    {
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_ai_actual", actor: "ai", content: "CHAT_OK" },
    },
    {
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: "running", current: "completed" },
    },
  ] as const
  const events = eventCandidates.map((candidate, index) =>
    CanonicalEventSchema.parse({
      ...candidate,
      eventId: `event_actual_${index + 1}`,
      runId,
      sequence: index + 1,
      correlationId: "correlation_actual_f01",
      occurredAt: "2026-08-17T12:00:00.000Z",
    }),
  )
  const run = RunSnapshotSchema.parse({
    runId,
    conversationId: "conversation_actual_f01",
    runtime: "simple_loop",
    status: "completed",
    version: 2,
    consumedSteps: 1,
    cursor: { runId, sequence: events.length },
  })
  return {
    metadata: {
      runtime: "simple_loop",
      testId: "F01",
      promptId: "P01",
      fixtureNamespace: "actual_f01",
      testFile: "harness.test.ts",
      testTitle: "actual F01",
      runtimeDiagnostics: [{ providerInvocations: 1 }],
      executionOutcome: { status: "completed", text: "CHAT_OK" },
    },
    runId,
    actors: [
      { actor: "mvp_user", action: "message" },
      { actor: "ai", action: "final_response" },
    ],
    stableIds: { runId, callIds: [], jobIds: [], approvalIds: [], commandIds: [] },
    observedSkill: null,
    observedToolCalls: [],
    observedApprovals: [],
    observedJobs: [],
    finalResponse: "CHAT_OK",
    finalStatus: "completed",
    projections: {
      user: UserProjectionSchema.parse({ viewer: "user", run, events }),
      admin: AdminProjectionSchema.parse({ viewer: "admin", run, events }),
    },
    normalizedEventTrace: normalizeParityTrace(events),
  } as const
}

describe("actual acceptance evidence integrity", () => {
  it("refuses PASS evidence when a passing test provides no actual capture", async () => {
    // Given: a status-only caller supplies runtime and flow but no persisted observation.
    const statusOnlyEmission = writeAcceptanceFlowEvidence("simple_loop", "F01")

    // When/Then: no PASS record can be produced without an actual runtime capture.
    await expect(statusOnlyEmission).rejects.toThrow("actual acceptance capture is required")
  })

  it("rejects substituted expected-catalog data as observed evidence", async () => {
    // Given: the former fabricated record shape carries expected values but no capture metadata.
    const substitutedCatalogRecord = {
      runtime: "simple_loop",
      testId: "F01",
      promptId: "P01",
      runId: "run_acceptance_simple_loop_p01",
      result: "PASS",
    }

    // When/Then: schema validation rejects the substituted expected data before writing.
    await expect(writeAcceptanceFlowEvidence(substitutedCatalogRecord)).rejects.toThrow(
      "actual acceptance capture is required",
    )
  })

  it("rejects an altered actual trace even when the surrounding execution passed", async () => {
    // Given: a complete actual capture whose normalized trace payload was altered after capture.
    const actual = actualF01Observation()
    const altered = {
      ...actual,
      normalizedEventTrace: {
        events: actual.normalizedEventTrace.events.map((event) =>
          event.type === "message.completed" &&
          "actor" in event.payload &&
          event.payload.actor === "ai"
            ? { ...event, payload: { ...event.payload, content: "ALTERED" } }
            : event,
        ),
      },
    }

    // When/Then: projection-versus-trace comparison prevents a fabricated PASS record.
    await expect(writeAcceptanceFlowEvidence(altered)).rejects.toThrow(
      "Normalized acceptance trace mismatch",
    )
  })

  it("reports a useful diff for an altered actual event", async () => {
    // Given: actual and substituted traces differ in one machine-consumed payload.
    const expected = actualF01Observation().normalizedEventTrace
    const altered = {
      events: expected.events.map((event) =>
        event.type === "message.completed" &&
        "actor" in event.payload &&
        event.payload.actor === "ai"
          ? { ...event, payload: { ...event.payload, content: "ALTERED" } }
          : event,
      ),
    }

    // When: strict normalized comparison receives the altered actual trace.
    let failureDetails = ""
    try {
      assertNormalizedTrace(altered, expected)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      failureDetails = error.message
    }

    // Then: the evidence preserves an actionable expected/actual diff.
    expect(failureDetails).toContain("Normalized acceptance trace mismatch")
    expect(failureDetails).toContain("ALTERED")
    expect(failureDetails).toContain("CHAT_OK")
    await writeNegativeHarnessEvidence(failureDetails)
  })
})

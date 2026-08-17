import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { type NormalizedParityTrace, normalizeParityTrace } from "@agentic-chat/contracts"
import type { DatabaseClient } from "@agentic-chat/db"

import { expectedAcceptanceContract } from "./acceptance-expectations.js"
import { captureActualAcceptance, digestObservedAcceptance } from "./acceptance-observation.js"
import {
  ACCEPTANCE_FLOWS,
  ACCEPTANCE_RUNTIMES,
  type AcceptanceCaptureMetadata,
  AcceptanceCaptureMetadataSchema,
  type AcceptanceMatrixCell,
  type AcceptancePromptId,
  type AcceptanceRecord,
  AcceptanceRecordSchema,
  type ObservedAcceptanceCapture,
  ObservedAcceptanceCaptureSchema,
} from "./acceptance-types.js"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const acceptanceRoot = `${workspace}/artifacts/validation/acceptance`

export class AcceptanceEvidenceError extends Error {
  readonly name = "AcceptanceEvidenceError"
}

export const assertNormalizedTrace = (
  actual: NormalizedParityTrace,
  expected: NormalizedParityTrace,
): void => {
  assert.deepStrictEqual(actual, expected, "Normalized acceptance trace mismatch")
}

const assertProjectionPrivacy = (observation: ObservedAcceptanceCapture): void => {
  assert.equal(observation.projections.user.run.runtime, observation.metadata.runtime)
  assert.equal(observation.projections.admin.run.runtime, observation.metadata.runtime)
  assert.equal(observation.projections.user.run.runId, observation.runId)
  assert.equal(observation.projections.admin.run.runId, observation.runId)
  assert.ok(observation.projections.user.events.every((event) => event.visibility === "user"))
  const serializedUser = JSON.stringify(observation.projections.user)
  assert.equal(serializedUser.includes("mvp_admin"), false)
  assert.equal(serializedUser.includes("MVP rejection test"), false)
  assert.equal(serializedUser.includes("admin.command"), false)
  assert.equal(serializedUser.includes("message.delta"), false)
}

const assertExpectedObservation = (observation: ObservedAcceptanceCapture): void => {
  const expected = expectedAcceptanceContract(
    observation.metadata.runtime,
    observation.metadata.promptId,
  )
  assert.equal(observation.finalStatus, expected.finalStatus)
  assert.equal(observation.finalResponse, expected.finalResponse)
  assert.equal(observation.observedSkill?.skillId ?? null, expected.skillId)
  assert.deepStrictEqual(
    observation.observedToolCalls.map((call) => ({
      toolName: call.toolName,
      status: call.status,
    })),
    expected.calls,
    "Actual tool calls differ from the expected scenario contract",
  )
  assert.deepStrictEqual(
    observation.normalizedEventTrace.events.map((event) => ({
      type: event.type,
      visibility: event.visibility,
    })),
    expected.trace,
    "Actual normalized trace differs from the expected trace",
  )
}

const assertActualCapture = (observation: ObservedAcceptanceCapture): void => {
  assert.equal(observation.runId, observation.stableIds.runId)
  assert.equal(observation.runId.startsWith("run_acceptance_"), false)
  assert.equal(new Set(observation.stableIds.callIds).size, observation.stableIds.callIds.length)
  assert.deepStrictEqual(
    observation.observedToolCalls.map((call) => call.callId),
    observation.stableIds.callIds,
  )
  assertNormalizedTrace(
    normalizeParityTrace(observation.projections.admin.events),
    observation.normalizedEventTrace,
  )
  assertProjectionPrivacy(observation)
  assertExpectedObservation(observation)
}

export const writeAcceptanceFlowEvidence = async (
  unparsedObservation?: unknown,
  _legacyFlow?: unknown,
): Promise<AcceptanceRecord> => {
  const parsed = ObservedAcceptanceCaptureSchema.safeParse(unparsedObservation)
  if (!parsed.success) {
    throw new AcceptanceEvidenceError("actual acceptance capture is required before PASS evidence")
  }
  const observation = parsed.data
  assertActualCapture(observation)
  const evidenceLink = `acceptance/${observation.metadata.runtime}/${observation.metadata.testId}/${observation.metadata.promptId}.json`
  const record = AcceptanceRecordSchema.parse({
    ...observation,
    schemaVersion: 2,
    provenance: {
      source: "postgresql_projection_capture",
      capturedRunId: observation.runId,
      processId: process.pid,
      observationDigest: digestObservedAcceptance(observation),
    },
    observedApprovalJobEvents: observation.normalizedEventTrace.events.filter(
      (event) =>
        event.type.startsWith("approval.") ||
        event.type.startsWith("job.") ||
        event.type.startsWith("admin.command."),
    ),
    result: "PASS",
    failureDetails: null,
    evidenceLinks: [evidenceLink],
  })
  const directory = `${acceptanceRoot}/${record.metadata.runtime}/${record.metadata.testId}`
  await mkdir(directory, { recursive: true })
  await writeFile(
    `${directory}/${record.metadata.promptId}.json`,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  )
  return record
}

export const captureAndWriteAcceptanceEvidence = async (
  database: DatabaseClient,
  input: { readonly runId: string; readonly metadata: AcceptanceCaptureMetadata },
): Promise<AcceptanceRecord> =>
  writeAcceptanceFlowEvidence(await captureActualAcceptance(database, input))

export const captureAcceptanceFromEnvironment = async (
  database: DatabaseClient,
  input: {
    readonly runId: string
    readonly fixtureNamespace: string
    readonly runtimeDiagnostics: readonly Readonly<Record<string, unknown>>[]
    readonly executionOutcome: unknown
  },
): Promise<AcceptanceRecord | undefined> => {
  const runtime = process.env["ACCEPTANCE_CAPTURE_RUNTIME"]
  if (runtime === undefined) return undefined
  const metadata = AcceptanceCaptureMetadataSchema.parse({
    runtime,
    testId: process.env["ACCEPTANCE_CAPTURE_FLOW"],
    promptId: process.env["ACCEPTANCE_CAPTURE_PROMPT"],
    fixtureNamespace: input.fixtureNamespace,
    testFile: process.env["ACCEPTANCE_CAPTURE_FILE"],
    testTitle: process.env["ACCEPTANCE_CAPTURE_TITLE"],
    runtimeDiagnostics: input.runtimeDiagnostics,
    executionOutcome: input.executionOutcome,
  })
  return captureAndWriteAcceptanceEvidence(database, { runId: input.runId, metadata })
}

const promptsByFlow = {
  F01: ["P01"],
  F02: ["P02"],
  F03: ["P03"],
  F04: ["P04"],
  F05: ["P05", "P06"],
  F06: ["P07"],
  F07: ["P08"],
  F08: ["P09"],
  F09: ["P10"],
  F10: ["P11"],
} as const satisfies Readonly<
  Record<(typeof ACCEPTANCE_FLOWS)[number], readonly AcceptancePromptId[]>
>

export const createAcceptanceMatrix = (
  records: readonly AcceptanceRecord[],
): readonly AcceptanceMatrixCell[] => {
  const cells = ACCEPTANCE_RUNTIMES.flatMap((runtime) =>
    ACCEPTANCE_FLOWS.map((testId) => {
      const matching = records.filter(
        (record) => record.metadata.runtime === runtime && record.metadata.testId === testId,
      )
      assert.deepStrictEqual(
        matching.map((record) => record.metadata.promptId).sort(),
        [...promptsByFlow[testId]].sort(),
        `Incomplete acceptance cell ${runtime}/${testId}`,
      )
      return {
        testId,
        runtime,
        promptIds: matching.map((record) => record.metadata.promptId),
        result: "PASS" as const,
        evidenceLinks: matching.flatMap((record) => record.evidenceLinks),
      }
    }),
  )
  assert.equal(cells.length, 20)
  return cells
}

export const writeNegativeHarnessEvidence = async (details: string): Promise<void> => {
  const directory = `${acceptanceRoot}/harness-negative`
  await mkdir(directory, { recursive: true })
  await writeFile(
    `${directory}/altered-event.json`,
    `${JSON.stringify({ result: "PASS", injectedMutation: "actual normalized event", acceptanceFailure: details }, null, 2)}\n`,
    "utf8",
  )
}

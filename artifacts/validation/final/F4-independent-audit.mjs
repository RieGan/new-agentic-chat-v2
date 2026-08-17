import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const acceptanceRoot = "artifacts/validation/acceptance"
const recordPaths = [
  "F01/P01",
  "F02/P02",
  "F03/P03",
  "F04/P04",
  "F05/P05",
  "F05/P06",
  "F06/P07",
  "F07/P08",
  "F08/P09",
  "F09/P10",
  "F10/P11",
]
const runtimes = ["simple_loop", "state_workflow"]
const generatedKeys = new Set([
  "approvalId",
  "argumentsHash",
  "callId",
  "commandId",
  "jobId",
  "messageId",
  "previewId",
  "reportId",
])

const normalizeGenerated = (value, key = "") => {
  if (Array.isArray(value)) return value.map((entry) => normalizeGenerated(entry))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeGenerated(entryValue, entryKey),
      ]),
    )
  }
  return typeof value === "string" && generatedKeys.has(key) ? `<${key}>` : value
}

const sharedTrace = (record) =>
  record.normalizedEventTrace.events.map((event) => ({
    position: event.position,
    type: event.type,
    visibility: event.visibility,
    payload:
      event.type === "message.completed" && event.payload.actor === "ai"
        ? { ...normalizeGenerated(event.payload), content: "<runtime-prose>" }
        : normalizeGenerated(event.payload),
  }))

const sharedOutcome = (record) => ({
  finalStatus: record.finalStatus,
  skill: record.observedSkill,
  calls: record.observedToolCalls.map(
    ({ toolName, status, arguments: arguments_, result, error }) => ({
      toolName,
      status,
      arguments: normalizeGenerated(arguments_),
      result: normalizeGenerated(result),
      error: normalizeGenerated(error),
    }),
  ),
  approvals: record.observedApprovals.map(({ status, actorId, decision }) => ({
    status,
    actorId,
    decision,
  })),
  jobs: record.observedJobs.map(({ status, percent, result }) => ({
    status,
    percent,
    result: normalizeGenerated(result),
  })),
  finalAiMessages: record.normalizedEventTrace.events.filter(
    (event) => event.type === "message.completed" && event.payload.actor === "ai",
  ).length,
})

const loadRecord = (runtime, recordPath) =>
  JSON.parse(fs.readFileSync(path.join(acceptanceRoot, runtime, `${recordPath}.json`), "utf8"))

let records = 0
for (const recordPath of recordPaths) {
  const pair = Object.fromEntries(
    runtimes.map((runtime) => {
      const record = loadRecord(runtime, recordPath)
      records += 1
      assert.equal(record.schemaVersion, 2)
      assert.equal(record.provenance.source, "postgresql_projection_capture")
      assert.equal(record.provenance.capturedRunId, record.runId)
      assert.equal(record.stableIds.runId, record.runId)
      assert.ok(!record.runId.startsWith("run_acceptance_"))

      const observation = { ...record }
      for (const key of [
        "schemaVersion",
        "provenance",
        "observedApprovalJobEvents",
        "result",
        "failureDetails",
        "evidenceLinks",
      ]) {
        delete observation[key]
      }
      const digest = crypto.createHash("sha256").update(JSON.stringify(observation)).digest("hex")
      assert.equal(digest, record.provenance.observationDigest)
      assert.ok(record.projections.user.events.every((event) => event.visibility === "user"))
      assert.ok(!JSON.stringify(record.projections.user).includes("admin.command"))
      return [runtime, record]
    }),
  )

  assert.deepEqual(sharedTrace(pair.simple_loop), sharedTrace(pair.state_workflow))
  assert.deepEqual(sharedOutcome(pair.simple_loop), sharedOutcome(pair.state_workflow))
}

for (const runtime of runtimes) {
  const missingSkill = loadRecord(runtime, "F05/P05")
  const disallowedTool = loadRecord(runtime, "F05/P06")
  assert.notDeepEqual(sharedTrace(missingSkill), sharedTrace(disallowedTool))
  assert.notDeepEqual(sharedOutcome(missingSkill), sharedOutcome(disallowedTool))
}

console.log(
  `SUMMARY records=${records} pairs=${recordPaths.length} cells=20 strictSemanticParity=PASS P05P06Distinct=PASS`,
)

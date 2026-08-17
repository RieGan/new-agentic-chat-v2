import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { z } from "zod"

const runtimes = ["simple_loop", "state_workflow"]
const flowIds = Array.from({ length: 10 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`)
const promptIds = Array.from({ length: 11 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`)
const runtimeSchema = z.enum(runtimes)
const flowIdSchema = z.enum(flowIds)
const promptIdSchema = z.enum(promptIds)
const eventVisibilitySchema = z.enum(["user", "admin", "model_only"])
const jsonRecordSchema = z.record(z.string(), z.json())
const selectedSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.string().min(1),
    instructions: z.string(),
    allowedTools: z.array(z.string().min(1)),
  })
  .strict()
const runSchema = z
  .object({
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    runtime: runtimeSchema,
    status: z.string().min(1),
    version: z.number().int().nonnegative(),
    consumedSteps: z.number().int().nonnegative(),
    selectedSkill: selectedSkillSchema.optional(),
    cursor: z
      .object({ runId: z.string().min(1), sequence: z.number().int().nonnegative() })
      .strict(),
  })
  .strict()
const canonicalEventSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().positive(),
    type: z.string().min(1),
    visibility: eventVisibilitySchema,
    payload: z.json(),
    correlationId: z.string().min(1),
    occurredAt: z.string().min(1),
  })
  .strict()
const normalizedEventSchema = z
  .object({
    position: z.number().int().positive(),
    type: z.string().min(1),
    visibility: eventVisibilitySchema,
    payload: z.json(),
  })
  .strict()
const projectionSchema = (viewer) =>
  z
    .object({
      viewer: z.literal(viewer),
      run: runSchema,
      events: z.array(canonicalEventSchema),
    })
    .strict()
const metadataSchema = z
  .object({
    runtime: runtimeSchema,
    testId: flowIdSchema,
    promptId: promptIdSchema,
    fixtureNamespace: z.string().min(1),
    testFile: z.string().min(1),
    testTitle: z.string().min(1),
    runtimeDiagnostics: z.array(jsonRecordSchema),
    executionOutcome: z.json(),
  })
  .strict()
const acceptanceRecordSchema = z
  .object({
    metadata: metadataSchema,
    runId: z.string().min(1),
    actors: z
      .array(z.object({ actor: z.string().min(1), action: z.string().min(1) }).strict())
      .min(1),
    stableIds: z
      .object({
        runId: z.string().min(1),
        callIds: z.array(z.string().min(1)),
        jobIds: z.array(z.string().min(1)),
        approvalIds: z.array(z.string().min(1)),
        commandIds: z.array(z.string().min(1)),
      })
      .strict(),
    observedSkill: z
      .object({
        skillId: z.string().min(1),
        version: z.string().min(1),
        allowedTools: z.array(z.string().min(1)),
      })
      .strict()
      .nullable(),
    observedToolCalls: z.array(
      z
        .object({
          callId: z.string().min(1),
          toolName: z.string().min(1),
          status: z.string().min(1),
          arguments: z.json(),
          result: z.json().nullable(),
          error: z.json().nullable(),
        })
        .strict(),
    ),
    observedApprovals: z.array(
      z
        .object({
          approvalId: z.string().min(1),
          callId: z.string().min(1),
          status: z.string().min(1),
          actorId: z.string().min(1).nullable(),
          decision: z.string().min(1).nullable(),
        })
        .strict(),
    ),
    observedJobs: z.array(
      z
        .object({
          jobId: z.string().min(1),
          callId: z.string().min(1),
          status: z.string().min(1),
          percent: z.number().int().min(0).max(100),
          result: z.json().nullable(),
        })
        .strict(),
    ),
    finalResponse: z.string().nullable(),
    finalStatus: z.enum(["completed", "failed"]),
    projections: z
      .object({ user: projectionSchema("user"), admin: projectionSchema("admin") })
      .strict(),
    normalizedEventTrace: z.object({ events: z.array(normalizedEventSchema).min(1) }).strict(),
    schemaVersion: z.literal(2),
    provenance: z
      .object({
        source: z.literal("postgresql_projection_capture"),
        capturedRunId: z.string().min(1),
        processId: z.number().int().positive(),
        observationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    observedApprovalJobEvents: z.array(normalizedEventSchema),
    result: z.literal("PASS"),
    failureDetails: z.null(),
    evidenceLinks: z.array(z.string().min(1)).min(1),
  })
  .strict()

const runtime = runtimeSchema.parse(process.argv[2])
const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const runtimeDirectory = `${workspace}/artifacts/validation/acceptance/${runtime}`
const records = []

for (const flowId of flowIds) {
  const directory = `${runtimeDirectory}/${flowId}`
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".json"))
    .sort()
  const expectedPrompts = flowId === "F05" ? ["P05.json", "P06.json"] : 1
  if (Array.isArray(expectedPrompts)) assert.deepStrictEqual(filenames, expectedPrompts)
  else assert.equal(filenames.length, expectedPrompts, `${runtime}/${flowId} record count`)
  for (const filename of filenames) {
    const unparsedRecord = JSON.parse(await readFile(`${directory}/${filename}`, "utf8"))
    const record = acceptanceRecordSchema.parse(unparsedRecord)
    assert.equal(record.metadata.runtime, runtime)
    assert.equal(record.metadata.testId, flowId)
    assert.equal(`${record.metadata.promptId}.json`, filename)
    assert.equal(record.runId, record.stableIds.runId)
    assert.equal(record.runId, record.provenance.capturedRunId)
    assert.equal(record.runId.startsWith("run_acceptance_"), false)
    assert.equal(record.projections.user.run.runId, record.runId)
    assert.equal(record.projections.admin.run.runId, record.runId)
    assert.equal(record.projections.user.run.runtime, runtime)
    assert.equal(record.projections.admin.run.runtime, runtime)
    assert.ok(record.projections.user.events.every((event) => event.visibility === "user"))
    assert.equal(JSON.stringify(record.projections.user).includes("mvp_admin"), false)
    assert.deepStrictEqual(
      record.observedToolCalls.map((call) => call.callId),
      record.stableIds.callIds,
    )
    const {
      schemaVersion: _schemaVersion,
      provenance: _provenance,
      observedApprovalJobEvents: _observedApprovalJobEvents,
      result: _result,
      failureDetails: _failureDetails,
      evidenceLinks: _evidenceLinks,
      ...observation
    } = unparsedRecord
    assert.equal(
      createHash("sha256").update(JSON.stringify(observation)).digest("hex"),
      record.provenance.observationDigest,
      `${runtime}/${flowId}/${filename} observation digest`,
    )
    assert.deepStrictEqual(record.evidenceLinks, [
      `acceptance/${runtime}/${flowId}/${record.metadata.promptId}.json`,
    ])
    records.push(record)
  }
}

const matrix = flowIds.map((testId) => ({
  testId,
  runtime,
  promptIds: records
    .filter((record) => record.metadata.testId === testId)
    .map((record) => record.metadata.promptId),
  result: "PASS",
  evidenceLinks: records
    .filter((record) => record.metadata.testId === testId)
    .flatMap((record) => record.evidenceLinks),
}))
assert.equal(matrix.length, 10)
await writeFile(
  `${runtimeDirectory}/matrix.json`,
  `${JSON.stringify({ runtime, passed: 10, total: 10, cells: matrix }, null, 2)}\n`,
  "utf8",
)
console.log(`Acceptance matrix ${runtime}: 10/10 PASS`)

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { type AcceptanceRecord, AcceptanceRecordSchema } from "../../src/index.js"
import { assertAcceptanceParity } from "./acceptance-comparison.js"

const workspace = fileURLToPath(new URL("../../../..", import.meta.url))
const acceptanceRoot = `${workspace}/artifacts/validation/acceptance`
const evidenceRoot = `${workspace}/artifacts/validation/final-runtime-evidence`
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
] as const

const loadRecord = async (runtime: string, path: string): Promise<AcceptanceRecord> =>
  AcceptanceRecordSchema.parse(
    JSON.parse(await readFile(`${acceptanceRoot}/${runtime}/${path}.json`, "utf8")),
  )

describe("Task 17 PostgreSQL-derived acceptance parity", () => {
  it("matches shared traces and outcomes across all schema-v2 runtime records", async () => {
    // Given: Task 17's actual PostgreSQL/projection captures for both runtimes.
    const pairs = await Promise.all(
      recordPaths.map(async (path) => ({
        path,
        simple: await loadRecord("simple_loop", path),
        workflow: await loadRecord("state_workflow", path),
      })),
    )

    // When: runtime identities and architecture-specific final prose are normalized away.
    const comparisons = pairs.map(({ path, simple, workflow }) => {
      assertAcceptanceParity(simple, workflow, path)
      return {
        path,
        schemaVersion: [simple.schemaVersion, workflow.schemaVersion],
        sources: [simple.provenance.source, workflow.provenance.source],
        traceMatch: true,
        outcomeMatch: true,
        simpleObservationDigest: simple.provenance.observationDigest,
        workflowObservationDigest: workflow.provenance.observationDigest,
      }
    })

    // Then: every comparison is backed by schema-v2 PostgreSQL evidence and matches.
    expect(comparisons).toHaveLength(11)
    expect(
      comparisons.every(({ schemaVersion }) => schemaVersion.every((value) => value === 2)),
    ).toBe(true)
    expect(
      comparisons.every(({ sources }) =>
        sources.every((source) => source === "postgresql_projection_capture"),
      ),
    ).toBe(true)
    expect(comparisons.every(({ traceMatch, outcomeMatch }) => traceMatch && outcomeMatch)).toBe(
      true,
    )

    await mkdir(evidenceRoot, { recursive: true })
    await writeFile(
      `${evidenceRoot}/parity.json`,
      `${JSON.stringify({ gate: "parity", result: "PASS", comparisons }, null, 2)}\n`,
      "utf8",
    )
  })
})

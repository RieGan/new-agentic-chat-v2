import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"

import { expect, type TestInfo } from "@playwright/test"
import { z } from "zod"

import { composeRuntime, targetWorker } from "./compose-browser-env.js"

const runIdSchema = z.string().regex(/^run_[a-z0-9-]+$/u)

const execute = (arguments_: readonly string[]): string => {
  const result = spawnSync("docker", ["compose", ...arguments_], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
  expect(result.status, "sanitized Docker evidence command status").toBe(0)
  return result.stdout
}

export const attachCorrelationEvidence = async (
  testInfo: TestInfo,
  input: {
    readonly runId: string
    readonly startedAt: string
    readonly kind: "report" | "approval"
  },
): Promise<void> => {
  const runId = runIdSchema.parse(input.runId)
  const query = `select r.id, r.runtime, r.status,
    (select count(*) from messages m where m.run_id = r.id and m.actor = 'ai') ai_messages,
    (select count(*) from jobs j where j.run_id = r.id) jobs,
    (select count(*) from approval_requests a where a.run_id = r.id) approvals,
    (select count(*) from simulated_sends s join tool_calls c on c.id = s.call_id where c.run_id = r.id) sends,
    coalesce((select max(a.status::text) from approval_requests a where a.run_id = r.id), 'none') approval_status
    from runs r where r.id = '${runId}'`
  const database = execute([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "agentic_chat",
    "-d",
    "agentic_chat",
    "-At",
    "-F",
    "|",
    "-c",
    query,
  ]).trim()
  const expectedDatabase =
    input.kind === "report"
      ? `${runId}|${composeRuntime}|completed|1|1|0|0|none`
      : `${runId}|${composeRuntime}|completed|1|0|1|${composeRuntime === "simple_loop" ? "1|approved" : "0|rejected"}`
  expect(database).toBe(expectedDatabase)

  const rawLogs = execute(["logs", "--no-color", "--since", input.startedAt, targetWorker])
  const workerMarkers = rawLogs
    .split("\n")
    .filter((line) =>
      composeRuntime === "simple_loop"
        ? line.includes(runId)
        : line.includes('"event":"workflow.reconcile"'),
    )
    .map((line) => line.slice(line.indexOf("{")))
    .filter((line) => line.startsWith("{"))
  expect(workerMarkers.length, `correlation marker from ${targetWorker}`).toBeGreaterThan(0)
  const evidence = {
    runId,
    runtime: composeRuntime,
    database,
    worker: targetWorker,
    workerMarkers,
  }
  const path = testInfo.outputPath(`correlation-${runId}.json`)
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await testInfo.attach(`correlation-${runId}`, {
    path,
    contentType: "application/json",
  })
}

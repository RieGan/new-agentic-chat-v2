import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const evidenceRoot = `${workspace}/artifacts/validation/final-runtime-evidence`
const started = performance.now()
const result = spawnSync(
  "corepack",
  ["pnpm", "exec", "vitest", "run", "tests/parity", "--passWithNoTests"],
  { cwd: packageRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
)
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

assert.equal(result.status, 0, output)
assert.match(output, /Tests\s+25 passed/)

const countSourceLines = (directory) =>
  readdirSync(directory).reduce((total, entry) => {
    const path = `${directory}/${entry}`
    if (statSync(path).isDirectory()) return total + countSourceLines(path)
    if (!entry.endsWith(".ts")) return total
    return (
      total +
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length
    )
  }, 0)

const readEvidence = (name) => {
  const path = `${evidenceRoot}/${name}.json`
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null
}

const restart = readEvidence("restart")
const replay = readEvidence("temporal-replay")
const parity = readEvidence("parity")
const parityDurationMs = Math.round(performance.now() - started)
const complexity = {
  simpleLoopSourceLines: countSourceLines(`${workspace}/packages/runtime/src/simple-loop`),
  stateWorkflowSourceLines: countSourceLines(`${workspace}/packages/runtime/src/state-workflow`),
}
const report = `# Runtime comparison\n\n## Release gates\n\n| Gate | Result | Evidence |\n| --- | --- | --- |\n| Isolated restart and adversarial delivery | ${restart?.result ?? "PENDING"} | final-runtime-evidence/restart.json |\n| Task 17 schema-v2 parity | ${parity?.result ?? "FAIL"} | final-runtime-evidence/parity.json |\n| Temporal history replay | ${replay?.result ?? "PENDING"} | final-runtime-evidence/temporal-replay.json |\n\nRelease gates have exact PASS criteria. PENDING is not accepted as a completed release result.\n\n## Non-gating measurements\n\nThese observations have no pass threshold and do not select a runtime by themselves.\n\n| Measurement | Simple Loop | State Workflow |\n| --- | ---: | ---: |\n| Compose worker health recovery (ms) | ${restart?.scenarios?.find((entry) => entry.runtime === "simple_loop")?.recoveryMs ?? "pending"} | ${restart?.scenarios?.find((entry) => entry.runtime === "state_workflow")?.recoveryMs ?? "pending"} |\n| Runtime-specific source lines | ${complexity.simpleLoopSourceLines} | ${complexity.stateWorkflowSourceLines} |\n| Shared parity gate duration (ms) | ${parityDurationMs} | ${parityDurationMs} |\n\nTask 17 records do not contain per-flow wall-clock latency, so this report does not fabricate F01/F03 median or p95 values. Recovery and implementation complexity remain measured observations without release thresholds.\n`

mkdirSync(evidenceRoot, { recursive: true })
writeFileSync(`${evidenceRoot}/comparison.md`, report)
writeFileSync(
  `${evidenceRoot}/comparison.json`,
  `${JSON.stringify(
    {
      gates: {
        restart: restart?.result ?? "PENDING",
        parity: parity?.result ?? "FAIL",
        temporalReplay: replay?.result ?? "PENDING",
      },
      measurements: { gate: false, thresholds: null, parityDurationMs, complexity },
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")

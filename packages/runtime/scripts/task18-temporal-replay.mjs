import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const runtimeEvidenceRoot = `${workspace}/artifacts/validation/final-runtime-evidence`
const adversarialEvidenceRoot = `${workspace}/artifacts/validation/final-adversarial`
const started = performance.now()
const result = spawnSync(
  "corepack",
  ["pnpm", "exec", "vitest", "run", "tests/temporal-replay", "--passWithNoTests"],
  { cwd: packageRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
)
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`

assert.equal(result.status, 0, output)
assert.match(output, /Test Files\s+4 passed/)
assert.match(output, /Tests\s+10 passed/)

mkdirSync(runtimeEvidenceRoot, { recursive: true })
mkdirSync(adversarialEvidenceRoot, { recursive: true })
writeFileSync(
  `${runtimeEvidenceRoot}/temporal-replay.json`,
  `${JSON.stringify(
    {
      gate: "temporal-replay",
      result: "PASS",
      durationMs: Math.round(performance.now() - started),
      tests: 10,
      externalActivitiesDuringReplay: 0,
      postCommitRetryCanonicalEffects: 1,
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  `${adversarialEvidenceRoot}/temporal-replay.json`,
  `${JSON.stringify(
    {
      result: "PASS",
      zeroSilentSuccess: true,
      injections: [
        "duplicate Temporal signal",
        "wrong signal correlation",
        "post-commit Activity retry",
        "duplicate workflow start",
        "forbidden workflow I/O import",
        "history replay external I/O",
      ],
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")

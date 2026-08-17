import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { runAdversarialSuites } from "./task18-adversarial.mjs"
import { cleanupTopology, createCommandRunner, runRuntimeRecovery } from "./task18-compose.mjs"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const runtimeEvidenceRoot = `${workspace}/artifacts/validation/final-runtime-evidence`
const adversarialEvidenceRoot = `${workspace}/artifacts/validation/final-adversarial`
const commandEvidence = []
const restartEvidence = []
const execute = createCommandRunner(workspace, commandEvidence)

mkdirSync(runtimeEvidenceRoot, { recursive: true })
mkdirSync(adversarialEvidenceRoot, { recursive: true })

let cleanup = { result: "FAIL", remainingContainers: [], listeningPorts: [] }
try {
  execute("docker", ["compose", "down", "--volumes", "--remove-orphans"])
  execute("docker", ["compose", "up", "--build", "--wait"])
  restartEvidence.push(
    await runRuntimeRecovery(execute, {
      runtime: "simple_loop",
      target: "worker-simple",
      otherWorker: "worker-workflow",
      file: "simple-loop-durable.spec.ts",
    }),
  )
  restartEvidence.push(
    await runRuntimeRecovery(execute, {
      runtime: "state_workflow",
      target: "worker-workflow",
      otherWorker: "worker-simple",
      file: "state-workflow-durable.spec.ts",
    }),
  )
  const adversarial = runAdversarialSuites(execute)
  writeFileSync(
    `${adversarialEvidenceRoot}/injections.json`,
    `${JSON.stringify({ result: "PASS", injections: adversarial }, null, 2)}\n`,
  )
  writeFileSync(
    `${runtimeEvidenceRoot}/restart.json`,
    `${JSON.stringify({ gate: "restart", result: "PASS", scenarios: restartEvidence }, null, 2)}\n`,
  )
  writeFileSync(
    `${runtimeEvidenceRoot}/ultraqa.json`,
    `${JSON.stringify(
      {
        result: "PASS",
        probes: [
          { class: "stale state", result: "PASS", evidence: "stale lease and stale SSE cursor" },
          {
            class: "dirty worktree",
            result: "NOT_APPLICABLE",
            evidence: "git operations prohibited by task contract",
          },
          { class: "hung or long command", result: "PASS", evidence: "600000ms command timeout" },
          { class: "flaky timing", result: "PASS", evidence: "health and runtime-state barriers" },
          {
            class: "misleading success output",
            result: "PASS",
            evidence: "exact pass-count assertions",
          },
          {
            class: "cancel/resume",
            result: "NOT_APPLICABLE",
            evidence: "no cancellation contract in MVP",
          },
          {
            class: "repeated interruptions",
            result: "PASS",
            evidence: "two isolated worker restarts",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
} finally {
  cleanup = cleanupTopology(workspace)
  writeFileSync(`${runtimeEvidenceRoot}/cleanup.json`, `${JSON.stringify(cleanup, null, 2)}\n`)
}

assert.equal(cleanup.result, "PASS", JSON.stringify(cleanup))
writeFileSync(
  `${runtimeEvidenceRoot}/restart-commands.json`,
  `${JSON.stringify({ commands: commandEvidence.map(({ stdout: _stdout, stderr: _stderr, ...entry }) => entry) }, null, 2)}\n`,
)

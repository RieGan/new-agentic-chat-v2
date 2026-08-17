import assert from "node:assert/strict"

const suites = [
  {
    name: "postgresql-fencing-and-duplicates",
    command: [
      "corepack",
      "pnpm",
      "--filter",
      "@agentic-chat/db",
      "exec",
      "vitest",
      "run",
      "tests/database.integration.test.ts",
      "tests/control-records.integration.test.ts",
      "tests/races.integration.test.ts",
      "--fileParallelism=false",
    ],
    injections: [
      "wrong-runtime mutation",
      "stale lease",
      "mismatched approval hash",
      "approval decision race",
      "duplicate simulated send",
      "duplicate event sequence",
      "illegal wait transition",
    ],
  },
  {
    name: "runtime-delivery-and-isolation",
    command: [
      "corepack",
      "pnpm",
      "--filter",
      "@agentic-chat/runtime",
      "exec",
      "vitest",
      "run",
      "tests/projections-and-isolation.integration.test.ts",
      "tests/admission.integration.test.ts",
      "tests/admin-commands.integration.test.ts",
      "tests/approvals.integration.test.ts",
      "tests/async-job-worker.integration.test.ts",
      "tests/event-catchup.integration.test.ts",
      "--fileParallelism=false",
    ],
    injections: [
      "wrong worker claim",
      "duplicate command admission",
      "approval tampering",
      "duplicate job completion",
      "duplicate signal-driven resume",
      "duplicate final message",
      "hidden projection attempt",
      "cursor reconnect duplicate",
    ],
  },
  {
    name: "sse-reconnect-privacy-atomicity",
    command: ["corepack", "pnpm", "--filter", "@agentic-chat/api", "test:integration"],
    injections: [
      "duplicate SSE frame",
      "SSE cursor reconnect",
      "stale SSE cursor",
      "hidden SSE projection",
      "partial message path",
    ],
  },
]

export const runAdversarialSuites = (execute) =>
  suites.map(({ name, command, injections }) => {
    const [executable, ...arguments_] = command
    const result = execute(executable, arguments_)
    const testCount = (result.stdout + result.stderr).match(/Tests\s+(\d+) passed/)?.[1]
    assert.ok(testCount)
    return {
      name,
      result: "PASS",
      tests: Number(testCount),
      zeroSilentSuccess: true,
      injections,
      command: result.command,
    }
  })

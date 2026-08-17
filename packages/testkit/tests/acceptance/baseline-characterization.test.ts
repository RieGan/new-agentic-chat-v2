import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const workspace = fileURLToPath(new URL("../../../..", import.meta.url))

const suites = {
  simple_loop: ["simple-loop.spec.ts", "simple-loop-durable.spec.ts"],
  state_workflow: ["state-workflow.spec.ts", "state-workflow-durable.spec.ts"],
} as const

describe("existing F01-F10 runtime acceptance behavior", () => {
  for (const [runtime, files] of Object.entries(suites)) {
    it(`keeps all ten ${runtime} observable flow checks green`, () => {
      // Given: the pre-Task-17 runtime-specific F01-F10 Playwright specifications.
      const result = spawnSync(
        "corepack",
        [
          "pnpm",
          "--filter",
          "@agentic-chat/testkit",
          "exec",
          "playwright",
          "test",
          ...files,
          "--config",
          "../../playwright.config.ts",
          "--project",
          "runtime",
        ],
        {
          cwd: workspace,
          encoding: "utf8",
          env: { ...process.env, TEST_RUNTIME: runtime },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 300_000,
        },
      )

      // When: each architecture executes its existing deterministic suite.
      const diagnostic = `${result.stdout}\n${result.stderr}`

      // Then: the five synchronous and five durable checks all pass.
      expect(result.status, diagnostic).toBe(0)
      expect(diagnostic).toContain("10 passed")
    }, 310_000)
  }
})

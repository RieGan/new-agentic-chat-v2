import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { expect, type TestInfo, test } from "@playwright/test"

import type { AcceptanceFlowId, AcceptancePromptId } from "../src/index.js"

const requestedRuntime = process.env["TEST_RUNTIME"]
const requestedFlows = process.env["TEST_FLOWS"]?.split(",") ?? []
const selected =
  requestedRuntime === "state_workflow" &&
  (requestedFlows.length === 0 || requestedFlows.includes("F06-F10"))
const workspace = fileURLToPath(new URL("../../..", import.meta.url))

type RuntimeScenario = {
  readonly name: string
  readonly testId: AcceptanceFlowId
  readonly promptId: AcceptancePromptId
  readonly testInfo: TestInfo
}

const runRuntimeScenario = (scenario: RuntimeScenario): void => {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@agentic-chat/runtime",
      "exec",
      "vitest",
      "run",
      "tests/state-workflow-durable.integration.test.ts",
      "-t",
      scenario.name,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        ACCEPTANCE_CAPTURE_RUNTIME: "state_workflow",
        ACCEPTANCE_CAPTURE_FLOW: scenario.testId,
        ACCEPTANCE_CAPTURE_PROMPT: scenario.promptId,
        ACCEPTANCE_CAPTURE_FILE: scenario.testInfo.file,
        ACCEPTANCE_CAPTURE_TITLE: scenario.testInfo.title,
      },
    },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.describe("State Workflow F06-F10 durable recovery", () => {
  test.skip(!selected, "State Workflow F06-F10 was not selected")
  test.setTimeout(120_000)

  test("F06 report resumes once from canonical completion", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the focused scenario persists, completes, signals, and resumes one report.
    runRuntimeScenario({ name: "F06/F10", testId: "F06", promptId: "P07", testInfo })
  })

  test("F07 @restart pending approval executes exactly one simulated send", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the approved exact binding survives restart and executes one send.
    runRuntimeScenario({
      name: "F07/F08 preserves exact approval",
      testId: "F07",
      promptId: "P08",
      testInfo,
    })
  })

  test("F08 @restart pending approval preserves rejection binding", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: rejection survives restart and remains side-effect free.
    runRuntimeScenario({
      name: "F07/F08 preserves exact approval",
      testId: "F08",
      promptId: "P09",
      testInfo,
    })
  })

  test("F09 same-run continuation applies hidden guidance once", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the exact User signal applies model-only guidance without User leakage.
    runRuntimeScenario({ name: "F09", testId: "F09", promptId: "P10", testInfo })
  })

  test("F10 @restart Temporal worker recovers accepted report", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the real worker restarts while Temporal history and PostgreSQL remain durable.
    runRuntimeScenario({ name: "F06/F10", testId: "F10", promptId: "P11", testInfo })
  })
})

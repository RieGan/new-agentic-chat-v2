import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { expect, type TestInfo, test } from "@playwright/test"

import type { AcceptanceFlowId, AcceptancePromptId } from "../src/index.js"

const requestedRuntime = process.env["TEST_RUNTIME"]
const requestedFlows = process.env["TEST_FLOWS"]?.split(",") ?? []
const selected =
  (requestedRuntime === undefined || requestedRuntime === "simple_loop") &&
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
      "tests/simple-loop-waits.integration.test.ts",
      "-t",
      scenario.name,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        ACCEPTANCE_CAPTURE_RUNTIME: "simple_loop",
        ACCEPTANCE_CAPTURE_FLOW: scenario.testId,
        ACCEPTANCE_CAPTURE_PROMPT: scenario.promptId,
        ACCEPTANCE_CAPTURE_FILE: scenario.testInfo.file,
        ACCEPTANCE_CAPTURE_TITLE: scenario.testInfo.title,
      },
    },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.describe("Simple Loop F06-F10 durable recovery", () => {
  test.skip(!selected, "Simple Loop F06-F10 was not selected")
  test.setTimeout(120_000)

  test("F06 report resumes once from canonical completion", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the focused runtime scenario drives acceptance, progress, completion, and resume.
    runRuntimeScenario({
      name: "resumes one report call",
      testId: "F06",
      promptId: "P07",
      testInfo,
    })
  })

  test("F07 @restart pending approval executes exactly one simulated send", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: the approval scenario crosses the exact binding and observes one executor call.
    runRuntimeScenario({
      name: "resumes an exact approval",
      testId: "F07",
      promptId: "P08",
      testInfo,
    })
  })

  test("F08 @restart pending approval rejection preserves the binding", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: rejection stays effect-free while both decisions reconstruct the runtime worker.
    runRuntimeScenario({
      name: "resumes an exact approval",
      testId: "F08",
      promptId: "P09",
      testInfo,
    })
  })

  test("F09 hidden Admin guidance resumes the same User-waiting run", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: continue_run applies one model-only command without leaking it to User records.
    runRuntimeScenario({
      name: "applies hidden Admin guidance",
      testId: "F09",
      promptId: "P10",
      testInfo,
    })
  })

  test("F10 @restart worker-only recovery preserves report identities", ({
    playwright: _playwright,
  }, testInfo) => {
    // Given/When/Then: a second isolated worker instance reclaims the released report wait fence.
    runRuntimeScenario({
      name: "resumes one report call",
      testId: "F10",
      promptId: "P11",
      testInfo,
    })
  })
})

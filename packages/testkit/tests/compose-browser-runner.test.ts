import { describe, expect, it } from "vitest"

import {
  createEvidenceSummary,
  parseComposeBrowserArguments,
  validatePlaywrightReport,
} from "../scripts/compose-browser-runner.js"

const passingReport = {
  stats: { expected: 2, skipped: 0, unexpected: 0, flaky: 0 },
}

describe("Compose browser runner contract", () => {
  it("translates one supported runtime and preserves Playwright arguments", () => {
    // Given: a supported runtime and a focused Playwright option.
    const arguments_ = ["--runtime=state_workflow", "--grep", "approval"]

    // When: the CLI boundary parses the request.
    const parsed = parseComposeBrowserArguments(arguments_)

    // Then: the runtime becomes typed environment input and other options remain intact.
    expect(parsed).toEqual({
      runtime: "state_workflow",
      playwrightArguments: ["--grep", "approval"],
    })
  })

  it.each([
    { arguments_: [] },
    { arguments_: ["--runtime=unknown"] },
    { arguments_: ["--runtime=simple_loop", "--runtime=state_workflow"] },
  ])("rejects a missing, invalid, or duplicate runtime", ({ arguments_ }) => {
    // Given: runtime arguments that cannot select exactly one Compose worker.
    // When/Then: parsing fails before Playwright or Docker is invoked.
    expect(() => parseComposeBrowserArguments(arguments_)).toThrow(/runtime/iu)
  })

  it.each([
    { stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 } },
    { stats: { expected: 1, skipped: 1, unexpected: 0, flaky: 0 } },
  ])("rejects zero-test and skipped-test reports", (report) => {
    // Given: Playwright returned no executed coverage or a skipped test.
    // When/Then: the release-gate report is rejected.
    expect(() => validatePlaywrightReport(report)).toThrow(/tests|skipped/iu)
  })

  it("writes only allow-listed sanitized evidence", () => {
    // Given: a successful run and a namespace safe for deterministic prompts.
    const summary = createEvidenceSummary({
      runtime: "simple_loop",
      namespace: "simple_loop-mabc1234-89abcdef",
      report: passingReport,
      durationMs: 1_234,
    })

    // When: the summary is serialized for retention.
    const serialized = JSON.stringify(summary)

    // Then: only non-secret execution facts are present.
    expect(summary).toEqual({
      runtime: "simple_loop",
      namespace: "simple_loop-mabc1234-89abcdef",
      result: "PASS",
      tests: 2,
      skipped: 0,
      durationMs: 1_234,
      fixturePorts: { "4310": "unused", "4311": "unused" },
      fixtureProcess: "absent",
    })
    expect(serialized).not.toMatch(/stdout|stderr|environment|secret|token|password/iu)
  })
})

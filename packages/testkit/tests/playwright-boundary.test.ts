import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))

const listProject = (project: string): string => {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--config=playwright.config.ts",
      "--project",
      project,
      "--list",
    ],
    { cwd: workspace, encoding: "utf8" },
  )
  const diagnostic = `${result.stdout}\n${result.stderr}`
  expect(result.status, diagnostic).toBe(0)
  return diagnostic
}

describe("Playwright project boundaries", () => {
  it("keeps every UI spec out of runtime collection", () => {
    // Given: the runtime project collects the shared test directory.
    const runtimeList = listProject("runtime")

    // When: Playwright lists the runtime project.
    // Then: no UI-only specification is eligible for runtime execution.
    expect(runtimeList).not.toContain("ui-happy.spec.ts")
    expect(runtimeList).not.toContain("ui-adversarial.spec.ts")
    expect(runtimeList).not.toContain("ui-approvals.spec.ts")
    expect(runtimeList).not.toContain("ui-races.spec.ts")
  })

  it("keeps the intended UI specs in their UI projects", () => {
    // Given: the two dedicated UI projects have explicit file matches.
    const happyList = listProject("ui-happy")
    const adversarialList = listProject("ui-adversarial")

    // When: Playwright lists each UI project.
    // Then: happy, adversarial, approval, and race specs remain assigned.
    expect(happyList).toContain("ui-happy.spec.ts")
    expect(adversarialList).toContain("ui-adversarial.spec.ts")
    expect(adversarialList).toContain("ui-approvals.spec.ts")
    expect(adversarialList).toContain("ui-races.spec.ts")
  })
})

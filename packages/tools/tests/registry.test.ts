import {
  CallIdSchema,
  JobIdSchema,
  SkillIdSchema,
  SkillSnapshotSchema,
  SkillVersionSchema,
} from "@agentic-chat/contracts"
import { describe, expect, it } from "vitest"

import { createInvocationLedger, createToolRegistry } from "../src/index.js"

const calculatorSkill = {
  skillId: SkillIdSchema.parse("calculator_assistant"),
  version: SkillVersionSchema.parse("1"),
} as const

describe("versioned tool registry", () => {
  it("loads the exact P02 skill snapshot without recording an AI invocation", () => {
    // Given
    const ledger = createInvocationLedger()
    const registry = createToolRegistry({ ledger })

    // When
    const result = registry.loadSkill(calculatorSkill)

    // Then
    expect(result).toEqual({
      ok: true,
      skill: {
        skillId: "calculator_assistant",
        version: "1",
        instructions: "Always use calculator.evaluate for arithmetic requested by the user.",
        allowedTools: ["calculator.evaluate"],
      },
    })
    expect(ledger.snapshot()).toEqual([])
  })

  it("returns SKILL_NOT_FOUND for P05 without selecting a fallback", () => {
    // Given
    const registry = createToolRegistry()

    // When
    const result = registry.loadSkill({
      skillId: SkillIdSchema.parse("missing_skill"),
      version: SkillVersionSchema.parse("1"),
    })

    // Then
    expect(result).toMatchObject({ ok: false, error: { code: "SKILL_NOT_FOUND" } })
  })

  it("returns SKILL_NOT_FOUND for an unknown version of an existing skill", () => {
    // Given
    const registry = createToolRegistry()

    // When
    const result = registry.loadSkill({
      skillId: SkillIdSchema.parse("calculator_assistant"),
      version: SkillVersionSchema.parse("2"),
    })

    // Then
    expect(result).toMatchObject({ ok: false, error: { code: "SKILL_NOT_FOUND" } })
  })

  it("exposes only the P02 calculator allowlist and denies P06 execution", () => {
    // Given
    const registry = createToolRegistry()
    const loaded = registry.loadSkill(calculatorSkill)
    if (!loaded.ok) throw loaded.error

    // When
    const exposed = registry.getAllowedAiToolDefinitions(loaded.skill)

    // Then
    expect(exposed.map((definition) => definition.id)).toEqual(["calculator.evaluate"])
    expect(() =>
      registry.executeAiTool(loaded.skill, {
        toolName: "notification.preview",
        callId: CallIdSchema.parse("call_denied"),
        arguments: { recipient: "qa@example.com", subject: "MVP", body: "blocked" },
      }),
    ).toThrowError(expect.objectContaining({ code: "TOOL_NOT_ALLOWED" }))
  })

  it("rejects a forged selected-skill snapshot that widens its allowlist", () => {
    // Given
    const registry = createToolRegistry()
    const loaded = registry.loadSkill(calculatorSkill)
    if (!loaded.ok) throw loaded.error
    const forged = SkillSnapshotSchema.parse({
      ...loaded.skill,
      allowedTools: ["calculator.evaluate", "notification.send_email"],
    })

    // When / Then
    expect(() => registry.getAllowedAiToolDefinitions(forged)).toThrowError(
      expect.objectContaining({ code: "INVALID_SCHEMA" }),
    )
  })

  it("matches the three skill and six tool DB seed identifiers and policies", () => {
    // Given
    const registry = createToolRegistry()

    // When
    const snapshot = registry.snapshotDefinitions()

    // Then
    expect(
      snapshot.skills.map(({ skillId, version, allowedTools }) => ({
        skillId,
        version,
        allowedTools,
      })),
    ).toEqual([
      { skillId: "calculator_assistant", version: "1", allowedTools: ["calculator.evaluate"] },
      {
        skillId: "communication_assistant",
        version: "1",
        allowedTools: ["notification.preview", "notification.send_email"],
      },
      { skillId: "report_assistant", version: "1", allowedTools: ["report.generate"] },
    ])
    expect(
      snapshot.tools.map(({ id, version, mode, risk, approvalRequired }) => ({
        id,
        version,
        mode,
        risk,
        approvalRequired,
      })),
    ).toEqual([
      { id: "skill.load", version: "1", mode: "sync", risk: "read", approvalRequired: false },
      {
        id: "calculator.evaluate",
        version: "1",
        mode: "sync",
        risk: "read",
        approvalRequired: false,
      },
      {
        id: "notification.preview",
        version: "1",
        mode: "sync",
        risk: "read",
        approvalRequired: false,
      },
      {
        id: "notification.send_email",
        version: "1",
        mode: "sync",
        risk: "high",
        approvalRequired: true,
      },
      { id: "report.generate", version: "1", mode: "async", risk: "low", approvalRequired: false },
      { id: "job.get_status", version: "1", mode: "sync", risk: "read", approvalRequired: false },
    ])
  })

  it("validates unknown skill versions and malformed AI arguments at both boundaries", () => {
    // Given
    const registry = createToolRegistry()
    const loaded = registry.loadSkill(calculatorSkill)
    if (!loaded.ok) throw loaded.error

    // When / Then
    expect(registry.loadSkill({ skillId: "calculator_assistant", version: "" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_SCHEMA" },
    })
    expect(() =>
      registry.executeAiTool(loaded.skill, {
        toolName: "calculator.evaluate",
        callId: CallIdSchema.parse("call_bad_args"),
        arguments: { expression: "1 + 1", extra: true },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SCHEMA" }))
  })

  it("rejects an unknown AI tool before execution", () => {
    // Given
    const registry = createToolRegistry()
    const loaded = registry.loadSkill(calculatorSkill)
    if (!loaded.ok) throw loaded.error

    // When / Then
    expect(() =>
      registry.executeAiTool(loaded.skill, {
        toolName: "browser.execute",
        callId: CallIdSchema.parse("call_unknown_tool"),
        arguments: {},
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SCHEMA" }))
  })

  it("delegates job.get_status to lookup and validates its canonical result", () => {
    // Given
    const registry = createToolRegistry()
    const jobId = JobIdSchema.parse("job_001")

    // When
    const result = registry.getJobStatus(
      { jobId },
      { lookup: () => ({ jobId, status: "completed", reportId: "report_001" }) },
    )

    // Then
    expect(result).toEqual({
      toolName: "job.get_status",
      jobId: "job_001",
      status: "completed",
      reportId: "report_001",
    })
  })
})

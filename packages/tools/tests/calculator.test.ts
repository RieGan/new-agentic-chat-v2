import { CallIdSchema, SkillIdSchema, SkillVersionSchema } from "@agentic-chat/contracts"
import { describe, expect, it } from "vitest"

import { createInvocationLedger, createToolRegistry } from "../src/index.js"

const loadCalculator = () => {
  const ledger = createInvocationLedger()
  const registry = createToolRegistry({ ledger })
  const loaded = registry.loadSkill({
    skillId: SkillIdSchema.parse("calculator_assistant"),
    version: SkillVersionSchema.parse("1"),
  })
  if (!loaded.ok) throw loaded.error
  return { ledger, registry, skill: loaded.skill }
}

describe("calculator.evaluate", () => {
  it("returns exact 1040 for P03", () => {
    // Given
    const { ledger, registry, skill } = loadCalculator()

    // When
    const result = registry.executeAiTool(skill, {
      toolName: "calculator.evaluate",
      callId: CallIdSchema.parse("call_calc"),
      arguments: { expression: "(125 * 8) + 40" },
    })

    // Then
    expect(result).toEqual({ toolName: "calculator.evaluate", value: 1040 })
    expect(ledger.count("calculator.evaluate", "succeeded")).toBe(1)
  })

  it("throws typed DIVISION_BY_ZERO for P04 and records the failed invocation", () => {
    // Given
    const { ledger, registry, skill } = loadCalculator()

    // When / Then
    expect(() =>
      registry.executeAiTool(skill, {
        toolName: "calculator.evaluate",
        callId: CallIdSchema.parse("call_zero"),
        arguments: { expression: "10 / 0" },
      }),
    ).toThrowError(expect.objectContaining({ code: "DIVISION_BY_ZERO" }))
    expect(ledger.count("calculator.evaluate", "failed")).toBe(1)
  })

  it.each([
    "globalThis.process",
    "Math.max(1, 2)",
    "1e309",
    "Infinity",
    "NaN",
    "1 + 2 trailing",
    "2 ** 8",
  ])("rejects forbidden expression %s", (expression) => {
    // Given
    const { registry, skill } = loadCalculator()

    // When / Then
    expect(() =>
      registry.executeAiTool(skill, {
        toolName: "calculator.evaluate",
        callId: CallIdSchema.parse(`call_${expression.length}`),
        arguments: { expression },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SCHEMA" }))
  })

  it("bounds oversized and deeply nested expressions synchronously", () => {
    // Given
    const { registry, skill } = loadCalculator()
    const expressions = [`${"1+".repeat(200)}1`, `${"(".repeat(40)}1${")".repeat(40)}`]

    // When / Then
    for (const [index, expression] of expressions.entries()) {
      expect(() =>
        registry.executeAiTool(skill, {
          toolName: "calculator.evaluate",
          callId: CallIdSchema.parse(`call_bounded_${index}`),
          arguments: { expression },
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_SCHEMA" }))
    }
  })
})

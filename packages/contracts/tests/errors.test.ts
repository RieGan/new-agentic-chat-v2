import { describe, expect, it } from "vitest"

import {
  ConflictError,
  ContractErrorCodeSchema,
  ContractErrorSchema,
  DivisionByZeroError,
  DuplicateError,
  InvalidAdminCommandError,
  InvalidApprovalError,
  SkillNotFoundError,
} from "../src/index.js"

describe("typed contract errors", () => {
  it("exports the complete frozen error-code set", () => {
    expect(ContractErrorCodeSchema.options).toEqual([
      "INVALID_SCHEMA",
      "ILLEGAL_TRANSITION",
      "IMMUTABLE_RUNTIME_ASSIGNMENT",
      "FORBIDDEN_VISIBILITY",
      "SKILL_NOT_FOUND",
      "TOOL_NOT_ALLOWED",
      "DIVISION_BY_ZERO",
      "LOOP_STEP_LIMIT_EXCEEDED",
      "CONFLICT",
      "DUPLICATE",
      "STALE_LEASE",
      "STALE_VERSION",
      "INVALID_APPROVAL",
      "INVALID_ADMIN_COMMAND",
    ])
  })

  it("provides exact domain error classes for registry, execution, and control failures", () => {
    expect(new SkillNotFoundError("missing_skill@1").code).toBe("SKILL_NOT_FOUND")
    expect(new DivisionByZeroError().code).toBe("DIVISION_BY_ZERO")
    expect(new ConflictError("run_001").code).toBe("CONFLICT")
    expect(new DuplicateError("command", "duplicate-key").code).toBe("DUPLICATE")
    expect(new InvalidApprovalError("argument hash mismatch").code).toBe("INVALID_APPROVAL")
    expect(new InvalidAdminCommandError("wrong run").code).toBe("INVALID_ADMIN_COMMAND")
  })

  it("rejects unknown fields in serialized error contracts", () => {
    expect(
      ContractErrorSchema.safeParse({
        code: "DIVISION_BY_ZERO",
        message: "Division by zero is undefined",
        diagnostic: "runtime-only detail",
      }).success,
    ).toBe(false)
  })
})

import {
  type ContractErrorData,
  DivisionByZeroError,
  InvalidApprovalError,
  InvalidSchemaError,
  LoopStepLimitExceededError,
  SkillNotFoundError,
  ToolNotAllowedError,
} from "@agentic-chat/contracts"

export class SimpleLoopFailure extends Error {
  readonly name = "SimpleLoopFailure"

  constructor(readonly data: ContractErrorData) {
    super(data.message)
  }
}

export const toContractError = (caught: unknown): ContractErrorData => {
  if (caught instanceof SimpleLoopFailure) return caught.data
  if (caught instanceof SkillNotFoundError) {
    return { code: caught.code, message: caught.message, skill: caught.skill }
  }
  if (caught instanceof ToolNotAllowedError) {
    return { code: caught.code, message: caught.message, skill: caught.skill, tool: caught.tool }
  }
  if (caught instanceof DivisionByZeroError) {
    return { code: caught.code, message: caught.message }
  }
  if (caught instanceof LoopStepLimitExceededError) {
    return { code: caught.code, message: caught.message, limit: caught.limit }
  }
  if (caught instanceof InvalidSchemaError) {
    return { code: caught.code, message: caught.message, issues: [...caught.issues] }
  }
  if (caught instanceof InvalidApprovalError) {
    return { code: caught.code, message: caught.message, reason: caught.reason }
  }
  return {
    code: "INVALID_SCHEMA",
    message: "The request could not be completed",
    issues: ["runtime: provider or tool response was invalid"],
  }
}

export const userExplanation = (error: ContractErrorData): string => {
  switch (error.code) {
    case "SKILL_NOT_FOUND":
      return "The requested skill was not found."
    case "TOOL_NOT_ALLOWED":
      return "The selected skill cannot perform the requested action."
    case "LOOP_STEP_LIMIT_EXCEEDED":
      return "The request stopped after reaching the model step limit."
    case "DIVISION_BY_ZERO":
      return "The calculation is undefined because division by zero is not allowed."
    case "INVALID_SCHEMA":
    case "ILLEGAL_TRANSITION":
    case "IMMUTABLE_RUNTIME_ASSIGNMENT":
    case "FORBIDDEN_VISIBILITY":
    case "CONFLICT":
    case "DUPLICATE":
    case "STALE_LEASE":
    case "STALE_VERSION":
    case "INVALID_APPROVAL":
    case "INVALID_ADMIN_COMMAND":
      return "The request could not be completed."
    default: {
      const exhaustiveError: never = error
      return exhaustiveError
    }
  }
}

import { type ZodType, z } from "zod"

export const ContractErrorCodeSchema = z.enum([
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
export type ContractErrorCode = z.infer<typeof ContractErrorCodeSchema>

const errorBaseShape = { message: z.string().min(1) } as const

export const ContractErrorSchema = z.discriminatedUnion("code", [
  z
    .object({ ...errorBaseShape, code: z.literal("INVALID_SCHEMA"), issues: z.array(z.string()) })
    .strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("ILLEGAL_TRANSITION"),
      entity: z.string(),
      current: z.string(),
      next: z.string(),
    })
    .strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("IMMUTABLE_RUNTIME_ASSIGNMENT"),
      assigned: z.string(),
      requested: z.string(),
    })
    .strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("FORBIDDEN_VISIBILITY"),
      visibility: z.string(),
      viewer: z.string(),
    })
    .strict(),
  z.object({ ...errorBaseShape, code: z.literal("SKILL_NOT_FOUND"), skill: z.string() }).strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("TOOL_NOT_ALLOWED"),
      skill: z.string(),
      tool: z.string(),
    })
    .strict(),
  z.object({ ...errorBaseShape, code: z.literal("DIVISION_BY_ZERO") }).strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("LOOP_STEP_LIMIT_EXCEEDED"),
      limit: z.number().int().positive(),
    })
    .strict(),
  z.object({ ...errorBaseShape, code: z.literal("CONFLICT"), resource: z.string() }).strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("DUPLICATE"),
      resource: z.string(),
      key: z.string(),
    })
    .strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("STALE_LEASE"),
      expected: z.number().int(),
      actual: z.number().int(),
    })
    .strict(),
  z
    .object({
      ...errorBaseShape,
      code: z.literal("STALE_VERSION"),
      expected: z.number().int(),
      actual: z.number().int(),
    })
    .strict(),
  z.object({ ...errorBaseShape, code: z.literal("INVALID_APPROVAL"), reason: z.string() }).strict(),
  z
    .object({ ...errorBaseShape, code: z.literal("INVALID_ADMIN_COMMAND"), reason: z.string() })
    .strict(),
])
export type ContractErrorData = z.infer<typeof ContractErrorSchema>

abstract class ContractError extends Error {
  abstract readonly code: ContractErrorCode
}

export class InvalidSchemaError extends ContractError {
  readonly name = "InvalidSchemaError"
  readonly code = "INVALID_SCHEMA"

  constructor(readonly issues: readonly string[]) {
    super(`Contract schema is invalid: ${issues.join(", ")}`)
  }
}

type TransitionFailure = {
  readonly entity: string
  readonly current: string
  readonly next: string
}

export class IllegalTransitionError extends ContractError {
  readonly name = "IllegalTransitionError"
  readonly code = "ILLEGAL_TRANSITION"

  constructor(readonly transition: TransitionFailure) {
    super(`Illegal ${transition.entity} transition: ${transition.current} -> ${transition.next}`)
  }
}

export class ImmutableRuntimeAssignmentError extends ContractError {
  readonly name = "ImmutableRuntimeAssignmentError"
  readonly code = "IMMUTABLE_RUNTIME_ASSIGNMENT"

  constructor(
    readonly assigned: string,
    readonly requested: string,
  ) {
    super(`Run runtime is immutable: ${assigned} cannot change to ${requested}`)
  }
}

export class ForbiddenVisibilityError extends ContractError {
  readonly name = "ForbiddenVisibilityError"
  readonly code = "FORBIDDEN_VISIBILITY"

  constructor(
    readonly visibility: string,
    readonly viewer: string,
  ) {
    super(`${visibility} data is forbidden for ${viewer}`)
  }
}

export class SkillNotFoundError extends ContractError {
  readonly name = "SkillNotFoundError"
  readonly code = "SKILL_NOT_FOUND"

  constructor(readonly skill: string) {
    super(`Skill not found: ${skill}`)
  }
}

export class ToolNotAllowedError extends ContractError {
  readonly name = "ToolNotAllowedError"
  readonly code = "TOOL_NOT_ALLOWED"

  constructor(
    readonly skill: string,
    readonly tool: string,
  ) {
    super(`Tool ${tool} is not allowed by skill ${skill}`)
  }
}

export class DivisionByZeroError extends ContractError {
  readonly name = "DivisionByZeroError"
  readonly code = "DIVISION_BY_ZERO"

  constructor() {
    super("Division by zero is undefined")
  }
}

export class LoopStepLimitExceededError extends ContractError {
  readonly name = "LoopStepLimitExceededError"
  readonly code = "LOOP_STEP_LIMIT_EXCEEDED"

  constructor(readonly limit: number) {
    super(`Loop step limit exceeded: ${limit}`)
  }
}

export class ConflictError extends ContractError {
  readonly name = "ConflictError"
  readonly code = "CONFLICT"

  constructor(readonly resource: string) {
    super(`Conflicting update for ${resource}`)
  }
}

export class DuplicateError extends ContractError {
  readonly name = "DuplicateError"
  readonly code = "DUPLICATE"

  constructor(
    readonly resource: string,
    readonly key: string,
  ) {
    super(`Duplicate ${resource}: ${key}`)
  }
}

export class StaleLeaseError extends ContractError {
  readonly name = "StaleLeaseError"
  readonly code = "STALE_LEASE"

  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Stale lease: expected ${expected}, actual ${actual}`)
  }
}

export class StaleVersionError extends ContractError {
  readonly name = "StaleVersionError"
  readonly code = "STALE_VERSION"

  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Stale version: expected ${expected}, actual ${actual}`)
  }
}

export class InvalidApprovalError extends ContractError {
  readonly name = "InvalidApprovalError"
  readonly code = "INVALID_APPROVAL"

  constructor(readonly reason: string) {
    super(`Invalid approval: ${reason}`)
  }
}

export class InvalidAdminCommandError extends ContractError {
  readonly name = "InvalidAdminCommandError"
  readonly code = "INVALID_ADMIN_COMMAND"

  constructor(readonly reason: string) {
    super(`Invalid Admin command: ${reason}`)
  }
}

export const parseContract = <Schema extends ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> => {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new InvalidSchemaError(
      result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    )
  }
  return result.data
}

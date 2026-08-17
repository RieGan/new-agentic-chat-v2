import {
  CanonicalEventSchema,
  ImmutableRuntimeAssignmentError,
  parseContract,
  RunIdSchema,
  RunStateSchema,
  RuntimeSchema,
} from "@agentic-chat/contracts"
import {
  claimNextSimpleLoopRun,
  claimRunLease,
  type DatabaseClient,
  persistLeasedRunTransition,
  readRunAssignment,
} from "@agentic-chat/db"
import { z } from "zod"

const claimInputSchema = z
  .object({ owner: z.string().min(1), durationSeconds: z.number().int().positive().max(3600) })
  .strict()
const claimRunInputSchema = claimInputSchema.extend({
  runId: RunIdSchema,
  runtime: RuntimeSchema,
})
const leaseSchema = z
  .object({
    runId: RunIdSchema,
    owner: z.string().min(1),
    fencingVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    expiresAt: z.date(),
  })
  .strict()
const mutationSchema = z
  .object({
    runId: RunIdSchema,
    owner: z.string().min(1),
    fencingVersion: z.number().int().nonnegative(),
    expectedVersion: z.number().int().nonnegative(),
    status: RunStateSchema,
    event: CanonicalEventSchema,
    dispatch: z
      .object({
        id: z.string().min(1),
        deduplicationKey: z.string().min(1),
        topic: z.string().min(1),
        payload: z.json(),
      })
      .strict(),
  })
  .strict()

export const createClaimService = (database: DatabaseClient) => ({
  claimNext: async (input: unknown) => {
    const parsed = parseContract(claimInputSchema, input)
    const lease = await claimNextSimpleLoopRun(database, parsed)
    return lease ? parseContract(leaseSchema, lease) : null
  },
  claimRun: async (input: unknown) => {
    const claim = parseContract(claimRunInputSchema, input)
    if (claim.runtime !== "simple_loop") {
      throw new ImmutableRuntimeAssignmentError("simple_loop", claim.runtime)
    }
    const assignment = await readRunAssignment(database, claim.runId)
    if (assignment.runtime !== claim.runtime) {
      throw new ImmutableRuntimeAssignmentError(assignment.runtime, claim.runtime)
    }
    const lease = await claimRunLease(database, {
      runId: claim.runId,
      runtime: claim.runtime,
      owner: claim.owner,
      durationSeconds: claim.durationSeconds,
      expectedVersion: assignment.version,
    })
    return parseContract(leaseSchema, { runId: claim.runId, ...lease })
  },
  persist: async (input: unknown) => {
    const mutation = parseContract(mutationSchema, input)
    const assignment = await readRunAssignment(database, mutation.runId)
    if (assignment.runtime !== "simple_loop") {
      throw new ImmutableRuntimeAssignmentError(assignment.runtime, "simple_loop")
    }
    if (mutation.event.runId !== mutation.runId) {
      throw new ImmutableRuntimeAssignmentError(mutation.event.runId, mutation.runId)
    }
    return persistLeasedRunTransition(database, {
      ...mutation,
      runtime: "simple_loop",
      event: mutation.event,
    })
  },
})

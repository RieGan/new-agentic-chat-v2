import {
  AdminCommandEnvelopeSchema,
  AdminCommandIdSchema,
  AdminCommandInputSchema,
  InvalidAdminCommandError,
  parseContract,
  RunIdSchema,
} from "@agentic-chat/contracts"
import {
  claimAdminCommandAtBoundary,
  type StoredAdminCommand,
  submitAdminCommand,
} from "@agentic-chat/db"
import { z } from "zod"

import { requireFixedAdmin } from "./admin-context.js"
import type { ApplicationDependencies } from "./dependencies.js"

const ClaimAdminCommandInputSchema = z
  .object({
    runId: RunIdSchema,
    boundaryKey: z.string().trim().min(1),
  })
  .strict()

const toAdminCommandEnvelope = (record: StoredAdminCommand) => {
  const base = {
    commandId: record.id,
    conversationId: record.conversationId,
    actorId: "mvp_admin",
    instruction: record.instruction,
    visibility: "model_only",
    expiresAt: record.expiresAt.toISOString(),
    idempotencyKey: record.idempotencyKey,
    version: record.version,
  } as const
  switch (record.status) {
    case "accepted":
      return parseContract(AdminCommandEnvelopeSchema, { ...base, status: record.status })
    case "applied":
      if (record.appliedRunId === null || record.appliedAt === null) {
        throw new InvalidAdminCommandError("applied command is incomplete")
      }
      return parseContract(AdminCommandEnvelopeSchema, {
        ...base,
        status: record.status,
        appliedRunId: record.appliedRunId,
        appliedAt: record.appliedAt.toISOString(),
      })
    case "expired":
      return parseContract(AdminCommandEnvelopeSchema, {
        ...base,
        status: record.status,
        expiredAt: record.expiresAt.toISOString(),
      })
    case "rejected":
      throw new InvalidAdminCommandError("rejected command has no applicable guidance")
    default: {
      const exhaustiveStatus: never = record.status
      return exhaustiveStatus
    }
  }
}

export const createAdminCommandService = (dependencies: ApplicationDependencies) => ({
  submit: async (context: unknown, input: unknown) => {
    requireFixedAdmin(context, () => new InvalidAdminCommandError("fixed Admin context required"))
    const parsed = parseContract(AdminCommandInputSchema, input)
    const record = await submitAdminCommand(dependencies.database, {
      commandId: parseContract(AdminCommandIdSchema, dependencies.ids.next("admin_command")),
      conversationId: parsed.conversationId,
      instruction: parsed.instruction,
      expiresAt: new Date(parsed.expiresAt),
      idempotencyKey: parsed.idempotencyKey,
      now: dependencies.clock.now(),
    })
    return toAdminCommandEnvelope(record)
  },
  claimAtBoundary: async (input: unknown) => {
    const parsed = parseContract(ClaimAdminCommandInputSchema, input)
    const record = await claimAdminCommandAtBoundary(dependencies.database, {
      ...parsed,
      now: dependencies.clock.now(),
      eventId: dependencies.ids.next("event"),
      correlationId: dependencies.ids.next("correlation"),
    })
    if (record === null) return null
    return { command: toAdminCommandEnvelope(record), instruction: record.instruction }
  },
})

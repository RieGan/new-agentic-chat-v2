import {
  AdminCommandEnvelopeSchema,
  AdminCommandIdSchema,
  AdminCommandInputSchema,
  InvalidAdminCommandError,
  parseContract,
  RunIdSchema,
} from "@agentic-chat/contracts"
import { applyAdminCommand, type StoredAdminCommand, submitAdminCommand } from "@agentic-chat/db"
import { z } from "zod"

import { requireFixedAdmin } from "./admin-context.js"
import type { ApplicationDependencies } from "./dependencies.js"

const ApplyAdminCommandInputSchema = z
  .object({
    commandId: AdminCommandIdSchema,
    runId: RunIdSchema,
    boundary: z.literal("before_model"),
  })
  .strict()

const toAdminCommandEnvelope = (record: StoredAdminCommand) => {
  const base = {
    commandId: record.id,
    runId: record.runId,
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
      return parseContract(AdminCommandEnvelopeSchema, {
        ...base,
        status: record.status,
        ...(record.appliedAt ? { appliedAt: record.appliedAt.toISOString() } : {}),
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
      runId: parsed.runId,
      instruction: parsed.instruction,
      expiresAt: new Date(parsed.expiresAt),
      idempotencyKey: parsed.idempotencyKey,
      now: dependencies.clock.now(),
      eventId: dependencies.ids.next("event"),
      correlationId: dependencies.ids.next("correlation"),
    })
    return toAdminCommandEnvelope(record)
  },
  applyAtBoundary: async (input: unknown) => {
    const parsed = parseContract(ApplyAdminCommandInputSchema, input)
    const record = await applyAdminCommand(dependencies.database, {
      ...parsed,
      now: dependencies.clock.now(),
      eventId: dependencies.ids.next("event"),
      correlationId: dependencies.ids.next("correlation"),
    })
    return { command: toAdminCommandEnvelope(record), instruction: record.instruction }
  },
})

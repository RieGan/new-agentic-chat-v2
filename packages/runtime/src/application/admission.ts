import { createHash } from "node:crypto"

import {
  ChatSendMessageInputSchema,
  CommandAcceptedOutputSchema,
  type CommandAcceptedOutputSchema as CommandAcceptedSchemaType,
  CommandEnvelopeSchema,
  ConflictError,
  CorrelationIdSchema,
  EventIdSchema,
  MessageIdSchema,
  parseContract,
  RunIdSchema,
} from "@agentic-chat/contracts"
import { admitContinuation, admitNewRun } from "@agentic-chat/db"
import type { z } from "zod"

import type { ApplicationDependencies } from "./dependencies.js"

type AdmissionReceipt = z.infer<typeof CommandAcceptedSchemaType>

const hashCommand = (command: z.infer<typeof CommandEnvelopeSchema>): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`

export const createAdmissionService = (dependencies: ApplicationDependencies) => ({
  admit: async (input: unknown): Promise<AdmissionReceipt> => {
    const command = parseContract(CommandEnvelopeSchema, input)
    if (command.type !== "chat.send_message") {
      throw new ConflictError(`command type ${command.type}`)
    }
    const payload = parseContract(ChatSendMessageInputSchema, command.payload)
    const occurredAt = dependencies.clock.now()
    const messageId = parseContract(MessageIdSchema, dependencies.ids.next("message"))
    const eventId = parseContract(EventIdSchema, dependencies.ids.next("event"))
    const dispatchId = dependencies.ids.next("dispatch")
    const requestHash = hashCommand(command)
    switch (payload.kind) {
      case "new_run": {
        const runId = parseContract(RunIdSchema, dependencies.ids.next("run"))
        const receipt = parseContract(CommandAcceptedOutputSchema, {
          commandId: command.commandId,
          status: "accepted",
          runId,
        })
        const result = await admitNewRun(dependencies.database, {
          key: payload.idempotencyKey,
          requestHash,
          receipt,
          conversationId: payload.conversationId,
          runtime: payload.runtime,
          message: payload.message,
          messageId,
          eventId,
          dispatchId,
          correlationId: parseContract(CorrelationIdSchema, dependencies.ids.next("correlation")),
          occurredAt,
        })
        return parseContract(CommandAcceptedOutputSchema, result.receipt)
      }
      case "continue_run": {
        const receipt = parseContract(CommandAcceptedOutputSchema, {
          commandId: command.commandId,
          status: "accepted",
          runId: payload.runId,
        })
        const result = await admitContinuation(dependencies.database, {
          key: payload.idempotencyKey,
          requestHash,
          receipt,
          conversationId: payload.conversationId,
          correlationId: payload.correlationId,
          message: payload.message,
          messageId,
          eventId,
          dispatchId,
          occurredAt,
        })
        return parseContract(CommandAcceptedOutputSchema, result.receipt)
      }
      default: {
        const exhaustivePayload: never = payload
        return exhaustivePayload
      }
    }
  },
})

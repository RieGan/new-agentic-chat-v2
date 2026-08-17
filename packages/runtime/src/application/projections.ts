import {
  AdminProjectionSchema,
  type CanonicalEvent,
  CanonicalEventSchema,
  ConflictError,
  parseContract,
  projectEvents,
  RunEventsInputSchema,
  RunEventsOutputSchema,
  type RunSnapshot,
  RunSnapshotSchema,
  UserProjectionSchema,
} from "@agentic-chat/contracts"
import { type DatabaseClient, readRunEventRecords, readRunProjectionRecord } from "@agentic-chat/db"
import { z } from "zod"

const projectionInputSchema = z
  .object({ viewer: z.enum(["user", "admin"]), runId: z.string().min(1) })
  .strict()
const eventCatchupInputSchema = RunEventsInputSchema.extend({
  viewer: z.enum(["user", "admin"]),
})

const parseEvents = async (
  database: DatabaseClient,
  runId: string,
  afterSequence: number,
): Promise<readonly CanonicalEvent[]> => {
  const records = await readRunEventRecords(database, { runId, afterSequence })
  return records.map((record) =>
    parseContract(CanonicalEventSchema, {
      ...record,
      occurredAt: record.occurredAt.toISOString(),
    }),
  )
}

const loadSnapshot = async (database: DatabaseClient, runId: string): Promise<RunSnapshot> => {
  const record = await readRunProjectionRecord(database, runId)
  if (!record) throw new ConflictError(`run ${runId}`)
  const events = await parseEvents(database, runId, 0)
  const last = events.at(-1)
  const selectedSkill = record.skillId
    ? {
        skillId: record.skillId,
        version: record.skillVersion,
        instructions: record.instructions,
        allowedTools: record.allowedTools,
      }
    : undefined
  return parseContract(RunSnapshotSchema, {
    runId: record.runId,
    conversationId: record.conversationId,
    runtime: record.runtime,
    status: record.status,
    version: record.version,
    consumedSteps: record.consumedSteps,
    ...(selectedSkill ? { selectedSkill } : {}),
    cursor: {
      runId: record.runId,
      sequence: last?.sequence ?? 0,
      ...(last ? { eventId: last.eventId } : {}),
    },
  })
}

export const createProjectionService = (database: DatabaseClient) => ({
  get: async (input: unknown) => {
    const parsed = parseContract(projectionInputSchema, input)
    const run = await loadSnapshot(database, parsed.runId)
    const events = projectEvents(await parseEvents(database, parsed.runId, 0), parsed.viewer)
    return parsed.viewer === "user"
      ? parseContract(UserProjectionSchema, { viewer: parsed.viewer, run, events })
      : parseContract(AdminProjectionSchema, { viewer: parsed.viewer, run, events })
  },
  events: async (input: unknown) => {
    const parsed = parseContract(eventCatchupInputSchema, input)
    const inspectedEvents = await parseEvents(database, parsed.runId, parsed.afterSequence ?? 0)
    const visibleEvents = projectEvents(inspectedEvents, parsed.viewer)
    const lastInspected = inspectedEvents.at(-1)
    return parseContract(RunEventsOutputSchema, {
      events: visibleEvents,
      cursor: {
        runId: parsed.runId,
        sequence: lastInspected?.sequence ?? parsed.afterSequence ?? 0,
        ...(lastInspected ? { eventId: lastInspected.eventId } : {}),
      },
    })
  },
})

import type { SkillSnapshot } from "@agentic-chat/contracts"
import { eq } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { adminCommands, runSkillSnapshots } from "../schema/index.js"

export type AdminCommandRecord = {
  readonly id: string
  readonly conversationId: string
  readonly instruction: string
  readonly expiresAt: Date
  readonly idempotencyKey: string
}

export const storeAdminCommand = async (
  database: DatabaseClient,
  command: AdminCommandRecord,
): Promise<typeof adminCommands.$inferSelect> => {
  const stored = await database.db
    .insert(adminCommands)
    .values({
      ...command,
      actorId: "mvp_admin",
      visibility: "model_only",
      status: "accepted",
    })
    .onConflictDoNothing({ target: adminCommands.idempotencyKey })
    .returning()
  const inserted = stored[0]
  if (inserted) {
    return inserted
  }
  const existing = await database.db
    .select()
    .from(adminCommands)
    .where(eq(adminCommands.idempotencyKey, command.idempotencyKey))
    .limit(1)
  const replay = existing[0]
  if (!replay) {
    throw new TypeError(`Admin command ${command.idempotencyKey} was not stored`)
  }
  return replay
}

export const attachRunSkillSnapshot = async (
  database: DatabaseClient,
  runId: string,
  skill: SkillSnapshot,
): Promise<void> => {
  await database.db.insert(runSkillSnapshots).values({
    runId,
    skillId: skill.skillId,
    skillVersion: skill.version,
    instructions: skill.instructions,
    allowedTools: skill.allowedTools,
  })
}

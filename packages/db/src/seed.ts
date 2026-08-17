import type { DatabaseClient } from "./database.js"
import { roles, skills, skillVersions, tools, toolVersions, users } from "./schema/index.js"
import { MVP_SKILLS, MVP_TOOLS } from "./seed-data.js"

export const seedDatabase = async (database: DatabaseClient): Promise<void> => {
  await database.db.transaction(async (transaction) => {
    await transaction
      .insert(roles)
      .values([{ id: "user" }, { id: "admin" }])
      .onConflictDoNothing()
    await transaction
      .insert(users)
      .values([
        { id: "mvp_user", roleId: "user" },
        { id: "mvp_admin", roleId: "admin" },
      ])
      .onConflictDoNothing()
    await transaction
      .insert(skills)
      .values(MVP_SKILLS.map((skill) => ({ id: skill.id })))
      .onConflictDoNothing()
    await transaction
      .insert(skillVersions)
      .values(
        MVP_SKILLS.map((skill) => ({
          skillId: skill.id,
          version: skill.version,
          instructions: skill.instructions,
          allowedTools: skill.allowedTools,
        })),
      )
      .onConflictDoNothing()
    await transaction
      .insert(tools)
      .values(MVP_TOOLS.map((tool) => ({ id: tool.id })))
      .onConflictDoNothing()
    await transaction
      .insert(toolVersions)
      .values(
        MVP_TOOLS.map((tool) => ({
          toolId: tool.id,
          version: tool.version,
          mode: tool.mode,
          risk: tool.risk,
          approvalRequired: tool.approvalRequired,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        })),
      )
      .onConflictDoNothing()
  })
}

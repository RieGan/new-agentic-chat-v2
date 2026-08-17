import { fileURLToPath } from "node:url"

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"

import * as schema from "./schema/index.js"

export type DatabaseClient = {
  readonly db: NodePgDatabase<typeof schema>
  readonly pool: Pool
  readonly close: () => Promise<void>
}

export const createDatabase = (connectionString: string): DatabaseClient => {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
  return {
    db: drizzle(pool, { schema }),
    pool,
    close: async () => pool.end(),
  }
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))

export const migrateDatabase = async (database: DatabaseClient): Promise<void> => {
  await migrate(database.db, {
    migrationsFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  })
}

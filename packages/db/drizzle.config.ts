import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env["DATABASE_URL"]

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
})

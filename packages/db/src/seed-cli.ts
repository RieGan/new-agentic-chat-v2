import { createDatabase } from "./database.js"
import { seedDatabase } from "./seed.js"

const databaseUrl = process.env["DATABASE_URL"]
if (!databaseUrl) {
  throw new TypeError("DATABASE_URL is required to seed PostgreSQL")
}

const database = createDatabase(databaseUrl)
try {
  await seedDatabase(database)
} finally {
  await database.close()
}

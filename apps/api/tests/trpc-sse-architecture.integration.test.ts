import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { appRouter } from "../src/router.js"

const API_PROCEDURES = [
  "admin.command.sendHidden",
  "approvals.approve",
  "approvals.get",
  "approvals.listPending",
  "approvals.reject",
  "approvals.subscribe",
  "chat.sendMessage",
  "conversations.create",
  "conversations.get",
  "conversations.list",
  "jobs.get",
  "runs.events",
  "runs.get",
  "runs.list",
  "skills.get",
] as const

describe("tRPC API architecture", () => {
  it("exposes exactly the MVP blueprint procedure subset", () => {
    // Given: the completed Task 15 app router.
    const procedures = Object.keys(appRouter._def.procedures).sort()

    // When: its public procedure paths are enumerated.
    const expected = [...API_PROCEDURES].sort()

    // Then: no generalized or post-MVP procedure is present.
    expect(procedures).toEqual(expected)
  })

  it("keeps model and tool executors out of the API boundary", async () => {
    // Given: every production TypeScript module under apps/api.
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url))
    const entries = await readdir(sourceRoot, { recursive: true })
    const sourceFiles = entries.filter((entry) => entry.endsWith(".ts"))

    // When: the API implementation is inspected as one import surface.
    const sources = await Promise.all(
      sourceFiles.map((entry) => readFile(`${sourceRoot}/${entry}`, "utf8")),
    )
    const implementation = sources.join("\n")

    // Then: runtime executors and token-delta transport remain absent.
    expect(implementation).not.toMatch(/simple-loop|state-workflow|ToolLoopAgent|message\.delta/)
  })
})

/// <reference types="node" />

import { env } from "node:process"
import { defineConfig } from "@playwright/test"

const outputDir = env["COMPOSE_BROWSER_EVIDENCE_DIR"]

export default defineConfig({
  testDir: "./packages/testkit/e2e-compose",
  forbidOnly: true,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: outputDir ?? "./artifacts/validation/compose-browser/playwright",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "on",
    trace: "on",
  },
  projects: [{ name: "compose-browser", testMatch: "*.spec.ts" }],
})

import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./packages/testkit/e2e",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./artifacts/validation/t16/playwright",
  webServer: {
    command: "corepack pnpm exec tsx packages/testkit/e2e/ui-fixture-server.ts",
    url: "http://127.0.0.1:4310/user/chat",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ui-happy",
      testMatch: "ui-happy.spec.ts",
      use: { baseURL: "http://127.0.0.1:4310", screenshot: "on", trace: "on" },
    },
    {
      name: "ui-adversarial",
      testMatch: ["ui-adversarial.spec.ts", "ui-approvals.spec.ts", "ui-races.spec.ts"],
      use: { baseURL: "http://127.0.0.1:4310", screenshot: "on", trace: "on" },
    },
    {
      name: "runtime",
      testIgnore: "**/ui-*.spec.ts",
    },
  ],
})

import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { get } from "node:http"
import { fileURLToPath, pathToFileURL } from "node:url"

import { z } from "zod"

const runtimeSchema = z.enum(["simple_loop", "state_workflow"])
const reportSchema = z.object({
  stats: z.object({
    expected: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    unexpected: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
  }),
})

type Runtime = z.infer<typeof runtimeSchema>
type PlaywrightReport = z.infer<typeof reportSchema>

export class ComposeBrowserRunnerError extends Error {
  readonly name = "ComposeBrowserRunnerError"
}

export const parseComposeBrowserArguments = (
  arguments_: readonly string[],
): { readonly runtime: Runtime; readonly playwrightArguments: readonly string[] } => {
  const runtimeArguments = arguments_.filter((argument) => argument.startsWith("--runtime="))
  if (runtimeArguments.length !== 1) {
    throw new ComposeBrowserRunnerError("Expected exactly one --runtime argument")
  }
  const runtime = runtimeSchema.safeParse(runtimeArguments[0]?.slice("--runtime=".length))
  if (!runtime.success) {
    throw new ComposeBrowserRunnerError("Unsupported Compose browser runtime")
  }
  const playwrightArguments = arguments_.filter((argument) => !argument.startsWith("--runtime="))
  if (playwrightArguments.some((argument) => argument.startsWith("--config"))) {
    throw new ComposeBrowserRunnerError("Compose browser config cannot be overridden")
  }
  if (playwrightArguments.some((argument) => argument.startsWith("--reporter"))) {
    throw new ComposeBrowserRunnerError("Compose browser reporter cannot be overridden")
  }
  return { runtime: runtime.data, playwrightArguments }
}

export const validatePlaywrightReport = (input: unknown): PlaywrightReport => {
  const report = reportSchema.parse(input)
  const executed =
    report.stats.expected + report.stats.skipped + report.stats.unexpected + report.stats.flaky
  if (executed === 0) {
    throw new ComposeBrowserRunnerError("Compose browser run executed zero tests")
  }
  if (report.stats.skipped > 0) {
    throw new ComposeBrowserRunnerError("Compose browser run contained skipped tests")
  }
  if (report.stats.unexpected > 0 || report.stats.flaky > 0) {
    throw new ComposeBrowserRunnerError("Compose browser run did not pass cleanly")
  }
  return report
}

type EvidenceInput = {
  readonly runtime: Runtime
  readonly namespace: string
  readonly report: PlaywrightReport
  readonly durationMs: number
}

export const createEvidenceSummary = (input: EvidenceInput) => ({
  runtime: input.runtime,
  namespace: input.namespace,
  result: "PASS" as const,
  tests: input.report.stats.expected,
  skipped: input.report.stats.skipped,
  durationMs: input.durationMs,
  fixturePorts: { "4310": "unused", "4311": "unused" } as const,
  fixtureProcess: "absent" as const,
})

const workspace = fileURLToPath(new URL("../../..", import.meta.url))

const assertFixtureBoundary = (): void => {
  for (const port of [4310, 4311]) {
    const listener = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"])
    if (listener.status === 0) {
      throw new ComposeBrowserRunnerError(`Fixture port ${port} is already in use`)
    }
  }
  const fixture = spawnSync("pgrep", ["-f", "[u]i-fixture-server\\.ts"])
  if (fixture.status === 0) {
    throw new ComposeBrowserRunnerError("A UI fixture server process is already running")
  }
}

const assertWebReady = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = get("http://127.0.0.1:4173/user/chat", (response) => {
      response.resume()
      if (response.statusCode === 200) resolve()
      else reject(new ComposeBrowserRunnerError("Compose web service is not ready on port 4173"))
    })
    request.setTimeout(5_000, () => request.destroy())
    request.on("error", () =>
      reject(new ComposeBrowserRunnerError("Compose web service is not ready on port 4173")),
    )
  })

const run = async (): Promise<void> => {
  const parsed = parseComposeBrowserArguments(process.argv.slice(2))
  assertFixtureBoundary()
  await assertWebReady()
  const namespace = `${parsed.runtime}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const evidenceDirectory = `${workspace}/artifacts/validation/compose-browser/${parsed.runtime}/${namespace}`
  mkdirSync(evidenceDirectory, { recursive: true })
  const started = performance.now()
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--config=playwright.compose.config.ts",
      "--reporter=json",
      ...parsed.playwrightArguments,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        COMPOSE_BROWSER_RUNTIME: parsed.runtime,
        COMPOSE_BROWSER_NAMESPACE: namespace,
        COMPOSE_BROWSER_EVIDENCE_DIR: evidenceDirectory,
      },
    },
  )
  assertFixtureBoundary()
  if (result.error !== undefined) throw result.error
  const report = validatePlaywrightReport(JSON.parse(result.stdout))
  if (result.status !== 0) {
    throw new ComposeBrowserRunnerError("Playwright Compose browser execution failed")
  }
  const summary = createEvidenceSummary({
    runtime: parsed.runtime,
    namespace,
    report,
    durationMs: Math.round(performance.now() - started),
  })
  writeFileSync(`${evidenceDirectory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void run().catch((error: unknown) => {
    const message =
      error instanceof ComposeBrowserRunnerError ? error.message : "Compose browser runner failed"
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}

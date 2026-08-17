import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const runtimePrefix = "--runtime="
const flowsPrefix = "--flows="
const commandArguments = process.argv.slice(2)
const runtimeArgument = commandArguments.find((argument) => argument.startsWith(runtimePrefix))
const flowsArgument = commandArguments.find((argument) => argument.startsWith(flowsPrefix))
const playwrightArguments = commandArguments.filter(
  (argument) => !argument.startsWith(runtimePrefix) && !argument.startsWith(flowsPrefix),
)
const projectArguments =
  runtimeArgument !== undefined && !playwrightArguments.some((argument) => argument === "--project")
    ? ["--project", "runtime", "--grep", "F(?:0[1-9]|10) "]
    : []
const pnpmExecutable = process.env.npm_execpath
const runtime = runtimeArgument?.slice(runtimePrefix.length)
const workspace = fileURLToPath(new URL("../../..", import.meta.url))

if (pnpmExecutable === undefined) {
  throw new TypeError("Expected pnpm to provide npm_execpath")
}

if (runtime === "simple_loop" || runtime === "state_workflow") {
  rmSync(`${workspace}/artifacts/validation/acceptance/${runtime}`, {
    recursive: true,
    force: true,
  })
}

const testEnvironment = {
  ...process.env,
  ...(runtimeArgument === undefined
    ? {}
    : { TEST_RUNTIME: runtimeArgument.slice(runtimePrefix.length) }),
  ...(flowsArgument === undefined ? {} : { TEST_FLOWS: flowsArgument.slice(flowsPrefix.length) }),
}

const result = spawnSync(
  process.execPath,
  [
    pnpmExecutable,
    "exec",
    "playwright",
    "test",
    "--config",
    "../../playwright.config.ts",
    ...projectArguments,
    ...playwrightArguments,
  ],
  { env: testEnvironment, stdio: "inherit" },
)

if (result.error !== undefined) {
  throw result.error
}

if (result.status === 0 && (runtime === "simple_loop" || runtime === "state_workflow")) {
  const validation = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./validate-acceptance.mjs", import.meta.url)), runtime],
    { stdio: "inherit" },
  )
  if (validation.error !== undefined) throw validation.error
  process.exitCode = validation.status ?? 1
} else {
  process.exitCode = result.status ?? 1
}

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const rootUrl = new URL("../../", import.meta.url)
const baseSource = readFileSync(new URL("compose.yaml", rootUrl), "utf8")
const liveSource = readFileSync(new URL("compose.live.yaml", rootUrl), "utf8")
const workerSource = readFileSync(
  new URL("packages/runtime/src/compose-worker.ts", rootUrl),
  "utf8",
)

const compose = (files, environment = {}) => {
  const argumentsList = ["compose"]
  for (const file of files) argumentsList.push("-f", file)
  argumentsList.push("config", "--format", "json")
  const result = spawnSync("docker", argumentsList, {
    cwd: new URL(".", rootUrl),
    encoding: "utf8",
    env: { ...process.env, ...environment },
  })
  assert.equal(result.status, 0, "Compose provider structure must resolve")
  return JSON.parse(result.stdout)
}

const providerVariables = ["OPENAI_MODEL_ID", "OPENAI_BASE_URL", "OPENAI_API_KEY"]
const modelWorkers = ["worker-simple", "worker-workflow"]
const base = compose(["compose.yaml"])

for (const workerName of modelWorkers) {
  assert.equal(base.services[workerName].environment.AI_PROVIDER_MODE, "mock")
  for (const variableName of providerVariables) {
    assert.equal(base.services[workerName].environment[variableName], undefined)
  }
}
assert.equal(base.services["fixture-worker"].environment.AI_PROVIDER_MODE, undefined)
for (const variableName of providerVariables) {
  assert.equal(base.services["fixture-worker"].environment[variableName], undefined)
}

const live = compose(["compose.yaml", "compose.live.yaml"], {
  OPENAI_MODEL_ID: "structural-model-sentinel",
  OPENAI_BASE_URL: "https://provider.example.test/v1",
  OPENAI_API_KEY: "structural-key-sentinel",
})
for (const workerName of modelWorkers) {
  assert.equal(live.services[workerName].environment.AI_PROVIDER_MODE, "openai_responses")
  for (const variableName of providerVariables) {
    assert.ok(variableName in live.services[workerName].environment)
  }
  assert.equal(live.services[workerName].environment.NODE_ENV, null)
  assert.equal(live.services[workerName].environment.TASK18_COMPOSE_MODE, null)
}
for (const variableName of providerVariables) {
  assert.equal(live.services["fixture-worker"].environment[variableName], undefined)
}

assert.doesNotMatch(baseSource, /OPENAI_(?:MODEL_ID|BASE_URL|API_KEY)/)
assert.doesNotMatch(liveSource, /fixture-worker|api:|web:/)
assert.match(workerSource, /createComposeProvider\(providerConfiguration\)/)
assert.match(
  workerSource,
  /case "simple_loop":[\s\S]*parseEnvironment\(process\.env\)[\s\S]*runSimpleWorker/,
)
assert.match(
  workerSource,
  /case "state_workflow":[\s\S]*parseEnvironment\(process\.env\)[\s\S]*runWorkflowWorker/,
)

console.log("Compose provider modes are structurally valid")

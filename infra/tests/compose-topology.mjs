import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const composeResult = spawnSync("docker", ["compose", "config", "--format", "json"], {
  encoding: "utf8",
})

assert.equal(composeResult.status, 0, `docker compose config failed:\n${composeResult.stderr}`)

const config = JSON.parse(composeResult.stdout)
const services = config.services
const expectedServices = [
  "api",
  "fixture-worker",
  "migration",
  "postgres",
  "redis",
  "temporal",
  "web",
  "worker-simple",
  "worker-workflow",
]

assert.deepEqual(Object.keys(services).sort(), expectedServices)

const workerNames = ["worker-simple", "worker-workflow", "fixture-worker"]
const workerImages = workerNames.map((name) => services[name].image)
assert.equal(new Set(workerImages).size, 1, "all workers must use one image")
for (const workerName of workerNames) {
  assert.equal(services[workerName].deploy?.resources?.limits?.memory, "268435456")
  assert.equal(services[workerName].deploy?.resources?.reservations, undefined)
}
assert.deepEqual(
  workerNames.map((name) => services[name].deploy?.resources),
  Array.from({ length: workerNames.length }, () => services[workerNames[0]].deploy?.resources),
  "all workers must have equal resource settings",
)

assert.equal(services["worker-simple"].environment.WORKER_ROLE, "simple_loop")
assert.deepEqual(services["worker-simple"].command, ["worker", "simple_loop"])
assert.equal(services["worker-workflow"].environment.WORKER_ROLE, "state_workflow")
assert.deepEqual(services["worker-workflow"].command, ["worker", "state_workflow"])
assert.equal(services["fixture-worker"].environment.WORKER_ROLE, "fixture_jobs")
assert.deepEqual(services["fixture-worker"].command, ["worker", "fixture_jobs"])

const healthyDependencies = ["postgres", "redis", "temporal", "migration"]
for (const serviceName of ["web", "api", ...workerNames]) {
  const dependencies = services[serviceName].depends_on
  for (const dependency of healthyDependencies) {
    assert.equal(
      dependencies[dependency]?.condition,
      "service_healthy",
      `${serviceName} must wait for healthy ${dependency}`,
    )
  }
}

assert.equal(services.migration.depends_on.postgres.condition, "service_healthy")
assert.match(services.postgres.healthcheck.test.join(" "), /pg_isready -h 127\.0\.0\.1/)
assert.match(services.migration.healthcheck.test.join(" "), /migrations-complete/)

const webApiTarget = services.web.environment.VITE_API_TARGET
assert.equal(webApiTarget, "http://api:3000", "web must route tRPC through Docker DNS api")
assert.doesNotMatch(webApiTarget, /127\.0\.0\.1|localhost|0\.0\.0\.0/, "web must not target container loopback")

const postgresMount = services.postgres.volumes.find(
  (volume) => volume.target === "/var/lib/postgresql/data",
)
assert.equal(postgresMount?.type, "volume")
assert.ok(config.volumes[postgresMount.source], "PostgreSQL volume must be declared")

for (const service of Object.values(services)) {
  if (service.image) {
    assert.doesNotMatch(service.image, /:latest$/)
  }
  for (const port of service.ports ?? []) {
    assert.equal(port.host_ip, "127.0.0.1", "published ports must be loopback-only")
  }
}

const composeSource = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8")
assert.doesNotMatch(composeSource, /(?:OPENAI|ANTHROPIC|PRODUCTION|API_KEY|ACCESS_KEY|SECRET_KEY)/i)

console.log("Task 4 Compose topology is valid")

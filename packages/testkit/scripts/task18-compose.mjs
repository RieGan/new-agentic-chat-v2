import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const services = [
  "postgres",
  "redis",
  "temporal",
  "api",
  "web",
  "fixture-worker",
  "worker-simple",
  "worker-workflow",
]

export const createCommandRunner =
  (workspace, evidenceTarget) =>
  (command, arguments_, options = {}) => {
    const started = performance.now()
    const result = spawnSync(command, arguments_, {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 600_000,
      ...options,
    })
    const evidence = {
      command: [command, ...arguments_].join(" "),
      status: result.status,
      durationMs: Math.round(performance.now() - started),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
    evidenceTarget.push(evidence)
    assert.equal(result.status, 0, `${evidence.command}\n${evidence.stdout}\n${evidence.stderr}`)
    return evidence
  }

const captureService = (execute, service) => {
  const container = execute("docker", ["compose", "ps", "-q", service]).stdout.trim()
  assert.notEqual(container, "", `Missing Compose container for ${service}`)
  const inspected = JSON.parse(execute("docker", ["inspect", container]).stdout)[0]
  assert.ok(inspected)
  return {
    service,
    containerId: inspected.Id,
    name: inspected.Name,
    status: inspected.State.Status,
    health: inspected.State.Health?.Status ?? "none",
    startedAt: inspected.State.StartedAt,
    restartCount: inspected.RestartCount,
  }
}

const captureTopology = (execute) =>
  Object.fromEntries(services.map((service) => [service, captureService(execute, service)]))

const waitForHealthy = async (execute, service) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = captureService(execute, service)
    if (state.status === "running" && state.health === "healthy") return state
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.fail(`${service} did not return to healthy`)
}

const control = (execute, service, ...arguments_) => {
  const result = execute("docker", [
    "compose",
    "exec",
    "-T",
    service,
    "node",
    "--conditions=production",
    "--enable-source-maps",
    "/workspace/packages/runtime/dist/compose-control.js",
    ...arguments_,
  ])
  return JSON.parse(result.stdout)
}

const waitForRun = async (execute, service, runId, predicate, description) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const observed = control(execute, service, "inspect", runId)
    if (predicate(observed)) return observed
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.fail(`${description} was not observed for ${runId}`)
}

const assertRecoveredRuns = (input, barriers, completed) => {
  assert.equal(completed.report.run.status, "completed")
  assert.equal(completed.report.jobs.length, 1)
  assert.equal(completed.report.jobs[0].status, "completed")
  assert.equal(completed.report.jobs[0].id, barriers.report.jobs[0].id)
  assert.equal(completed.report.jobs[0].call_id, barriers.report.jobs[0].call_id)
  assert.equal(completed.report.jobs[0].ledger_key, barriers.report.jobs[0].ledger_key)
  assert.equal(
    completed.report.jobs[0].workflow_identity,
    barriers.report.jobs[0].workflow_identity,
  )
  assert.equal(completed.report.events.filter(({ type }) => type === "job.completed").length, 1)
  assert.equal(completed.approval.run.status, "completed")
  assert.equal(completed.approval.approvals.length, 1)
  assert.equal(completed.approval.approvals[0].status, "approved")
  assert.equal(completed.approval.sends.length, 1)
  assert.equal(
    completed.approval.calls.find(({ tool_id }) => tool_id === "notification.send_email")?.status,
    "completed",
  )
  if (input.runtime === "simple_loop") {
    assert.ok(completed.report.run.fencing_version > barriers.report.run.fencing_version)
    assert.ok(completed.approval.run.fencing_version > barriers.approval.run.fencing_version)
  } else {
    assert.equal(completed.report.run.workflow_identity, barriers.report.run.workflow_identity)
    assert.equal(completed.approval.run.workflow_identity, barriers.approval.run.workflow_identity)
  }
}

export const runRuntimeRecovery = async (execute, input) => {
  const service = input.target
  const reportScenario = `${input.runtime}_f10_report`
  const approvalScenario = `${input.runtime}_pending_approval`
  const reportAdmission = control(
    execute,
    service,
    "admit",
    input.runtime,
    "report",
    reportScenario,
  )
  const approvalAdmission = control(
    execute,
    service,
    "admit",
    input.runtime,
    "approval",
    approvalScenario,
  )
  const reportRunId = reportAdmission.receipt.runId
  const approvalRunId = approvalAdmission.receipt.runId
  const barriers = {
    report: await waitForRun(
      execute,
      service,
      reportRunId,
      ({ run, jobs }) => run?.status === "waiting_for_tool" && jobs[0]?.status === "running",
      "durable report progress barrier",
    ),
    approval: await waitForRun(
      execute,
      service,
      approvalRunId,
      ({ run, approvals }) =>
        run?.status === "waiting_for_admin" && approvals[0]?.status === "pending",
      "pending approval barrier",
    ),
  }
  const before = captureTopology(execute)
  assert.ok(
    Object.values(before).every(
      ({ status, health }) => status === "running" && health === "healthy",
    ),
  )
  const restartStarted = performance.now()
  execute("docker", ["compose", "restart", input.target])
  await waitForHealthy(execute, input.target)
  const recoveryMs = Math.round(performance.now() - restartStarted)
  const after = captureTopology(execute)

  assert.equal(after[input.target].containerId, before[input.target].containerId)
  assert.notEqual(after[input.target].startedAt, before[input.target].startedAt)
  assert.equal(after[input.target].health, "healthy")
  assert.equal(after[input.otherWorker].containerId, before[input.otherWorker].containerId)
  assert.equal(after[input.otherWorker].startedAt, before[input.otherWorker].startedAt)
  for (const service of services.filter((name) => name !== input.target)) {
    assert.equal(
      after[service].containerId,
      before[service].containerId,
      `${service} identity changed`,
    )
    assert.equal(
      after[service].startedAt,
      before[service].startedAt,
      `${service} restarted unexpectedly`,
    )
    assert.equal(after[service].health, "healthy", `${service} lost health`)
  }

  control(execute, service, "release_fixture", reportScenario)
  control(execute, service, "approve", approvalRunId, approvalScenario)
  const completed = {
    report: await waitForRun(
      execute,
      service,
      reportRunId,
      ({ run }) => run?.status === "completed",
      "recovered report completion",
    ),
    approval: await waitForRun(
      execute,
      service,
      approvalRunId,
      ({ run }) => run?.status === "completed",
      "recovered approval completion",
    ),
  }
  assertRecoveredRuns(input, barriers, completed)
  const logs = execute("docker", ["compose", "logs", "--no-color", input.target]).stdout
  assert.match(logs, /"event":"worker.ready"/)
  return {
    ...input,
    scenarios: 2,
    recoveryMs,
    runIds: { report: reportRunId, approval: approvalRunId },
    barriers,
    completed,
    before,
    after,
  }
}

export const cleanupTopology = (workspace) => {
  const down = spawnSync("docker", ["compose", "down", "--volumes", "--remove-orphans"], {
    cwd: workspace,
    encoding: "utf8",
  })
  const remaining = spawnSync("docker", ["compose", "ps", "-aq"], {
    cwd: workspace,
    encoding: "utf8",
  })
  const listeningPorts = [3000, 4173, 7233].filter(
    (port) => spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).status === 0,
  )
  return {
    result:
      down.status === 0 && remaining.stdout.trim() === "" && listeningPorts.length === 0
        ? "PASS"
        : "FAIL",
    downStatus: down.status,
    remainingContainers: remaining.stdout.trim().split("\n").filter(Boolean),
    listeningPorts,
  }
}

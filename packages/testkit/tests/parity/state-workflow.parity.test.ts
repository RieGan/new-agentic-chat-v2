import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ApplicationTestContext } from "../../../runtime/tests/application-support.js"
import {
  startApplicationTestContext,
  stopApplicationTestContext,
} from "../../../runtime/tests/application-support.js"
import {
  type SimpleLoopScenario,
  SYNCHRONOUS_FLOW_FIXTURES,
} from "../../../runtime/tests/simple-loop-support.js"
import {
  executeStateWorkflowScenario,
  normalizeStateWorkflowEvidence,
  type StateWorkflowTestEnvironment,
  startStateWorkflowTestEnvironment,
} from "../../../runtime/tests/state-workflow-support.js"

const expectedEventTypes = {
  direct: ["message.completed", "run.status_changed", "message.completed", "run.status_changed"],
  skill: [
    "message.completed",
    "run.status_changed",
    "skill.loaded",
    "message.completed",
    "run.status_changed",
  ],
  calculator: [
    "message.completed",
    "run.status_changed",
    "skill.loaded",
    "tool.call.started",
    "tool.call.completed",
    "message.completed",
    "run.status_changed",
  ],
  divisionByZero: [
    "message.completed",
    "run.status_changed",
    "skill.loaded",
    "tool.call.started",
    "tool.call.failed",
    "message.completed",
    "run.status_changed",
  ],
  missingSkill: [
    "message.completed",
    "run.status_changed",
    "message.completed",
    "run.status_changed",
  ],
  disallowed: [
    "message.completed",
    "run.status_changed",
    "skill.loaded",
    "tool.call.started",
    "tool.call.rejected",
    "message.completed",
    "run.status_changed",
  ],
} as const

const expectedTerminalStatus = {
  direct: "completed",
  skill: "completed",
  calculator: "completed",
  divisionByZero: "completed",
  missingSkill: "failed",
  disallowed: "failed",
} as const satisfies Readonly<Record<keyof typeof expectedEventTypes, "completed" | "failed">>

describe("State Workflow normalized parity traces", () => {
  let context: ApplicationTestContext
  let environment: StateWorkflowTestEnvironment

  beforeAll(async () => {
    ;[context, environment] = await Promise.all([
      startApplicationTestContext(),
      startStateWorkflowTestEnvironment(),
    ])
  }, 120_000)

  afterAll(async () => {
    await Promise.all([stopApplicationTestContext(context), environment.teardown()])
  })

  for (const [name, scenario] of Object.entries(SYNCHRONOUS_FLOW_FIXTURES).filter(([name]) =>
    Object.hasOwn(expectedEventTypes, name),
  ) as readonly [keyof typeof expectedEventTypes, SimpleLoopScenario][]) {
    it(`matches the verified Simple Loop ${name} canonical event order`, async () => {
      // Given: one shared synchronous fixture executes through real Temporal Activities.
      const executed = await executeStateWorkflowScenario(context, environment, scenario)

      // When: architecture-specific Temporal diagnostics are normalized away.
      const trace = normalizeStateWorkflowEvidence(executed.receipt.runId, executed.evidence.events)

      // Then: canonical order matches the existing Simple Loop fixture contract.
      expect(trace.events.map((event) => event.type)).toEqual(expectedEventTypes[name])
      expect(trace.events.every((event) => event.visibility === "user")).toBe(true)
      expect(trace.events.at(-1)?.payload).toMatchObject({ current: expectedTerminalStatus[name] })
    })
  }
})

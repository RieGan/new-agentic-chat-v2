import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { SkillIdSchema } from "@agentic-chat/contracts"
import { describe, expect, it } from "vitest"

import { type AcceptanceRecord, AcceptanceRecordSchema } from "../../src/index.js"
import { assertAcceptanceParity } from "./acceptance-comparison.js"

const workspace = fileURLToPath(new URL("../../../..", import.meta.url))
const acceptanceRoot = `${workspace}/artifacts/validation/acceptance`

const loadRecord = async (runtime: string, recordPath: string): Promise<AcceptanceRecord> =>
  AcceptanceRecordSchema.parse(
    JSON.parse(await readFile(`${acceptanceRoot}/${runtime}/${recordPath}.json`, "utf8")),
  )

const requireValue = <Value>(value: Value | undefined, label: string): Value => {
  if (value === undefined) throw new TypeError(`Missing mutation fixture: ${label}`)
  return value
}

type MutationCase = {
  readonly id: string
  readonly recordPath: string
  readonly mutate: (record: AcceptanceRecord) => void
}

const mutationCases = [
  {
    id: "skill-id",
    recordPath: "F02/P02",
    mutate: (record) => {
      const event = requireValue(
        record.normalizedEventTrace.events.find((candidate) => candidate.type === "skill.loaded"),
        "skill loaded event",
      )
      if (!("skillId" in event.payload)) throw new TypeError("Missing skill identity fixture")
      event.payload.skillId = SkillIdSchema.parse("different_business_skill")
    },
  },
  {
    id: "selected-skill-id",
    recordPath: "F02/P02",
    mutate: (record) => {
      const skill = requireValue(record.observedSkill ?? undefined, "observed skill")
      skill.skillId = "different_business_skill"
    },
  },
  {
    id: "skill-version",
    recordPath: "F02/P02",
    mutate: (record) => {
      const skill = requireValue(record.observedSkill ?? undefined, "observed skill")
      skill.version = "2"
    },
  },
  {
    id: "skill-allowlist",
    recordPath: "F02/P02",
    mutate: (record) => {
      const skill = requireValue(record.observedSkill ?? undefined, "observed skill")
      skill.allowedTools = ["notification.preview"]
    },
  },
  {
    id: "skill-instructions",
    recordPath: "F02/P02",
    mutate: (record) => {
      const skill = requireValue(
        record.projections.admin.run.selectedSkill,
        "selected skill snapshot",
      )
      skill.instructions = "Different machine-consumed instructions"
    },
  },
  {
    id: "tool-argument",
    recordPath: "F03/P03",
    mutate: (record) => {
      const call = requireValue(record.observedToolCalls[0], "tool call")
      call.arguments = { expression: "(125 * 8) + 41" }
    },
  },
  {
    id: "tool-result",
    recordPath: "F03/P03",
    mutate: (record) => {
      const call = requireValue(record.observedToolCalls[0], "tool call")
      call.result = { value: 1041, toolName: "calculator.evaluate" }
    },
  },
  {
    id: "tool-error",
    recordPath: "F04/P04",
    mutate: (record) => {
      const call = requireValue(record.observedToolCalls[0], "tool call")
      call.error = { code: "DIFFERENT_ERROR", message: "Different machine error" }
    },
  },
  {
    id: "approval-actor",
    recordPath: "F07/P08",
    mutate: (record) => {
      const approval = requireValue(record.observedApprovals[0], "approval")
      approval.actorId = "different_admin"
    },
  },
  {
    id: "approval-hash",
    recordPath: "F07/P08",
    mutate: (record) => {
      const event = requireValue(
        record.normalizedEventTrace.events.find(
          (candidate) => candidate.type === "approval.requested",
        ),
        "approval requested event",
      )
      if (!("argumentsHash" in event.payload)) {
        throw new TypeError("Missing approval arguments hash fixture")
      }
      event.payload.argumentsHash = "0".repeat(64)
    },
  },
  {
    id: "approval-decision",
    recordPath: "F07/P08",
    mutate: (record) => {
      const approval = requireValue(record.observedApprovals[0], "approval")
      approval.decision = "rejected"
    },
  },
  {
    id: "job-percent",
    recordPath: "F06/P07",
    mutate: (record) => {
      const job = requireValue(record.observedJobs[0], "job")
      job.percent = 99
    },
  },
  {
    id: "job-result",
    recordPath: "F06/P07",
    mutate: (record) => {
      const job = requireValue(record.observedJobs[0], "job")
      job.result = {
        jobId: "job_001",
        status: "failed",
        reportId: "report_001",
        toolName: "report.generate",
      }
    },
  },
  {
    id: "event-visibility",
    recordPath: "F01/P01",
    mutate: (record) => {
      const event = requireValue(record.normalizedEventTrace.events[0], "normalized event")
      event.visibility = "admin"
    },
  },
  {
    id: "event-type",
    recordPath: "F01/P01",
    mutate: (record) => {
      const event = requireValue(record.normalizedEventTrace.events[0], "normalized event")
      event.type = "skill.loaded"
    },
  },
  {
    id: "event-order",
    recordPath: "F01/P01",
    mutate: (record) => {
      const first = requireValue(record.normalizedEventTrace.events[0], "first event")
      const second = requireValue(record.normalizedEventTrace.events[1], "second event")
      record.normalizedEventTrace.events[0] = second
      record.normalizedEventTrace.events[1] = first
    },
  },
  {
    id: "event-payload",
    recordPath: "F01/P01",
    mutate: (record) => {
      const event = requireValue(record.normalizedEventTrace.events[0], "normalized event")
      if (!("content" in event.payload)) throw new TypeError("Missing message content fixture")
      event.payload.content = "Different user request"
    },
  },
  {
    id: "final-status",
    recordPath: "F01/P01",
    mutate: (record) => {
      record.finalStatus = "failed"
    },
  },
] as const satisfies readonly MutationCase[]

describe("Task 17 parity semantic mutation barriers", () => {
  for (const mutation of mutationCases) {
    it(`fails parity when ${mutation.id} changes`, async () => {
      // Given: one valid cross-runtime acceptance pair and one isolated semantic mutation.
      const simple = await loadRecord("simple_loop", mutation.recordPath)
      const workflow = structuredClone(await loadRecord("state_workflow", mutation.recordPath))

      // When: the workflow record changes only the named semantic dimension.
      mutation.mutate(workflow)

      // Then: the production parity assertion rejects it with a labeled semantic diff.
      expect(() => assertAcceptanceParity(simple, workflow, mutation.id)).toThrow(
        new RegExp(`${mutation.id} (trace|outcome) mismatch`),
      )
    })
  }
})

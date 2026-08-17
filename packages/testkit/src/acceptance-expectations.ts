import type {
  AcceptancePromptId,
  AcceptanceRuntime,
  ObservedAcceptanceCapture,
} from "./acceptance-types.js"

type EventSignature = {
  readonly type: ObservedAcceptanceCapture["normalizedEventTrace"]["events"][number]["type"]
  readonly visibility: ObservedAcceptanceCapture["normalizedEventTrace"]["events"][number]["visibility"]
}

export type ExpectedAcceptanceContract = {
  readonly promptId: AcceptancePromptId
  readonly finalStatus: "completed" | "failed"
  readonly finalResponse: string | null
  readonly skillId: string | null
  readonly calls: readonly Readonly<{ toolName: string; status: string }>[]
  readonly trace: readonly EventSignature[]
}

const user = (type: EventSignature["type"]): EventSignature => ({ type, visibility: "user" })
const admin = (type: EventSignature["type"]): EventSignature => ({ type, visibility: "admin" })
const model = (type: EventSignature["type"]): EventSignature => ({ type, visibility: "model_only" })

const initial = [user("message.completed"), user("run.status_changed")] as const
const terminal = [user("message.completed"), user("run.status_changed")] as const

const synchronous = {
  P01: { finalStatus: "completed", skillId: null, calls: [], trace: [...initial, ...terminal] },
  P02: {
    finalStatus: "completed",
    skillId: "calculator_assistant",
    calls: [],
    trace: [...initial, user("skill.loaded"), ...terminal],
  },
  P03: {
    finalStatus: "completed",
    skillId: "calculator_assistant",
    calls: [{ toolName: "calculator.evaluate", status: "completed" }],
    trace: [
      ...initial,
      user("skill.loaded"),
      user("tool.call.started"),
      user("tool.call.completed"),
      ...terminal,
    ],
  },
  P04: {
    finalStatus: "completed",
    skillId: "calculator_assistant",
    calls: [{ toolName: "calculator.evaluate", status: "failed" }],
    trace: [
      ...initial,
      user("skill.loaded"),
      user("tool.call.started"),
      user("tool.call.failed"),
      ...terminal,
    ],
  },
  P05: { finalStatus: "failed", skillId: null, calls: [], trace: [...initial, ...terminal] },
  P06: {
    finalStatus: "failed",
    skillId: "calculator_assistant",
    calls: [{ toolName: "notification.send_email", status: "rejected" }],
    trace: [
      ...initial,
      user("skill.loaded"),
      user("tool.call.started"),
      user("tool.call.rejected"),
      ...terminal,
    ],
  },
} as const

const reportTrace = [
  ...initial,
  user("skill.loaded"),
  user("job.accepted"),
  user("run.status_changed"),
  user("job.progress"),
  user("job.completed"),
  user("tool.call.completed"),
  user("run.status_changed"),
  ...terminal,
] as const

const approvalPrefix = [
  ...initial,
  user("skill.loaded"),
  user("tool.call.started"),
  user("tool.call.completed"),
  admin("approval.requested"),
  user("run.status_changed"),
] as const

const durable = {
  P07: {
    finalStatus: "completed",
    skillId: "report_assistant",
    calls: [{ toolName: "report.generate", status: "completed" }],
    trace: reportTrace,
  },
  P08: {
    finalStatus: "completed",
    skillId: "communication_assistant",
    calls: [
      { toolName: "notification.preview", status: "completed" },
      { toolName: "notification.send_email", status: "completed" },
    ],
    trace: [
      ...approvalPrefix,
      admin("approval.approved"),
      user("tool.call.completed"),
      user("run.status_changed"),
      ...terminal,
    ],
  },
  P09: {
    finalStatus: "completed",
    skillId: "communication_assistant",
    calls: [
      { toolName: "notification.preview", status: "completed" },
      { toolName: "notification.send_email", status: "rejected" },
    ],
    trace: [
      ...approvalPrefix,
      admin("approval.rejected"),
      user("tool.call.rejected"),
      user("run.status_changed"),
      ...terminal,
    ],
  },
  P10: {
    finalStatus: "completed",
    skillId: null,
    calls: [],
    trace: [
      ...initial,
      user("run.status_changed"),
      model("admin.command.accepted"),
      user("message.completed"),
      model("admin.command.applied"),
      ...terminal,
    ],
  },
  P11: {
    finalStatus: "completed",
    skillId: "report_assistant",
    calls: [{ toolName: "report.generate", status: "completed" }],
    trace: reportTrace,
  },
} as const

const contracts = { ...synchronous, ...durable } satisfies Readonly<
  Record<AcceptancePromptId, Omit<ExpectedAcceptanceContract, "promptId" | "finalResponse">>
>

const responses: Readonly<
  Record<AcceptanceRuntime, Readonly<Record<AcceptancePromptId, string | null>>>
> = {
  simple_loop: {
    P01: "CHAT_OK",
    P02: "calculator_assistant@1",
    P03: "1040",
    P04: "Division by zero is undefined.",
    P05: "The requested skill was not found.",
    P06: "The selected skill cannot perform the requested action.",
    P07: "Report report_001 is complete.",
    P08: "Message message_call_send_wait was sent.",
    P09: "The message was not sent.",
    P10: "ADMIN_GUIDANCE_OK",
    P11: "Report report_001 is complete.",
  },
  state_workflow: {
    P01: "CHAT_OK",
    P02: "calculator_assistant@1",
    P03: "1040",
    P04: "The calculation is undefined because division by zero is not allowed.",
    P05: "The requested skill was not found.",
    P06: "The selected skill cannot perform the requested action.",
    P07: "Report report_001 is complete.",
    P08: "Message sent.",
    P09: "The message was not sent.",
    P10: "ADMIN_GUIDANCE_OK",
    P11: "Report report_001 is complete.",
  },
}

export const expectedAcceptanceContract = (
  runtime: AcceptanceRuntime,
  promptId: AcceptancePromptId,
): ExpectedAcceptanceContract => {
  const base = contracts[promptId]
  return { promptId, ...base, finalResponse: responses[runtime][promptId] }
}

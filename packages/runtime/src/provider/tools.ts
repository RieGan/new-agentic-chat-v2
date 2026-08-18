import {
  CalculatorArgumentsSchema,
  NotificationPreviewArgumentsSchema,
  NotificationSendArgumentsSchema,
  ReportGenerateArgumentsSchema,
} from "@agentic-chat/contracts"
import { dynamicTool, type ToolSet } from "ai"

import { ProviderSkillLoadArgumentsSchema } from "./contracts.js"

const providerToolNameByApplication = {
  "skill.load": "skill_load",
  "calculator.evaluate": "calculator_evaluate",
  "notification.preview": "notification_preview",
  "notification.send_email": "notification_send_email",
  "report.generate": "report_generate",
} as const

type ApplicationToolName = keyof typeof providerToolNameByApplication
export type ProviderTransport = "generate" | "stream"

export const toLanguageModelToolName = (
  toolName: ApplicationToolName,
  transport: ProviderTransport,
): string => (transport === "stream" ? providerToolNameByApplication[toolName] : toolName)

export const fromLanguageModelToolName = (
  toolName: string,
  transport: ProviderTransport,
): string | undefined => {
  if (transport === "generate") return toolName
  switch (toolName) {
    case "skill_load":
      return "skill.load"
    case "calculator_evaluate":
      return "calculator.evaluate"
    case "notification_preview":
      return "notification.preview"
    case "notification_send_email":
      return "notification.send_email"
    case "report_generate":
      return "report.generate"
    default:
      return undefined
  }
}

const skillLoad = dynamicTool({
  description: "Load an exact versioned skill",
  inputSchema: ProviderSkillLoadArgumentsSchema,
})
const calculator = dynamicTool({
  description: "Evaluate an arithmetic expression",
  inputSchema: CalculatorArgumentsSchema,
})
const notificationPreview = dynamicTool({
  description: "Preview a notification",
  inputSchema: NotificationPreviewArgumentsSchema,
})
const notificationSend = dynamicTool({
  description: "Send an approved notification preview",
  inputSchema: NotificationSendArgumentsSchema,
})
const report = dynamicTool({
  description: "Generate a report",
  inputSchema: ReportGenerateArgumentsSchema,
})

const scriptedProviderTools = {
  "skill.load": skillLoad,
  "calculator.evaluate": calculator,
  "notification.preview": notificationPreview,
  "notification.send_email": notificationSend,
  "report.generate": report,
} as const satisfies ToolSet

const openAiProviderTools = {
  skill_load: skillLoad,
  calculator_evaluate: calculator,
  notification_preview: notificationPreview,
  notification_send_email: notificationSend,
  report_generate: report,
} as const satisfies ToolSet

export const providerToolsFor = (transport: ProviderTransport): ToolSet =>
  transport === "stream" ? openAiProviderTools : scriptedProviderTools

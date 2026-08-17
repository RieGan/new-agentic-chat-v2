import {
  CalculatorArgumentsSchema,
  NotificationPreviewArgumentsSchema,
  NotificationSendArgumentsSchema,
  ReportGenerateArgumentsSchema,
} from "@agentic-chat/contracts"
import { dynamicTool, type ToolSet } from "ai"

import { ProviderSkillLoadArgumentsSchema } from "./contracts.js"

export const providerTools: ToolSet = {
  "skill.load": dynamicTool({
    description: "Load an exact versioned skill",
    inputSchema: ProviderSkillLoadArgumentsSchema,
  }),
  "calculator.evaluate": dynamicTool({
    description: "Evaluate an arithmetic expression",
    inputSchema: CalculatorArgumentsSchema,
  }),
  "notification.preview": dynamicTool({
    description: "Preview a notification",
    inputSchema: NotificationPreviewArgumentsSchema,
  }),
  "notification.send_email": dynamicTool({
    description: "Send an approved notification preview",
    inputSchema: NotificationSendArgumentsSchema,
  }),
  "report.generate": dynamicTool({
    description: "Generate a report",
    inputSchema: ReportGenerateArgumentsSchema,
  }),
} as const

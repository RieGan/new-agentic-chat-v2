import {
  AiToolCallRequestSchema,
  CalculatorArgumentsSchema,
  InvalidApprovalError,
  InvalidSchemaError,
  JobStatusArgumentsSchema,
  parseContract,
  SkillNotFoundError,
  ToolResultSchema,
} from "@agentic-chat/contracts"

import { evaluateExpression } from "./calculator.js"
import { getSkillDefinitions, getToolDefinitions, isAiToolDefinition } from "./definitions.js"
import { createInvocationLedger, type InvocationLedger } from "./ledger.js"
import { denyDirectSend, previewNotification, simulateApprovedSend } from "./notification.js"
import {
  ApprovedSendRequestSchema,
  assertAllowed,
  cloneSkill,
  invalidSchemaData,
  JobLookupResultSchema,
  resolveSelectedSkill,
  SkillLookupSchema,
  skillNotFoundData,
  type ToolRegistry,
} from "./registry-support.js"

export type { JobStatusLookup, SkillLoadResult, ToolRegistry } from "./registry-support.js"

export const createToolRegistry = (
  options: { readonly ledger?: InvocationLedger } = {},
): ToolRegistry => {
  const ledger = options.ledger ?? createInvocationLedger()

  return {
    loadSkill(input) {
      const parsed = SkillLookupSchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          error: invalidSchemaData(
            new InvalidSchemaError(
              parsed.error.issues.map(
                (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
              ),
            ),
          ),
        }
      }
      const skill = getSkillDefinitions().find(
        (candidate) =>
          candidate.skillId === parsed.data.skillId && candidate.version === parsed.data.version,
      )
      if (skill === undefined) {
        const error = new SkillNotFoundError(`${parsed.data.skillId}@${parsed.data.version}`)
        return { ok: false, error: skillNotFoundData(error) }
      }
      return { ok: true, skill: cloneSkill(skill) }
    },

    getAllowedAiToolDefinitions(skillInput) {
      const skill = resolveSelectedSkill(skillInput)
      return getToolDefinitions().filter(
        (definition) =>
          isAiToolDefinition(definition) && skill.allowedTools.includes(definition.id),
      )
    },

    executeAiTool(skillInput, input) {
      const skill = resolveSelectedSkill(skillInput)
      const request = parseContract(AiToolCallRequestSchema, input)
      try {
        assertAllowed(skill, request)
      } catch (error) {
        ledger.record({ callId: request.callId, toolName: request.toolName, outcome: "denied" })
        throw error
      }

      if (request.toolName === "notification.send_email") {
        ledger.record({ callId: request.callId, toolName: request.toolName, outcome: "denied" })
        return denyDirectSend()
      }

      try {
        switch (request.toolName) {
          case "calculator.evaluate": {
            const arguments_ = parseContract(CalculatorArgumentsSchema, request.arguments)
            const result = parseContract(ToolResultSchema, {
              toolName: request.toolName,
              value: evaluateExpression(arguments_.expression),
            })
            ledger.record({
              callId: request.callId,
              toolName: request.toolName,
              outcome: "succeeded",
            })
            return result
          }
          case "notification.preview": {
            const result = previewNotification(request.arguments)
            ledger.record({
              callId: request.callId,
              toolName: request.toolName,
              outcome: "succeeded",
            })
            return result
          }
          case "report.generate":
            throw new InvalidSchemaError([
              "report.generate is asynchronous and cannot execute synchronously",
            ])
        }
      } catch (error) {
        ledger.record({ callId: request.callId, toolName: request.toolName, outcome: "failed" })
        throw error
      }
    },

    executeApprovedSend(skillInput, input, authorization) {
      const skill = resolveSelectedSkill(skillInput)
      const request = parseContract(ApprovedSendRequestSchema, input)
      const syntheticRequest = parseContract(AiToolCallRequestSchema, {
        toolName: "notification.send_email",
        callId: request.callId,
        arguments: request.arguments,
      })
      assertAllowed(skill, syntheticRequest)
      try {
        const result = simulateApprovedSend(request.callId, request.arguments, authorization)
        ledger.record({
          callId: request.callId,
          toolName: "notification.send_email",
          outcome: "succeeded",
        })
        return result
      } catch (error) {
        if (error instanceof InvalidApprovalError) {
          ledger.record({
            callId: request.callId,
            toolName: "notification.send_email",
            outcome: "denied",
          })
        }
        throw error
      }
    },

    getJobStatus(input, dependency) {
      const arguments_ = parseContract(JobStatusArgumentsSchema, input)
      const canonicalStatus = parseContract(
        JobLookupResultSchema,
        dependency.lookup(arguments_.jobId),
      )
      return parseContract(ToolResultSchema, {
        toolName: "job.get_status",
        ...canonicalStatus,
      })
    },

    snapshotDefinitions() {
      return {
        skills: getSkillDefinitions(),
        tools: getToolDefinitions(),
      }
    },
  }
}

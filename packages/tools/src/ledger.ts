import type { CallId, ToolName } from "@agentic-chat/contracts"

export const INVOCATION_OUTCOMES = ["succeeded", "failed", "denied"] as const
export type InvocationOutcome = (typeof INVOCATION_OUTCOMES)[number]

export type InvocationEntry = {
  readonly callId: CallId
  readonly toolName: ToolName
  readonly outcome: InvocationOutcome
}

export type InvocationHook = (entry: InvocationEntry) => void

export interface InvocationLedger {
  record(entry: InvocationEntry): void
  snapshot(): readonly InvocationEntry[]
  count(toolName: ToolName, outcome?: InvocationOutcome): number
  executionCount(toolName: ToolName): number
}

export const createInvocationLedger = (hook?: InvocationHook): InvocationLedger => {
  const entries: InvocationEntry[] = []

  return {
    record(entry) {
      const immutableEntry = Object.freeze({ ...entry })
      entries.push(immutableEntry)
      hook?.(immutableEntry)
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }))
    },
    count(toolName, outcome) {
      return entries.filter(
        (entry) =>
          entry.toolName === toolName && (outcome === undefined || entry.outcome === outcome),
      ).length
    },
    executionCount(toolName) {
      return entries.filter((entry) => entry.toolName === toolName && entry.outcome !== "denied")
        .length
    },
  }
}

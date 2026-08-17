import type { CanonicalEvent, RunState, Runtime } from "@agentic-chat/contracts"

import type { JsonValue } from "../schema/index.js"

export type RunEventRecord = CanonicalEvent extends infer Event
  ? Event extends CanonicalEvent
    ? Omit<Event, "correlationId" | "eventId" | "occurredAt" | "runId"> & {
        readonly correlationId: string
        readonly eventId: string
      }
    : never
  : never

export type DispatchIntentRecord = {
  readonly id: string
  readonly deduplicationKey: string
  readonly topic: string
  readonly payload: JsonValue
}

export type RunTransitionInput = {
  readonly runId: string
  readonly runtime: Runtime
  readonly expectedVersion: number
  readonly status: RunState
  readonly event: RunEventRecord
  readonly dispatch: DispatchIntentRecord
}

export type LeasedRunTransitionInput = RunTransitionInput & {
  readonly owner: string
  readonly fencingVersion: number
}

export type AppendRunEventInput = RunEventRecord & {
  readonly runId: string
}

export type IdempotencyInput = {
  readonly key: string
  readonly scope: string
  readonly requestHash: string
  readonly response: JsonValue
}

export type IdempotencyResult =
  | { readonly kind: "stored"; readonly response: JsonValue }
  | { readonly kind: "replayed"; readonly response: JsonValue }

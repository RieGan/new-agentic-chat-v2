import { randomUUID } from "node:crypto"

import type { DatabaseClient } from "@agentic-chat/db"

export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(kind: string): string
}

export type ApplicationDependencies = {
  readonly database: DatabaseClient
  readonly clock: Clock
  readonly ids: IdGenerator
}

export const systemClock: Clock = { now: () => new Date() }
export const secureIds: IdGenerator = { next: (kind) => `${kind}_${randomUUID()}` }

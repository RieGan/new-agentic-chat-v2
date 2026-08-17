import type { Actor } from "@agentic-chat/contracts"

import type { RunEventSource } from "./events/source.js"
import type { ApiServices } from "./services.js"

export type MvpActor = Extract<Actor, { readonly role: "user" | "admin" }>

export type ApiContext = {
  readonly actor: MvpActor
  readonly services: ApiServices
  readonly events: RunEventSource
}

export const createApiContext = (
  actor: MvpActor,
  services: ApiServices,
  events: RunEventSource,
): ApiContext => ({ actor, services, events })

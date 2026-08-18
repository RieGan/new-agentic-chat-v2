import { createOpenAI } from "@ai-sdk/openai"

import type { EnvironmentConfig } from "../environment.js"
import { createAiSdkProvider } from "./adapter.js"
import type { ModelProvider } from "./contracts.js"
import { createScriptedModel } from "./scripted-model.js"

export type {
  ModelProvider,
  ProviderError,
  ProviderGeneration,
  ProviderMessage,
  ProviderRequest,
  ProviderResult,
  ProviderToolCall,
  ScriptedProviderStep,
} from "./contracts.js"

export type ProviderFactoryOptions = {
  readonly script?: unknown
  readonly fetch?: typeof globalThis.fetch
}

export const createScriptedProvider = (script: unknown): ModelProvider =>
  createAiSdkProvider(createScriptedModel(script), "generate")

export const createProvider = (
  configuration: EnvironmentConfig,
  options: ProviderFactoryOptions = {},
): ModelProvider => {
  switch (configuration.mode) {
    case "mock":
      return createScriptedProvider(options.script ?? [{ kind: "provider_failure" }])
    case "openai_responses": {
      const openai = createOpenAI({
        baseURL: configuration.baseUrl,
        apiKey: configuration.apiKey,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      })
      return createAiSdkProvider(openai.responses(configuration.modelId), "stream")
    }
    default: {
      const exhaustiveConfiguration: never = configuration
      return exhaustiveConfiguration
    }
  }
}

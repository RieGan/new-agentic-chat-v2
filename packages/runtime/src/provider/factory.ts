import { createComposeDeterministicProvider } from "../compose-provider.js"
import type { EnvironmentConfig } from "../environment.js"
import type { ModelProvider } from "./contracts.js"
import { createProvider, type ProviderFactoryOptions } from "./index.js"

export const createComposeProvider = (
  configuration: EnvironmentConfig,
  options: ProviderFactoryOptions = {},
): ModelProvider => {
  switch (configuration.mode) {
    case "mock":
      return createComposeDeterministicProvider()
    case "openai_responses":
      return createProvider(configuration, options)
    default: {
      const exhaustiveConfiguration: never = configuration
      return exhaustiveConfiguration
    }
  }
}

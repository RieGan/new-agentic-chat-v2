import { z } from "zod"

const providerModes = ["mock", "openai_responses"] as const
const openAiEnvironmentVariables = ["OPENAI_MODEL_ID", "OPENAI_BASE_URL", "OPENAI_API_KEY"] as const

const providerModeSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? "mock" : value),
  z.enum(providerModes),
)

const openAiEnvironmentSchema = z.object({
  OPENAI_MODEL_ID: z.string().trim().min(1),
  OPENAI_BASE_URL: z.url(),
  OPENAI_API_KEY: z.string().trim().min(1),
})

type OpenAiEnvironmentVariable = (typeof openAiEnvironmentVariables)[number]

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export type EnvironmentConfig =
  | { readonly mode: "mock" }
  | {
      readonly mode: "openai_responses"
      readonly modelId: string
      readonly baseUrl: string
      readonly apiKey: string
    }

export class EnvironmentConfigError extends Error {
  readonly name = "EnvironmentConfigError"
  readonly code = "INVALID_ENVIRONMENT"

  constructor(readonly variables: readonly ("AI_PROVIDER_MODE" | OpenAiEnvironmentVariable)[]) {
    super(`Invalid environment variables: ${variables.join(", ")}`)
  }
}

export const providerRequestTimeoutMs = (configuration: EnvironmentConfig): number => {
  switch (configuration.mode) {
    case "mock":
      return 5_000
    case "openai_responses":
      return 60_000
    default: {
      const exhaustiveConfiguration: never = configuration
      return exhaustiveConfiguration
    }
  }
}

export const parseEnvironment = (environment: RuntimeEnvironment): EnvironmentConfig => {
  const providerModeResult = providerModeSchema.safeParse(environment["AI_PROVIDER_MODE"])
  if (!providerModeResult.success) {
    throw new EnvironmentConfigError(["AI_PROVIDER_MODE"])
  }

  const providerMode = providerModeResult.data
  switch (providerMode) {
    case "mock":
      return { mode: "mock" }
    case "openai_responses": {
      const openAiEnvironmentResult = openAiEnvironmentSchema.safeParse(environment)
      if (!openAiEnvironmentResult.success) {
        const invalidVariables = openAiEnvironmentVariables.filter((variableName) =>
          openAiEnvironmentResult.error.issues.some((issue) => issue.path[0] === variableName),
        )
        throw new EnvironmentConfigError(invalidVariables)
      }

      return {
        mode: "openai_responses",
        modelId: openAiEnvironmentResult.data.OPENAI_MODEL_ID,
        baseUrl: openAiEnvironmentResult.data.OPENAI_BASE_URL,
        apiKey: openAiEnvironmentResult.data.OPENAI_API_KEY,
      }
    }
    default: {
      const exhaustiveMode: never = providerMode
      return exhaustiveMode
    }
  }
}

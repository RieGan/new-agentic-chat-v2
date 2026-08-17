import { describe, expect, it } from "vitest"

import {
  EnvironmentConfigError,
  parseEnvironment,
  type RuntimeEnvironment,
} from "../src/environment.js"

const validOpenAiEnvironment = {
  AI_PROVIDER_MODE: "openai_responses",
  OPENAI_MODEL_ID: "gpt-test",
  OPENAI_BASE_URL: "https://api.example.test/v1",
  OPENAI_API_KEY: "never-print-this-secret",
} satisfies Readonly<Record<string, string>>

const captureConfigError = (environment: RuntimeEnvironment): EnvironmentConfigError => {
  try {
    parseEnvironment(environment)
  } catch (error) {
    if (error instanceof EnvironmentConfigError) {
      return error
    }
    throw error
  }
  return expect.unreachable("environment parsing should fail")
}

describe("parseEnvironment", () => {
  it("returns mock configuration when provider mode and credentials are absent", () => {
    const configuration = parseEnvironment({})

    expect(configuration).toEqual({ mode: "mock" })
  })

  it("returns a typed OpenAI Responses configuration when all live values are valid", () => {
    const configuration = parseEnvironment(validOpenAiEnvironment)

    expect(configuration).toEqual({
      mode: "openai_responses",
      modelId: "gpt-test",
      baseUrl: "https://api.example.test/v1",
      apiKey: "never-print-this-secret",
    })
  })

  it.each(["OPENAI_MODEL_ID", "OPENAI_BASE_URL", "OPENAI_API_KEY"] as const)(
    "returns a typed redacted error when %s is missing in OpenAI Responses mode",
    (variableName) => {
      const environment = { ...validOpenAiEnvironment, [variableName]: "" }

      const error = captureConfigError(environment)

      expect(error.name).toBe("EnvironmentConfigError")
      expect(error.code).toBe("INVALID_ENVIRONMENT")
      expect(error.variables).toEqual([variableName])
      expect(error.message).toContain(variableName)
      expect(error.message).not.toContain(validOpenAiEnvironment.OPENAI_API_KEY)
    },
  )

  it("returns a typed error when provider mode is outside the supported enum", () => {
    const error = captureConfigError({ AI_PROVIDER_MODE: "unsupported" })

    expect(error.variables).toEqual(["AI_PROVIDER_MODE"])
  })

  it("returns a typed error when the OpenAI base URL is malformed", () => {
    const error = captureConfigError({
      ...validOpenAiEnvironment,
      OPENAI_BASE_URL: "not-a-url",
    })

    expect(error.variables).toEqual(["OPENAI_BASE_URL"])
    expect(error.message).not.toContain("not-a-url")
  })
})

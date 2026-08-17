import type { DatabaseClient } from "@agentic-chat/db"
import type { TestInfo } from "@playwright/test"

import {
  type AcceptanceCaptureMetadata,
  type AcceptanceFlowId,
  type AcceptancePromptId,
  type AcceptanceRuntime,
  captureAndWriteAcceptanceEvidence,
} from "../src/index.js"

type AcceptanceEmission = {
  readonly runtime: AcceptanceRuntime
  readonly testId: AcceptanceFlowId
  readonly promptId: AcceptancePromptId
  readonly fixtureNamespace: string
  readonly runId: string
  readonly runtimeDiagnostics: AcceptanceCaptureMetadata["runtimeDiagnostics"]
  readonly executionOutcome: AcceptanceCaptureMetadata["executionOutcome"]
  readonly testInfo: TestInfo
}

export const emitAcceptanceEvidence = (database: DatabaseClient, emission: AcceptanceEmission) =>
  captureAndWriteAcceptanceEvidence(database, {
    runId: emission.runId,
    metadata: {
      runtime: emission.runtime,
      testId: emission.testId,
      promptId: emission.promptId,
      fixtureNamespace: emission.fixtureNamespace,
      testFile: emission.testInfo.file,
      testTitle: emission.testInfo.title,
      runtimeDiagnostics: emission.runtimeDiagnostics,
      executionOutcome: emission.executionOutcome,
    },
  })

import { expect, test } from "@playwright/test"
import { composeNamespace } from "./compose-browser-env.js"
import { attachCorrelationEvidence } from "./compose-browser-evidence.js"
import {
  expectOneFinalMessage,
  inspectAdminRun,
  startUserScenario,
} from "./compose-browser-flow.js"
import { observeBrowser } from "./compose-browser-observation.js"

test("real Compose report reconnects an SSE inspector and remains atomic", async ({
  context,
  page,
}, testInfo) => {
  // Given: a real browser observes only port 4173 and the deterministic report prompt is unique.
  const startedAt = new Date().toISOString()
  const observation = observeBrowser(page)
  const prompt = `TASK18 report ${composeNamespace}_report`

  // When: the selected runtime admits the durable report through the real API and workers.
  const runId = await startUserScenario(page, prompt)

  // Then: canonical persistence catches up queued, progress, completion, and one final message.
  const ledger = page.getByTestId("event-ledger")
  await expect(ledger).toContainText("job.accepted")
  await expect(ledger).toContainText("50% complete")
  await expect(ledger).toContainText("job.completed")
  await expectOneFinalMessage(page, "Report report_001 is complete.")
  await observation.assertUserPrivacy()
  await page.screenshot({ path: testInfo.outputPath("user-report-complete.png"), fullPage: true })

  // Then: closing and reopening Admin creates a new SSE stream from the canonical persisted cursor.
  const firstAdminPage = await context.newPage()
  const firstAdminObservation = observeBrowser(firstAdminPage)
  await inspectAdminRun(firstAdminPage, runId)
  await expect(firstAdminPage.getByTestId("connection-status")).toHaveText("Live connected")
  await firstAdminObservation.assertClean()
  await firstAdminPage.close()
  const reconnectedAdminPage = await context.newPage()
  const reconnectedObservation = observeBrowser(reconnectedAdminPage)
  await inspectAdminRun(reconnectedAdminPage, runId)
  await expect(reconnectedAdminPage.getByTestId("connection-status")).toHaveText("Live connected")
  await expect(reconnectedAdminPage.getByTestId("admin-event-ledger")).toContainText("50% complete")
  await reconnectedAdminPage.screenshot({
    path: testInfo.outputPath("admin-report-reconnected.png"),
    fullPage: true,
  })
  await reconnectedObservation.assertClean()
  await attachCorrelationEvidence(testInfo, { runId, startedAt, kind: "report" })
  await observation.assertClean()
})

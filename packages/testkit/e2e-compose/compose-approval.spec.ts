import { expect, test } from "@playwright/test"
import { composeNamespace, composeRuntime } from "./compose-browser-env.js"
import { attachCorrelationEvidence } from "./compose-browser-evidence.js"
import {
  expectOneFinalMessage,
  inspectAdminRun,
  startUserScenario,
} from "./compose-browser-flow.js"
import { observeBrowser } from "./compose-browser-observation.js"

test("real Compose exact approval decision resumes the same User run once", async ({
  context,
  page,
}, testInfo) => {
  // Given: a unique deterministic approval run is visible in the retained User page.
  const startedAt = new Date().toISOString()
  const userObservation = observeBrowser(page)
  const scenario = `${composeNamespace}_approval`
  const runId = await startUserScenario(page, `TASK18 approval ${scenario}`)
  await expect(page.getByTestId("run-status")).toHaveText("waiting for admin")

  // When: Admin records the exact runtime-specific decision in a separate real browser page.
  const adminPage = await context.newPage()
  const adminObservation = observeBrowser(adminPage)
  await adminPage.goto("/admin/approvals")
  const card = adminPage.getByTestId(/^approval-card-/u).filter({ hasText: runId })
  await expect(card).toHaveCount(1)
  await expect(card).toContainText(runId)
  if (composeRuntime === "simple_loop") {
    await card.getByRole("button", { name: "Approve exact action" }).click()
    await expect(card).toHaveAttribute("data-status", "approved")
  } else {
    await card.getByLabel("Rejection reason").fill("MVP rejection test")
    await card.getByRole("button", { name: "Reject exact action" }).click()
    await expect(card).toHaveAttribute("data-status", "rejected")
  }
  await adminPage.screenshot({
    path: testInfo.outputPath("admin-approval-decision.png"),
    fullPage: true,
  })

  // Then: the retained User run resumes once with the correct side-effect outcome.
  const expectedFinal =
    composeRuntime === "simple_loop"
      ? `Message message_call_send_${scenario} was sent.`
      : "The message was not sent."
  await expectOneFinalMessage(page, expectedFinal)
  await expect(page.getByTestId("message-user").filter({ hasText: scenario })).toHaveCount(1)
  await userObservation.assertUserPrivacy()
  await page.screenshot({ path: testInfo.outputPath("user-approval-complete.png"), fullPage: true })

  // Then: Admin projection and sanitized service evidence identify the same runtime-owned run.
  await inspectAdminRun(adminPage, runId)
  await adminObservation.assertClean()
  await attachCorrelationEvidence(testInfo, { runId, startedAt, kind: "approval" })
  await userObservation.assertClean()
})

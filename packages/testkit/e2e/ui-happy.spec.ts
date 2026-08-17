import { expect, test } from "@playwright/test"

import { capture, observeConsole } from "./ui-test-support.js"

test.describe("Task 16 accessible UI happy paths", () => {
  test("User completes direct and async flows in both runtimes", async ({ page }, testInfo) => {
    // Given: the User route is connected to the deterministic Task 15 transport fixture.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/user/chat")
    const composer = page.getByTestId("message-composer")

    // When: keyboard submission starts a Simple Loop direct run.
    await composer.fill("direct simple response")
    await composer.press("Enter")

    // Then: only the complete durable answer enters the live message log and focus returns.
    await expect(page.getByTestId("message-log")).toContainText(
      "Direct answer from simple loop: direct simple response.",
    )
    await expect(page.getByTestId("run-status")).toHaveText("completed")
    await expect(composer).toBeFocused()

    // When: Simple Loop runs an async report flow.
    await composer.fill("generate report through simple loop")
    await page.getByTestId("send-message").click()

    // Then: its durable job and atomic answer complete.
    await expect(page.getByTestId("message-log")).toContainText("Report completed on simple loop.")

    // When: State Workflow runs a direct flow.
    await page.getByTestId("runtime-selector").selectOption("state_workflow")
    await composer.fill("direct state workflow response")
    await composer.press("Enter")

    // Then: its direct answer is atomically visible.
    await expect(page.getByTestId("message-log")).toContainText(
      "Direct answer from state workflow: direct state workflow response.",
    )

    // When: State Workflow runs an async report flow.
    await composer.fill("generate report for async coverage")
    await page.getByTestId("send-message").click()

    // Then: textual job progress and the atomic final answer arrive without refresh.
    await expect(page.getByTestId("event-ledger")).toContainText("50% complete")
    await expect(page.getByTestId("event-ledger")).toContainText("job.completed")
    await expect(page.getByTestId("message-log")).toContainText(
      "Report completed on state workflow.",
    )
    await expect(composer).toBeFocused()
    await capture(page, testInfo, "user-chat-desktop")
    assertConsoleClean()
  })

  test("Admin inspects a run and sends a model-only hidden command", async ({ page }, testInfo) => {
    // Given: the Admin inspector loads canonical runs.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/admin")
    await expect(page.getByTestId("admin-run-list")).toBeVisible()
    await expect(page.getByTestId("admin-run-projection")).toBeVisible()

    // When: Admin submits hidden guidance with the native form.
    const command = page.getByTestId("hidden-command-input")
    await command.fill("ADMIN_ONLY_FIXTURE_GUIDANCE")
    await page.getByTestId("send-hidden-command").click()

    // Then: lifecycle status is visible, command text is cleared, and focus is preserved.
    await expect(page.getByTestId("admin-notice")).toContainText("Hidden command accepted")
    await expect(page.getByTestId("admin-event-ledger")).toContainText("admin.command.applied")
    await expect(command).toHaveValue("")
    await expect(command).toBeFocused()
    await capture(page, testInfo, "admin-inspector-desktop")
    assertConsoleClean()
  })

  test("Admin approves and rejects exact prepared snapshots", async ({ page }, testInfo) => {
    // Given: two deterministic exact pending snapshots are rendered.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/admin/approvals")
    const approved = page.getByTestId("approval-card-approval_fixture_approve")
    const rejected = page.getByTestId("approval-card-approval_fixture_reject")
    await expect(approved).toContainText("sha256:approval_fixture_approve:exact")
    await expect(approved).toContainText("preview_approval_fixture_approve")
    await expect(approved).toContainText("Version")
    await expect(page.getByTestId("approvals-connection-status")).toContainText("connected")

    // Given: the approval response is held until its SSE-triggered pending refresh completes.
    let releaseDecisionResponse = () => {}
    const decisionResponseGate = new Promise<void>((resolve) => {
      releaseDecisionResponse = resolve
    })
    let markDecisionFetched = () => {}
    const decisionFetched = new Promise<void>((resolve) => {
      markDecisionFetched = resolve
    })
    await page.route("**/trpc/admin/approvals.approve*", async (route) => {
      const response = await route.fetch()
      markDecisionFetched()
      await decisionResponseGate
      await route.fulfill({ response })
    })
    const pendingRefresh = page.waitForResponse((response) =>
      response.url().includes("approvals.listPending"),
    )

    // When: Admin approves while the canonical pending refresh wins the response race.
    await page.getByTestId("approve-approval_fixture_approve").click()
    await decisionFetched
    await pendingRefresh
    releaseDecisionResponse()

    // Then: the decision response is upserted, so the resolved card stays mounted and focused.
    await expect(page.getByTestId("approval-status-approval_fixture_approve")).toHaveText(
      "approved",
    )
    await expect(approved).toBeFocused()

    // When: Admin rejects the second snapshot by keyboard.
    const reason = page.getByTestId("reject-reason-approval_fixture_reject")
    await reason.fill("Recipient is outside the approved test scope")
    await reason.press("Enter")

    // Then: rejection is recorded and focus moves to the retained exact snapshot.
    await expect(page.getByTestId("approval-status-approval_fixture_reject")).toHaveText("rejected")
    await expect(rejected).toBeFocused()
    await capture(page, testInfo, "admin-approvals-desktop")
    assertConsoleClean()
  })
})

import { expect, test } from "@playwright/test"

import { observeConsole } from "./ui-test-support.js"

test.describe("Task 16 deterministic UI races", () => {
  test("Rapid run selection ignores the late projection response", async ({ page }) => {
    // Given: the slow run response is captured and held after the request reaches the server.
    const assertConsoleClean = observeConsole(page)
    let releaseSlowResponse = () => {}
    const slowResponseGate = new Promise<void>((resolve) => {
      releaseSlowResponse = resolve
    })
    let markSlowFetched = () => {}
    const slowFetched = new Promise<void>((resolve) => {
      markSlowFetched = resolve
    })
    let markSlowFulfilled = () => {}
    const slowFulfilled = new Promise<void>((resolve) => {
      markSlowFulfilled = resolve
    })
    await page.route("**/trpc/admin/runs.get*", async (route) => {
      if (!decodeURIComponent(route.request().url()).includes("run_race_slow")) {
        await route.continue()
        return
      }
      const response = await route.fetch()
      markSlowFetched()
      await slowResponseGate
      await route.fulfill({ response })
      markSlowFulfilled()
    })
    await page.goto("/admin")

    // When: Admin selects the slow run and immediately selects the fast run.
    await page.getByTestId("select-run-run_race_slow").click()
    await slowFetched
    await page.getByTestId("select-run-run_race_fast").click()
    const projection = page.getByTestId("admin-run-projection")
    await expect(projection).toContainText("run_race_fast")
    await projection.evaluate((element) => {
      element.dataset.observedStaleProjection = "false"
      const Observer = element.ownerDocument.defaultView?.MutationObserver
      if (Observer === undefined) return
      const observer = new Observer(() => {
        if (element.textContent?.includes("run_race_slow") === true) {
          element.dataset.observedStaleProjection = "true"
        }
      })
      observer.observe(element, { childList: true, subtree: true, characterData: true })
    })
    releaseSlowResponse()
    await slowFulfilled
    await projection.evaluate(
      (element) =>
        new Promise<void>((resolve) =>
          element.ownerDocument.defaultView?.requestAnimationFrame(() =>
            element.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
          ),
        ),
    )

    // Then: the late slow response never replaces the highlighted run's details.
    await expect(page.getByTestId("select-run-run_race_fast")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(projection).toContainText("run_race_fast")
    await expect(projection).not.toContainText("run_race_slow")
    await expect(projection).toHaveAttribute("data-observed-stale-projection", "false")
    assertConsoleClean()
  })

  test("Hidden command completion cannot overwrite a newly selected session", async ({ page }) => {
    // Given: a command response can be released after another session is selected.
    const assertConsoleClean = observeConsole(page)
    let releaseCommandResponse = () => {}
    const commandResponseGate = new Promise<void>((resolve) => {
      releaseCommandResponse = resolve
    })
    let markCommandFetched = () => {}
    const commandFetched = new Promise<void>((resolve) => {
      markCommandFetched = resolve
    })
    await page.route("**/trpc/admin/admin.command.sendHidden*", async (route) => {
      const response = await route.fetch()
      markCommandFetched()
      await commandResponseGate
      await route.fulfill({ response })
    })
    await page.goto("/admin")
    const sessionSelector = page.getByTestId("admin-conversation-selector")
    await sessionSelector.selectOption("conversation_admin_seed")

    // When: Admin submits against one session, selects another session, then receives the response.
    await page.getByTestId("hidden-command-input").fill("RACE_SELECTION_COMMAND")
    await page.getByTestId("send-hidden-command").click()
    await commandFetched
    await sessionSelector.selectOption("conversation_admin_idle")
    releaseCommandResponse()

    // Then: completion leaves the explicit session target unchanged.
    await expect(sessionSelector).toHaveValue("conversation_admin_idle")
    await expect(page.getByTestId("admin-notice")).not.toContainText("Hidden command accepted")
    assertConsoleClean()
  })

  test("Hidden guidance targets a selected session without requiring a run", async ({ page }) => {
    // Given: an idle session with no run remains selectable in Admin.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/admin")
    const sessionSelector = page.getByTestId("admin-conversation-selector")
    await sessionSelector.selectOption("conversation_admin_idle")

    // When: Admin queues guidance directly for that session.
    await page.getByTestId("hidden-command-input").fill("IDLE_SESSION_GUIDANCE")
    await page.getByTestId("send-hidden-command").click()

    // Then: conversation-scoped admission accepts it without a selected execution target.
    await expect(page.getByTestId("admin-notice")).toContainText("Hidden command accepted")
    await expect(page.getByTestId("hidden-command-input")).toHaveValue("")
    await expect(sessionSelector).toHaveValue("conversation_admin_idle")
    assertConsoleClean()
  })
})

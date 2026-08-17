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

  test("Hidden command completion cannot overwrite a newly selected run", async ({ page }) => {
    // Given: command and seed projection responses can be released after another run is selected.
    const assertConsoleClean = observeConsole(page)
    let releaseCommandResponse = () => {}
    const commandResponseGate = new Promise<void>((resolve) => {
      releaseCommandResponse = resolve
    })
    let markCommandFetched = () => {}
    const commandFetched = new Promise<void>((resolve) => {
      markCommandFetched = resolve
    })
    let holdSeedProjection = false
    let releaseSeedProjection = () => {}
    const seedProjectionGate = new Promise<void>((resolve) => {
      releaseSeedProjection = resolve
    })
    let markSeedProjectionFetched = () => {}
    const seedProjectionFetched = new Promise<void>((resolve) => {
      markSeedProjectionFetched = resolve
    })
    let markSeedProjectionFulfilled = () => {}
    const seedProjectionFulfilled = new Promise<void>((resolve) => {
      markSeedProjectionFulfilled = resolve
    })
    await page.route("**/trpc/admin/runs.get*", async (route) => {
      const requestsSeed = decodeURIComponent(route.request().url()).includes("run_seed_admin")
      if (!holdSeedProjection || !requestsSeed) {
        await route.continue()
        return
      }
      const response = await route.fetch()
      markSeedProjectionFetched()
      await seedProjectionGate
      await route.fulfill({ response })
      markSeedProjectionFulfilled()
    })
    await page.route("**/trpc/admin/admin.command.sendHidden*", async (route) => {
      const response = await route.fetch()
      markCommandFetched()
      await commandResponseGate
      await route.fulfill({ response })
    })
    await page.goto("/admin")
    await expect(page.getByTestId("admin-run-projection")).toContainText("run_seed_admin")
    holdSeedProjection = true

    // When: Admin submits against the seed run, selects another run, then receives the response.
    await page.getByTestId("hidden-command-input").fill("RACE_SELECTION_COMMAND")
    await page.getByTestId("send-hidden-command").click()
    await commandFetched
    await page.getByTestId("select-run-run_race_fast").click()
    const projection = page.getByTestId("admin-run-projection")
    await expect(projection).toContainText("run_race_fast")
    await projection.evaluate((element) => {
      element.dataset.observedStaleProjection = "false"
      const Observer = element.ownerDocument.defaultView?.MutationObserver
      if (Observer === undefined) return
      const observer = new Observer(() => {
        if (element.textContent?.includes("run_seed_admin") === true) {
          element.dataset.observedStaleProjection = "true"
        }
      })
      observer.observe(element, { childList: true, subtree: true, characterData: true })
    })
    releaseCommandResponse()
    await seedProjectionFetched
    releaseSeedProjection()
    await seedProjectionFulfilled
    await projection.evaluate(
      (element) =>
        new Promise<void>((resolve) =>
          element.ownerDocument.defaultView?.requestAnimationFrame(() =>
            element.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
          ),
        ),
    )

    // Then: the selected run and rendered projection remain aligned throughout completion.
    await expect(projection).toContainText("run_race_fast")
    await expect(projection).toHaveAttribute("data-observed-stale-projection", "false")
    await expect(page.getByTestId("select-run-run_race_fast")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    assertConsoleClean()
  })
})

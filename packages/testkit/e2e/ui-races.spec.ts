import { expect, test } from "@playwright/test"
import { createTRPCClient, httpLink } from "@trpc/client"

import type { AppRouter } from "../../../apps/api/src/router.js"
import { observeConsole } from "./ui-test-support.js"

const adminClient = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "http://127.0.0.1:4311/trpc/admin" })],
})

test.describe("Task 16 deterministic UI races", () => {
  test("Empty initial approvals discover a request on an already eligible run", async ({
    page,
  }) => {
    // Given: an approvals mount has no pending records but authorized persisted runs are eligible.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/admin/approvals")
    const pendingButtons = page.locator('[data-testid^="approve-"]')
    while ((await pendingButtons.count()) > 0) {
      const button = pendingButtons.first()
      const buttonTestId = await button.getAttribute("data-testid")
      if (buttonTestId === null) throw new TypeError("Approval button test ID missing")
      const decisionResponse = page.waitForResponse((response) =>
        response.url().includes("approvals.approve"),
      )
      await button.click()
      await decisionResponse
      await expect(page.getByTestId(buttonTestId)).toHaveCount(0)
    }
    await page.reload()
    await expect(page.getByText("No pending approvals.")).toBeVisible()
    await expect(page.getByTestId("approvals-connection-status")).toContainText("connected")

    // When: an already eligible run emits its first approval event through the fixture boundary.
    await adminClient.admin.command.sendHidden.mutate({
      runId: "run_race_fast",
      instruction: "CREATE_APPROVAL_FIXTURE_EVENT",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    })

    // Then: its exact pending snapshot appears live without reloading approvals.
    const discovered = page.locator('[data-testid^="approval-card-"]')
    await expect(discovered).toHaveCount(1)
    await expect(discovered).toContainText("run_race_fast")
    await expect(page.locator('[data-testid^="approval-status-"]')).toHaveText("pending")
    assertConsoleClean()
  })

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

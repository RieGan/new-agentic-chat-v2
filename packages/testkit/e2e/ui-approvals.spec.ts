import { expect, test } from "@playwright/test"

import {
  approvalEventSourceCounts,
  clearPendingApprovals,
  createPendingApproval,
  observeApprovalEventSource,
} from "./ui-approval-support.js"
import { capture, captureViewport, observeConsole } from "./ui-test-support.js"

test.describe("Approval UI races", () => {
  test("Approval bootstrap reconciles a request created before run subscriptions", async ({
    page,
  }) => {
    // Given: both StrictMode snapshots are empty while both run-list requests are held.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    let initialSnapshotCount = 0
    let markInitialSnapshotsRead = () => {}
    const initialSnapshotsRead = new Promise<void>((resolve) => {
      markInitialSnapshotsRead = resolve
    })
    await page.route("**/trpc/admin/approvals.listPending*", async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response })
      initialSnapshotCount += 1
      if (initialSnapshotCount === 2) markInitialSnapshotsRead()
    })
    let runListRequestCount = 0
    let markRunListsRequested = () => {}
    const runListsRequested = new Promise<void>((resolve) => {
      markRunListsRequested = resolve
    })
    let releaseRunLists = () => {}
    const runListGate = new Promise<void>((resolve) => {
      releaseRunLists = resolve
    })
    await page.route("**/trpc/admin/runs.list*", async (route) => {
      runListRequestCount += 1
      if (runListRequestCount === 2) markRunListsRequested()
      await runListGate
      await route.continue()
    })
    let targetSubscriptionCount = 0
    page.on("request", (request) => {
      const url = decodeURIComponent(request.url())
      if (url.includes("approvals.subscribe") && url.includes("run_race_fast")) {
        targetSubscriptionCount += 1
      }
    })
    await page.goto("/admin/approvals")
    await Promise.all([initialSnapshotsRead, runListsRequested])
    await expect(page.locator('[data-testid^="approval-card-"]')).toHaveCount(0)
    await expect(page.getByTestId("approvals-loading")).toContainText("Loading pending approvals")
    await expect(page.getByText("No pending approvals.")).toHaveCount(0)

    // When: the approval is persisted before run discovery returns its advanced cursor.
    await createPendingApproval()
    releaseRunLists()

    // Then: subscribe-then-reconcile reveals one card without reload or duplicate subscription.
    await expect(page.getByTestId("approvals-connection-status")).toContainText("connected")
    const discovered = page.locator('[data-testid^="approval-card-"]')
    await expect(discovered).toHaveCount(1)
    await expect(discovered).toContainText("run_race_fast")
    expect(targetSubscriptionCount).toBe(1)
    assertConsoleClean()
  })

  test("Pending approval reflows without horizontal overflow on mobile", async ({
    page,
  }, testInfo) => {
    // Given: one pending approval is rendered at the narrow mobile evidence viewport.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    await createPendingApproval()
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto("/admin/approvals")
    const card = page.locator('[data-testid^="approval-card-"]')
    await expect(card).toHaveCount(1)

    // When: the full approval route and its action region are inspected at mobile width.
    const documentOverflow = await page.locator("html").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    const cardOverflow = await card.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    const approve = page.getByRole("button", { name: "Approve exact action" })
    const reject = page.getByRole("button", { name: "Reject exact action" })
    await approve.scrollIntoViewIfNeeded()
    await reject.scrollIntoViewIfNeeded()

    // Then: the document and card fit, and both exact-decision controls remain reachable.
    expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.clientWidth)
    expect(cardOverflow.scrollWidth).toBeLessThanOrEqual(cardOverflow.clientWidth)
    await expect(approve).toBeVisible()
    await expect(reject).toBeVisible()
    await expect(approve).toBeEnabled()
    await expect(reject).toBeEnabled()
    await capture(page, testInfo, "admin-approvals-mobile-375x667")
    assertConsoleClean()
  })

  test("Approval bootstrap failure replaces loading with the existing error", async ({ page }) => {
    // Given: canonical run discovery fails while approvals are still uninitialized.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    await page.route("**/trpc/admin/runs.list*", async (route) => {
      await route.fulfill({ contentType: "application/json", body: "{}" })
    })

    // When: Admin opens the approvals route.
    await page.goto("/admin/approvals")

    // Then: the established error appears without a permanent loading or false-empty state.
    await expect(page.getByRole("alert")).toContainText("Pending approvals are unavailable")
    await expect(page.getByTestId("approvals-loading")).toHaveCount(0)
    await expect(page.getByText("No pending approvals.")).toHaveCount(0)
    assertConsoleClean()
  })

  test("Keyboard tab exposes the approval action focus ring", async ({ page }, testInfo) => {
    // Given: one pending approval is ready for keyboard-only review.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    await createPendingApproval()
    await page.goto("/admin/approvals")
    const approve = page.locator('[data-testid^="approve-"]')
    await expect(approve).toBeVisible()

    // When: Admin tabs through native navigation to the first approval action.
    for (let tabIndex = 0; tabIndex < 8; tabIndex += 1) {
      if (await approve.evaluate((element) => element === element.ownerDocument.activeElement))
        break
      await page.keyboard.press("Tab")
    }

    // Then: the action is keyboard-focused and displays the design-system focus ring.
    await expect(approve).toBeFocused()
    expect(await approve.evaluate((element) => element.matches(":focus-visible"))).toBe(true)
    const focusStyle = await approve.evaluate((element) => {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element)
      return { outlineStyle: style?.outlineStyle, outlineWidth: style?.outlineWidth }
    })
    expect(focusStyle.outlineStyle).not.toBe("none")
    expect(Number.parseFloat(focusStyle.outlineWidth ?? "0")).toBeGreaterThanOrEqual(2)
    await captureViewport(page, testInfo, "admin-approvals-keyboard-focus")
    assertConsoleClean()
  })

  test("Empty initial approvals discover a request on an already eligible run", async ({
    page,
  }) => {
    // Given: an approvals mount has no pending records but authorized persisted runs are eligible.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    await page.goto("/admin/approvals")
    await expect(page.getByText("No pending approvals.")).toBeVisible()
    await expect(page.getByTestId("approvals-connection-status")).toContainText("connected")

    // When: an already eligible run emits its first approval event through the fixture boundary.
    await createPendingApproval()

    // Then: its exact pending snapshot appears live without reloading approvals.
    const discovered = page.locator('[data-testid^="approval-card-"]')
    await expect(discovered).toHaveCount(1)
    await expect(discovered).toContainText("run_race_fast")
    await expect(page.locator('[data-testid^="approval-status-"]')).toHaveText("pending")
    assertConsoleClean()
  })

  test("Approval subscription closes once when its route unmounts", async ({ page }) => {
    // Given: the real target-run EventSource is observed before the approvals route loads.
    const assertConsoleClean = observeConsole(page)
    await clearPendingApprovals()
    await observeApprovalEventSource(page)
    await page.goto("/admin/approvals")
    await expect(page.getByTestId("approvals-connection-status")).toContainText("connected")
    await expect.poll(() => approvalEventSourceCounts(page)).toEqual({ opened: 1, closed: 0 })

    // When: navigation removes the approvals route and a new approval arrives afterward.
    await page.getByRole("link", { name: "Run inspector" }).click()
    await expect(page.getByTestId("admin-approvals-route")).toHaveCount(0)
    await expect.poll(() => approvalEventSourceCounts(page)).toEqual({ opened: 1, closed: 1 })
    await createPendingApproval()

    // Then: the old route stays absent and its closed subscription cannot update it.
    await expect(page.getByTestId("admin-approvals-route")).toHaveCount(0)
    await expect(page.locator('[data-testid^="approval-card-"]')).toHaveCount(0)
    await expect(approvalEventSourceCounts(page)).resolves.toEqual({ opened: 1, closed: 1 })
    assertConsoleClean()
  })
})

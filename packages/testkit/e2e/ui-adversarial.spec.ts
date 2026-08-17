import { expect, test } from "@playwright/test"

import { capture, captureViewport, observeConsole } from "./ui-test-support.js"

test.describe("Task 16 adversarial UI boundaries", () => {
  test("Desktop header stays sticky and approval headers remain compact", async ({
    context,
    page,
  }, testInfo) => {
    // Given: the approvals route is rendered in a short wide viewport with compact card headers.
    const assertConsoleClean = observeConsole(page)
    const userPage = await context.newPage()
    await userPage.goto("/user/chat")
    await userPage.getByTestId("message-composer").fill("request approval for sticky layout")
    await userPage.getByTestId("send-message").click()
    await expect(userPage.getByTestId("run-status")).toHaveText("waiting for admin")
    await page.setViewportSize({ width: 1280, height: 400 })
    await page.goto("/admin/approvals")
    const topbar = page.locator(".topbar")
    const approvalHeader = page.locator(".approval-card header").first()
    await expect(approvalHeader.locator(".route-header")).toHaveCount(0)
    expect(
      await approvalHeader.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).marginBlockEnd,
      ),
    ).toBe("0px")

    // When: the desktop document scrolls to its end.
    await page
      .locator("html")
      .evaluate((element) => element.ownerDocument.defaultView?.scrollTo(0, element.scrollHeight))

    // Then: navigation remains pinned while the dedicated card header keeps zero route spacing.
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.ownerDocument.defaultView?.scrollY ?? 0),
    ).toBeGreaterThan(0)
    expect(
      await topbar.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).position,
      ),
    ).toBe("sticky")
    expect(
      Math.round(await topbar.evaluate((element) => element.getBoundingClientRect().top)),
    ).toBe(0)
    await captureViewport(page, testInfo, "admin-approvals-scrolled-desktop")
    assertConsoleClean()
    await userPage.close()
  })

  test("User DOM excludes Admin content and partial-message paths", async ({ page }, testInfo) => {
    // Given: an Admin command has been accepted for a persisted run.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/admin")
    await page.getByTestId("hidden-command-input").fill("TOP_SECRET_ADMIN_COMMAND")
    await page.getByTestId("send-hidden-command").click()
    await expect(page.getByTestId("admin-notice")).toContainText("Hidden command accepted")

    // When: the same browser navigates to the role-isolated User route and starts approval wait.
    await page.goto("/user/chat")
    await page.getByTestId("message-composer").fill("request approval for notification")
    await page.getByTestId("send-message").click()
    await expect(page.getByTestId("run-status")).toHaveText("waiting for admin")

    // Then: no Admin action, decision metadata, command text, hidden payload, or delta path exists.
    const body = page.locator("body")
    await expect(body).not.toContainText("TOP_SECRET_ADMIN_COMMAND")
    await expect(body).not.toContainText("Run inspector")
    await expect(body).not.toContainText("Approve exact action")
    await expect(body).not.toContainText("arguments hash", { ignoreCase: true })
    await expect(body).not.toContainText("mvp_admin")
    await expect(body).not.toContainText("message.delta")
    await expect(
      page.getByTestId("message-log").getByText("request approval for notification"),
    ).toHaveCount(1)
    await capture(page, testInfo, "user-privacy-wait")
    assertConsoleClean()
  })

  test("Invalid cursor recovery refetches canonically and suppresses duplicates", async ({
    page,
  }) => {
    // Given: the fixture returns one deliberately stale run cursor.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/user/chat")

    // When: the User starts the stale-cursor reconnect scenario.
    await page.getByTestId("message-composer").fill("stale reconnect direct response")
    await page.getByTestId("send-message").click()

    // Then: recovery is visible, the final message appears once, and connection resumes.
    await expect(page.getByTestId("recovery-status")).toContainText(/recovered|completed/i)
    const finalAnswer = "Direct answer from simple loop: stale reconnect direct response."
    await expect(page.getByTestId("message-log")).toContainText(finalAnswer)
    await expect(page.getByTestId("message-log").getByText(finalAnswer)).toHaveCount(1)
    await expect(page.getByTestId("connection-status")).toContainText(/connected|connecting/)
    assertConsoleClean()
  })

  test("Keyboard validation, not-found routing, and mobile reflow remain usable", async ({
    page,
  }, testInfo) => {
    // Given: a narrow mobile viewport and an empty composer.
    const assertConsoleClean = observeConsole(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/user/chat")
    expect(
      await page
        .locator(".topbar")
        .evaluate(
          (element) => element.ownerDocument.defaultView?.getComputedStyle(element).position,
        ),
    ).toBe("static")

    // When: Enter submits an empty native form.
    const composer = page.getByTestId("message-composer")
    await composer.focus()
    await composer.press("Enter")

    // Then: inline validation is announced, focus stays put, and no horizontal overflow exists.
    await expect(page.getByRole("alert")).toContainText("Enter a message")
    await expect(composer).toBeFocused()
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(375)
    await capture(page, testInfo, "user-chat-mobile")

    // When: an unknown explicit URL is loaded.
    await page.goto("/unknown-route")

    // Then: useful native links recover navigation without a blank screen.
    await expect(page.getByRole("heading", { name: "Route not found" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Open User chat" })).toHaveAttribute(
      "href",
      "/user/chat",
    )
    assertConsoleClean()
  })
})

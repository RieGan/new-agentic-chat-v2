import { expect, test } from "@playwright/test"

import { observeConsole } from "./ui-test-support.js"

test.describe("Conversation session boundaries", () => {
  test("User creates and switches durable isolated sessions", async ({ page }) => {
    // Given: the User has no persisted conversations.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/user/chat")
    const selector = page.getByTestId("conversation-selector")
    await expect(selector.locator("option")).toHaveCount(1)
    const firstConversationId = await selector.inputValue()
    expect(firstConversationId).toMatch(/^conversation_[0-9a-f-]+$/)

    // When: the User sends in the auto-created session and creates another one.
    const composer = page.getByTestId("message-composer")
    await composer.fill("first session durable answer")
    await composer.press("Enter")
    await expect(page.getByTestId("message-log")).toContainText("first session durable answer")
    const createButton = page.getByTestId("create-conversation")
    await createButton.focus()
    await createButton.press("Enter")
    await expect(selector.locator("option")).toHaveCount(2)
    const secondConversationId = await selector.inputValue()
    expect(secondConversationId).not.toBe(firstConversationId)
    await expect(page.getByTestId("message-log")).not.toContainText("first session durable answer")
    await composer.fill("second session durable answer")
    await composer.press("Enter")
    await expect(page.getByTestId("message-log")).toContainText("second session durable answer")

    // Then: each native-select choice restores only its own persisted messages.
    await selector.focus()
    await expect(selector).toBeFocused()
    await selector.selectOption(firstConversationId)
    await expect(selector).toHaveValue(firstConversationId)
    await expect(page.getByTestId("message-log")).toContainText("first session durable answer")
    await expect(page.getByTestId("message-log")).not.toContainText("second session durable answer")
    await selector.selectOption(secondConversationId)
    await expect(selector).toHaveValue(secondConversationId)
    await expect(page.getByTestId("message-log")).toContainText("second session durable answer")
    await expect(page.getByTestId("message-log")).not.toContainText("first session durable answer")
    assertConsoleClean()
  })

  test("Late conversation response cannot overwrite a newer selection", async ({ page }) => {
    // Given: two sessions have distinct persisted messages and the first reload is held.
    const assertConsoleClean = observeConsole(page)
    await page.goto("/user/chat")
    const selector = page.getByTestId("conversation-selector")
    await expect.poll(() => selector.locator("option").count()).toBeGreaterThan(0)
    const initialCount = await selector.locator("option").count()
    const firstConversationId = await selector.inputValue()
    const composer = page.getByTestId("message-composer")
    await composer.fill("first response marker")
    await composer.press("Enter")
    await expect(page.getByTestId("message-log")).toContainText("first response marker")
    await page.getByTestId("create-conversation").click()
    await expect(selector.locator("option")).toHaveCount(initialCount + 1)
    const secondConversationId = await selector.inputValue()
    await composer.fill("second response marker")
    await composer.press("Enter")
    await expect(page.getByTestId("message-log")).toContainText("second response marker")

    let releaseFirstResponse = () => {}
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve
    })
    let markFirstFetched = () => {}
    const firstFetched = new Promise<void>((resolve) => {
      markFirstFetched = resolve
    })
    let markFirstFulfilled = () => {}
    const firstFulfilled = new Promise<void>((resolve) => {
      markFirstFulfilled = resolve
    })
    await page.route("**/trpc/user/conversations.get*", async (route) => {
      if (!decodeURIComponent(route.request().url()).includes(firstConversationId)) {
        await route.continue()
        return
      }
      const response = await route.fetch()
      markFirstFetched()
      await firstResponseGate
      await route.fulfill({ response })
      markFirstFulfilled()
    })

    // When: the User selects the slow session, then returns to the current session.
    await selector.selectOption(firstConversationId)
    await firstFetched
    await selector.selectOption(secondConversationId)
    await expect(page.getByTestId("message-log")).toContainText("second response marker")
    releaseFirstResponse()
    await firstFulfilled
    await page
      .getByTestId("message-log")
      .evaluate(
        (element) =>
          new Promise<void>((resolve) =>
            element.ownerDocument.defaultView?.requestAnimationFrame(() => resolve()),
          ),
      )

    // Then: the late response never leaks the stale session into the current message log.
    await expect(page.getByTestId("message-log")).not.toContainText("first response marker")
    await expect(selector).toHaveValue(secondConversationId)
    assertConsoleClean()
  })
})

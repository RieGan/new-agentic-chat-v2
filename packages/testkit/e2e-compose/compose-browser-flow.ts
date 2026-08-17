import { expect, type Page } from "@playwright/test"

import { composeRuntime } from "./compose-browser-env.js"

const runValue = (page: Page) =>
  page
    .locator(".meta-row")
    .filter({ has: page.getByText("Run", { exact: true }) })
    .locator("dd")

export const startUserScenario = async (page: Page, prompt: string): Promise<string> => {
  await page.goto("/user/chat")
  await page.getByTestId("runtime-selector").selectOption(composeRuntime)
  await page.getByTestId("message-composer").fill(prompt)
  await page.getByTestId("send-message").click()
  await expect(runValue(page)).toHaveText(/^run_[a-z0-9-]+$/u)
  return (await runValue(page).innerText()).trim()
}

export const expectOneFinalMessage = async (page: Page, text: string): Promise<void> => {
  await expect(page.getByTestId("run-status")).toHaveText("completed")
  const messages = page.getByTestId("message-ai")
  await expect(messages.last().locator("p")).toHaveText(text)
}

export const inspectAdminRun = async (page: Page, runId: string): Promise<void> => {
  await page.goto("/admin")
  const runButton = page.getByTestId(`select-run-${runId}`)
  await expect(runButton).toContainText(composeRuntime.replaceAll("_", " "))
  await runButton.click()
  const projection = page.getByTestId("admin-run-projection")
  await expect(projection).toContainText(runId)
  await expect(projection).toContainText(composeRuntime.replaceAll("_", " "))
}

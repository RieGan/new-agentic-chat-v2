import { expect, type Page, type TestInfo } from "@playwright/test"

export const observeConsole = (page: Page) => {
  const failures: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  page.on("pageerror", (error) => failures.push(error.message))
  return () => expect(failures, "browser console and page errors").toEqual([])
}

export const capture = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(`${name}.png`)
  await page
    .locator("html")
    .evaluate((element) =>
      element.ownerDocument.defaultView?.scrollTo({ top: 0, behavior: "instant" }),
    )
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: "image/png" })
}

export const captureViewport = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: "image/png" })
}

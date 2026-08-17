import { expect, type Page } from "@playwright/test"

const forbiddenUserContent =
  /ADMIN_ONLY|argumentsHash|requiredActor|expectedVersion|OPENAI_API_KEY|Bearer\s|sk-[a-z0-9]|message\.delta/iu

export type BrowserObservation = {
  readonly assertClean: () => Promise<void>
  readonly assertUserPrivacy: () => Promise<void>
}

export const observeBrowser = (page: Page): BrowserObservation => {
  const failures: string[] = []
  const userResponses: string[] = []
  const pendingBodies: Promise<void>[] = []

  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`)
  })
  page.on("pageerror", (error) => failures.push(`page:${error.message}`))
  page.on("requestfailed", (request) => {
    const url = request.url()
    const subscription = url.includes("runs.events") || url.includes("approvals.subscribe")
    const subscriptionCancelled =
      subscription && request.failure()?.errorText === "net::ERR_ABORTED"
    if (subscriptionCancelled) return
    failures.push(`request:${url}`)
  })
  page.on("response", (response) => {
    const url = response.url()
    if (url.includes("/trpc/") && response.status() >= 400) {
      failures.push(`trpc:${response.status()}:${new URL(url).pathname}`)
    }
    if (!url.includes("/trpc/user/") || url.includes("runs.events")) return
    pendingBodies.push(
      response
        .text()
        .then((body) => {
          userResponses.push(body)
        })
        .catch((error: unknown) => {
          failures.push(
            error instanceof Error ? `response:${error.message}` : "response:unreadable",
          )
        }),
    )
  })

  return {
    assertClean: async () => {
      await Promise.all(pendingBodies)
      expect(failures, "browser console, page, and unexpected tRPC failures").toEqual([])
    },
    assertUserPrivacy: async () => {
      await Promise.all(pendingBodies)
      const rendered = await page.locator("body").innerText()
      expect(`${rendered}\n${userResponses.join("\n")}`).not.toMatch(forbiddenUserContent)
    },
  }
}

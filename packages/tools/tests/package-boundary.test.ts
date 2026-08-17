import type { ApprovalAuthorization } from "@agentic-chat/tools"
import * as rootExports from "@agentic-chat/tools"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import packageJson from "../package.json" with { type: "json" }

const PackageBoundarySchema = z.looseObject({
  exports: z
    .object({
      ".": z
        .object({
          production: z.literal("./dist/index.js"),
          default: z.literal("./src/index.ts"),
        })
        .strict(),
      "./approval-internal": z
        .object({
          production: z.literal("./dist/approval-internal.js"),
          default: z.literal("./src/approval-internal.ts"),
        })
        .strict(),
    })
    .strict(),
  scripts: z.looseObject({ test: z.literal("vitest run") }),
})

const preserveOpaqueAuthorizationType = (
  authorization: ApprovalAuthorization,
): ApprovalAuthorization => authorization

describe("tools package boundary", () => {
  it("does not expose approval capability minting from the root package", () => {
    // Given
    const issuerExport = "createApprovalAuthorizationIssuer"

    // When
    const rootCanMintAuthorization = Object.hasOwn(rootExports, issuerExport)

    // Then
    expect(rootCanMintAuthorization).toBe(false)
    expect(preserveOpaqueAuthorizationType).toBeTypeOf("function")
  })

  it("publishes issuance only through an internal subpath and fails closed without tests", () => {
    // Given / When
    const parsedManifest = PackageBoundarySchema.safeParse(packageJson)

    // Then
    expect(parsedManifest.success).toBe(true)
  })
})

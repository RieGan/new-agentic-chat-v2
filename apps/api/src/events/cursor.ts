import { type SnapshotCursor, SnapshotCursorSchema } from "@agentic-chat/contracts"
import { z } from "zod"

export class CursorInvalidatedError extends Error {
  readonly name = "CursorInvalidatedError"
  readonly refetch = "canonical_snapshot" as const

  constructor() {
    super("Canonical snapshot refetch required")
  }
}

export const encodeTrackedCursor = (cursor: SnapshotCursor): string =>
  Buffer.from(JSON.stringify(SnapshotCursorSchema.parse(cursor))).toString("base64url")

export const decodeTrackedCursor = (value: string): SnapshotCursor => {
  try {
    return SnapshotCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new CursorInvalidatedError()
    }
    throw error
  }
}

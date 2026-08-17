# Task 15 failure-path verification

Validated on 2026-08-17.

- Strict Zod input rejects unknown chat fields before admission.
- A User caller receives `FORBIDDEN` for Admin command and approval subscription procedures.
- Serialized User projections, tracked frames, and errors contain no hidden Admin instruction, rejection reason, or provider-secret fixture.
- Hidden-only canonical sequences are inspected without yield; the next visible tracked cursor advances past the hidden tail.
- A commit immediately after listener registration is caught once, and the overlap notification produces no duplicate.
- Reconnect from the last tracked canonical cursor yields only the next committed event.
- Invalid or stale tracked cursors return `PRECONDITION_FAILED` with typed `refetch: canonical_snapshot` transport data.
- Admin approval subscriptions yield approval events only; User run streams contain no Admin decision payloads.
- Source inspection rejects direct Simple Loop, State Workflow, `ToolLoopAgent`, or `message.delta` imports/usages in `apps/api/src`.

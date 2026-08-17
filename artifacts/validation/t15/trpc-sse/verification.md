# Task 15 tracked tRPC SSE verification

Validated on 2026-08-17 with tRPC server/client 11.18.0 and Zod 4.4.3.

## Behavior

- The public router exposes exactly the 13 MVP blueprint procedures.
- `/trpc/user/` and `/trpc/admin/` construct fixed actors; `mvpUserProcedure` and `mvpAdminProcedure` reject actor mismatch.
- Chat, hidden Admin command, and approval decisions delegate to durable application services and return persisted accepted/decision envelopes without importing runtime executors.
- Run snapshots and event catch-up use persisted viewer-aware projections with canonical inspected-sequence cursors.
- Tracked SSE registers its live source before catch-up, filters before yield, suppresses overlap duplicates by event ID, and removes listeners on iterator return or HTTP disconnect.
- A real Node HTTP server plus `httpSubscriptionLink`/EventSource received one committed `message.completed` event and cleaned up the listener.
- Only canonical persisted events are yielded; no token or `message.delta` transport exists.

## Commands

- `corepack pnpm test:integration -- trpc-sse`: 17 files and 72 tests passed (56 runtime, 16 API).
- `corepack pnpm test:contracts`: 5 files and 75 tests passed.
- `corepack pnpm test:db`: 4 files and 18 tests passed.
- `corepack pnpm lint`: 224 files checked with no findings.
- `corepack pnpm typecheck`: all 8 typed workspace projects passed.
- `corepack pnpm build`: web, tools, DB, runtime, and API builds passed.
- TypeScript no-excuse audit: 27 changed TypeScript files, zero violations.
- LSP diagnostics: API 20 files, contracts 14 files, runtime application 11 files, and changed DB files reported zero errors.

## Production pure LOC

- Largest new API production module: `events/stream.ts`, 93 pure LOC.
- Shared API contracts: 58 pure LOC.
- DB API projection reads: 95 pure LOC.
- Runtime API query facade: 153 pure LOC.

All new production modules remain below 200 pure LOC.

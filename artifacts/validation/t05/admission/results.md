# Task 05 Admission Evidence

- Baseline: `pnpm --filter @agentic-chat/db test` passed 15 PostgreSQL tests before implementation.
- Red: `pnpm --filter @agentic-chat/runtime test -- admission.integration.test.ts isolation.integration.test.ts` failed because `src/application/index.js` did not exist.
- Acceptance: `pnpm test:integration -- admission projections` passed 2 files and 8 non-zero PostgreSQL scenarios.
- Repeat: `pnpm --filter @agentic-chat/runtime test:integration` passed the same 8 scenarios again.
- DB regression: `pnpm --filter @agentic-chat/db test` passed 3 files and 15 scenarios.
- Typecheck: `pnpm typecheck` passed all 8 participating workspace projects.
- Build: `pnpm build` produced the web, DB, and runtime artifacts successfully.
- Owned lint: Biome checked 17 changed TypeScript files with no findings.

## Compiled Manual Probe

The isolated PostgreSQL probe used `packages/runtime/dist/index.js` and `packages/db/dist/index.js` through Node's type-transform loader for source-authored workspace package exports.

```json
{"postgres":"PostgreSQL 17.11 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit","runCount":2,"intentCount":2,"duplicateReceipt":true,"simpleClaimed":true,"workflowRunId":"run_manual_14","workflowStartCount":1,"userEventCount":1,"adminEventCount":2,"userContainsHidden":false}
```

The probe admitted one run per runtime, replayed the Simple Loop command, claimed only the Simple Loop run, found exactly one workflow start receipt, and returned role-filtered projections.

## Catch-up Privacy Correction

- Red regression: all 3 viewer-aware catch-up tests failed with `INVALID_SCHEMA` because the existing endpoint rejected `viewer` and had no filtering seam.
- Green acceptance: `pnpm test:integration -- admission projections` passed 3 files and 11 PostgreSQL scenarios.
- Repeat: `pnpm --filter @agentic-chat/runtime test:integration` passed the same 11 scenarios.
- Full workspace `corepack pnpm run lint`, `pnpm typecheck`, and `pnpm build` passed.
- Corrected manual probe: User catch-up returned 0 events with cursor 2; Admin catch-up returned 1 hidden event; reconnect returned 0 events and retained cursor 2.

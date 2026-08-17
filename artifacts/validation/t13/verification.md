# Task 13 verification

Validated on 2026-08-17.

## Behavior

- Real Temporal execution covers F01-F05 direct, skill, calculator success/failure, notification preview, missing skill, disallowed tool, malformed input, provider failure, and exact eight-step exhaustion.
- A forced failure after the final canonical Activity commit caused Temporal to retry `advanceRun`; the retry produced one provider invocation, one AI message, and one AI `message.completed` event.
- Workflow source remains deterministic; provider, PostgreSQL, registry, policy, and tool imports are confined to Activity-side modules.
- `skill.load` persists only its snapshot and `skill.loaded`; it creates no `tool_calls` row.
- Final AI text, terminal run status, and `message.completed` are committed in one PostgreSQL transaction without delta events.

## Commands

- `corepack pnpm --filter @agentic-chat/runtime exec vitest run tests/state-workflow.integration.test.ts`: 5 passed.
- `corepack pnpm --filter @agentic-chat/runtime exec vitest run tests/simple-loop.integration.test.ts`: 9 passed.
- `corepack pnpm test:e2e --runtime=state_workflow --flows=F01-F05`: 5 passed, 10 skipped by selector.
- `corepack pnpm test:parity`: 6 passed.
- `corepack pnpm test:temporal-replay`: 10 passed.
- `corepack pnpm test:integration`: 51 passed.
- `corepack pnpm lint`: 190 files checked.
- `corepack pnpm typecheck`: 8 workspace projects passed.
- `corepack pnpm build`: web, tools, DB, and runtime builds passed.
- TypeScript no-excuse audit: 17 files, zero violations.
- LSP directory diagnostics: runtime 50 files and testkit 5 files, zero errors; changed DB files also reported zero diagnostics.

## Production pure LOC

- `state-workflow-lock.ts`: 53
- `state-workflow.ts`: 173
- `state-workflow-outcomes.ts`: 157
- `activity-adapter.ts`: 34
- `activity-runner.ts`: 211
- `activity-support.ts`: 113
- `context.ts`: 13

`activity-runner.ts` is in the 200-250 warning band and should be split before its next feature edit.

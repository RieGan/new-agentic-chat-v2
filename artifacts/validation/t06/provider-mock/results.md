# Task 06 provider mock evidence

## Red

- Command: `pnpm --filter @agentic-chat/runtime test -- provider-mock provider-errors`
- Result: exit 1. Both new suites failed to import `../src/provider/index.js`; 0 provider tests ran. The pre-existing 18 runtime tests still passed.

## Green

- Command: `pnpm --filter @agentic-chat/runtime exec vitest run tests/provider-mock.integration.test.ts tests/provider-errors.integration.test.ts`
- Result: exit 0, 2 files passed, 11 tests passed.
- Repeated twice before final validation with the same `call_001`, `call_hostile`, and `call_manual` identities and identical normalized results.
- `pnpm test:integration`: exit 0, 5 files passed, 22 tests passed.

## Compiled manual probe

- Built `@agentic-chat/runtime`, imported `dist/provider/index.js` in Node 24 with the existing workspace source loader, and executed scripted text -> tool call -> application tool result -> final text.
- Observed summary: `{"first":[{"kind":"text","text":"ready"}],"callId":"call_manual","arguments":{"expression":"20 + 22"},"final":[{"kind":"text","text":"42"}]}`.
- No tool executor, server, network request, credential, or temporary script was used.

## Quality gates

- Workspace Biome: 118 files checked, no findings.
- Workspace typecheck: 8 projects passed.
- Workspace build: all buildable projects passed.
- Contracts: 5 files and 75 tests passed.
- Runtime environment: 1 file and 7 tests passed.
- Provider public declaration contains application-owned types plus standard `fetch` only; it contains no AI SDK type.

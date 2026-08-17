# Task 08 Happy-Path Evidence

- `corepack pnpm test:integration -- approvals admin-commands`: 7 files, 29 tests passed.
- `corepack pnpm test:db`: 3 files, 15 tests passed.
- Manual real-PostgreSQL probe: `{"approval":"pending","send":"sent","sendExecutions":1,"command":"applied","userEvents":0}`.
- Approved retries produced one fixture execution and one durable `simulated_sends` row.
- Hidden guidance applied once at `before_model` and remained absent from the User projection.

# Task 05 Isolation Evidence

- Schema-level runtime mutation returned PostgreSQL check error `23514`.
- Cross-runtime claim returned `ImmutableRuntimeAssignmentError`.
- Stale fencing transition returned `StaleLeaseError` before state/event/intent mutation.
- Invalid actor, runtime, continuation boundary, cursor, and canonical event sequence returned `INVALID_SCHEMA` at application boundaries.
- Wrong continuation correlation returned typed `ConflictError`; the successful continuation retained the original run ID and replayed one receipt.
- Concurrent duplicate admission produced one run, one message, one event, one intent, and identical receipts.
- Workflow reconciliation returned one stable data-only `state_workflow` start receipt on repeated scans and did not perform delivery.
- A model-only hostile command event produced User/Admin counts `1/2`; User output contained no hidden visibility.
- Catch-up read after sequence 1 returned only sequence 2 and cursor sequence 2.
- Manual PostgreSQL container cleanup left `docker ps --format '{{.Names}}'` empty.

## Full Workspace Lint Constraint

`./node_modules/.bin/biome check .` remains red only for concurrent Task 4's out-of-scope `infra/tests/compose-topology.mjs` import order and formatting. Task 5-owned files pass the same Biome check with no findings.

## Catch-up Privacy Correction

- Event catch-up now requires `viewer: user|admin` at the application boundary.
- User filtering occurs after canonical parsing and before output parsing.
- Cursor sequence advances from the latest canonical event inspected, including filtered hidden events, preventing reconnect loops.
- Admin catch-up retains model-only canonical events as inert data.
- Reconnect regression proved no hidden event replay and no duplicate visible event after advancing through sequences 2 and 3.
- Full workspace lint is now green after Task 4's independent formatting correction.
- Manual cleanup receipt: `docker ps --format '{{.Names}}'` returned empty.

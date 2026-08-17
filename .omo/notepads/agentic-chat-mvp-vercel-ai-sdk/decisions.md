# Decisions — agentic-chat-mvp-vercel-ai-sdk

Architectural choices and rationales discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-16 - Task 02 shared contracts

- Public boundary types are inferred from strict Zod schemas; branded opaque IDs accept namespaced deterministic fixture IDs while rejecting empty identifiers.
- `skill.load` has dedicated control/result schemas and only emits `skill.loaded`; the AI tool-call union contains the four AI-selectable MVP tools and excludes both `skill.load` and runtime-internal `job.get_status`.
- F09 continuation is a `continue_run` chat input that requires the same `run_id`, correlation ID, and literal `waiting_for_user` safe boundary; it cannot carry a new runtime assignment.
- User projections are fail-closed at schema parse and projection time. Admin and model-only events remain available to the Admin projection but cannot be represented as User-visible variants.
- Normalized parity traces discard `runtime.diagnostic`, timestamps, runtime labels, and transport identities, then assign deterministic positions while preserving canonical shared-event order and exact payloads.

## 2026-08-16 - Task 03 PostgreSQL persistence

- The MVP schema contains the 16 listed logical tables plus only four control records: `run_skill_snapshots`, `admin_commands`, `dispatch_intents`, and `simulated_sends`. No generalized outbox, tenant, auth, or production audit tables were introduced.
- Runtime is immutable through repository predicates, canonical run mutation/event/dispatch writes share one data-only Drizzle transaction, and Simple Loop writers carry both aggregate version and monotonically increasing lease fencing version.
- Approval requests persist exact JSON arguments and hash, actions are unique by approval and call, and simulated sends require an approved request before their `call_id`-primary-key row can be inserted.
- Hidden Admin instruction text is stored only in `admin_commands` with a PostgreSQL check fixing actor `mvp_admin` and visibility `model_only`; User messages cannot represent Admin actors.

## 2026-08-16 - Task 05 durable application services

- Chat admission reserves the completed receipt inside the same transaction as conversation, run, User message, canonical event, and runtime-specific dispatch intent; a concurrent duplicate returns the committed original receipt.
- State Workflow uses the immutable identity `agent-run/<run_id>` and data-only pending start scans, while Simple Loop uses `SKIP LOCKED` claims and fenced state/event/intent transactions.
- Runtime immutability is enforced by a PostgreSQL update trigger in addition to repository and application checks, preventing direct SQL reassignment.
- Projection reads order exclusively by per-run sequence, parse every canonical event, and filter visibility before parsing the User projection output.

## 2026-08-16 - Task 05 catch-up privacy correction

- Event catch-up takes an explicit viewer and always filters canonical events through `projectEvents`; there is no context-free raw canonical event endpoint.
- Catch-up cursors represent the latest canonical sequence inspected rather than the latest event visible to the viewer, so hidden events advance User reconnect state without entering User output.

## 2026-08-16 - Task 04 health-gated Compose

- Every app and worker has direct `service_healthy` dependencies on PostgreSQL, Redis, Temporal, and the single migration runner; the migration runner exposes completion through an internal sentinel health check.
- `worker-simple`, `worker-workflow`, and `fixture-worker` share one pinned local worker image and equal resources. Their explicit command and matching environment role must agree or the entrypoint exits with code 64.
- API and worker application behavior remains explicitly identified as an infrastructure scaffold. The real Vite process runs for web; later runtime work can replace only the commands without changing topology or readiness contracts.
- Compose uses the workspace-derived project name rather than a fixed global name, avoiding cross-project container and volume collisions while retaining a named PostgreSQL volume.

## 2026-08-16 - Task 06 AI SDK provider boundary

- The public provider contract exposes normalized system/User/assistant/tool messages, application tool calls/results, typed result errors, and standard abort/fetch seams only; no AI SDK type crosses the runtime package boundary.
- The adapter performs exactly one non-streaming `generateText` call. Runtime loops and tool execution remain owned by later tasks, and continuation identity is checked before provider invocation.
- Live mode always constructs `createOpenAI({ baseURL, apiKey }).responses(modelId)` and every generation sets `store:false`, `parallelToolCalls:false`, `reasoningSummary:null`, zero retries, and total/step time limits.
- Expected provider failures are returned as fixed redacted result variants rather than thrown across the application boundary.

## 2026-08-16 - Task 07 synchronous fixture tools

- `skill.load` is a registry control method returning a `SkillLoadResult`; it is not representable by the AI tool-call request union and does not increment the invocation ledger.
- Registry definitions duplicate the DB seed contract as schema-validated literals but do not import `@agentic-chat/db`, preserving a one-way dependency from later runtime/application code into tools.
- `notification.send_email` has two distinct surfaces: ordinary AI execution always denies it, while the executor seam requires a consumable authorization capability bound to call ID and canonical argument hash.
- `job.get_status` accepts only a lookup dependency, validates the returned canonical status, and never creates or starts a job.

## 2026-08-16 - Task 07 package-boundary correction

- `@agentic-chat/tools` uses explicit root exports rather than notification wildcard exports; approval issuance is confined to `@agentic-chat/tools/approval-internal`.
- `ApprovalAuthorization` remains type-exported from the root so executors and Task 8 consumers retain strict signatures without exposing a runtime constructor or issuer there.
- Registry schemas, result types, canonical skill resolution, and allowlist helpers moved to `registry-support.ts`, leaving `registry.ts` focused on orchestration with integration headroom.
- The tools suite uses plain `vitest run`; an absent or undiscovered suite is now a hard failure.

## 2026-08-16 - Task 08 exact approvals and hidden Admin commands

- The runtime approval service owns the `approval-internal` issuer and mints a single-use capability only after PostgreSQL validates and reserves an approved exact binding; repositories and ordinary package consumers cannot mint one.
- Approval identity fields, including expiry and tool version, are immutable by PostgreSQL trigger. Decision status/version and the tool-call transition remain the only mutable approval lifecycle data.
- `before_model` is the sole declared hidden-command safe boundary. Applying a command requires an active target run, locks the command row, and atomically marks exactly one application with a content-free model-only event.

## 2026-08-17 - Task 09 durable report jobs

- PostgreSQL owns report admission, progress, completion, tool result, canonical events, and pending dispatch intent. BullMQ stores only deterministic execution coordination and retains completed jobs so custom-ID deduplication remains effective.
- Report admission commits the call, `job_001`, accepted event, and dispatch intent before queue I/O. A failed enqueue remains discoverable through the targeted pending-dispatch scan and reuses the same application/BullMQ identity.
- Runtime root exports expose production-only report constructors. Pause, hold, crash, and duplicate-delivery controls require `NODE_ENV=test` and are reachable only through the explicit runtime testing subpath and testkit package.
- `job.get_status` reconciliation loads the run/namespace-scoped PostgreSQL snapshot, then passes it to the existing lookup-only tool seam; status inspection cannot enqueue or start work.

## 2026-08-17 - Task 10 bounded Simple Loop

- Each claimed run constructs one non-streaming AI SDK 7 `ToolLoopAgent` with `stopWhen: isStepCount(8)`; the agent starts with only `skill.load` active and switches to the exact canonical synchronous allowlist after a successful load.
- `skill.load` is represented only by the persisted skill snapshot and `skill.loaded`; all ordinary tool terminal rows/events use dedicated fenced transactions, while final AI message, `message.completed`, run terminal state, and lease release share one transaction.
- Provider/tool policy failures produce fixed User-safe terminal explanations while retaining typed canonical errors in the runtime result and tool ledger; no raw provider diagnostics or reasoning enter User events.

## 2026-08-17 - Task 11 durable Simple Loop waits and recovery

- Simple Loop continuation stores normalized messages, selected skill, consumed steps, and only stable wait/control identities. Report results, approval decisions, simulated sends, and hidden Admin text are always reloaded from their canonical PostgreSQL records.
- Report and approval wait entry atomically persists the call/control record, continuation, status event, lease release, and dispatch intent. Resolution requires a new fence and atomically removes the wait after installing exactly one tool result.
- Hidden Admin guidance is referenced durably by command ID, consumed once at `before_model`, passed as provider instructions for that generation, and never copied into durable continuation or User-visible records.

## 2026-08-17 - Task 12 deterministic Temporal foundation

- State Workflow identity is `agent-run/<run_id>` with `WorkflowIdConflictPolicy.FAIL` for running executions and `WorkflowIdReusePolicy.REJECT_DUPLICATE` for closed executions.
- Workflow code owns only the shared seven-state transition table, exact signal correlation, inspect state, and Activity scheduling; all external work enters through `reconcileStart`, `advanceRun`, or `applySignal` Activity adapters.
- Activity delivery uses a two-minute schedule-to-close timeout, 30-second start-to-close timeout, three attempts with bounded exponential backoff, and stable idempotency keys derived from immutable workflow and operation identities.

## 2026-08-17 - Task 13 State Workflow synchronous Activities

- F01-F05 execute inside the idempotent `advanceRun` Activity, which owns the bounded non-streaming agent session while the deterministic workflow receives only `complete` or `fail` directives.
- State Workflow uses dedicated no-lease PostgreSQL transactions guarded by immutable workflow identity and aggregate version; tool, event, continuation, and final-message effects remain canonical and atomic.
- Activity event/message identities are SHA-256-derived from the stable workflow operation key, while provider-supplied call IDs remain canonical tool identities.

## 2026-08-17 - Task 14 State Workflow durable waits and recovery

- State Workflow wait transitions use dedicated no-lease PostgreSQL transactions; continuation JSON stores only stable wait identities, normalized provider messages, selected skill, consumed steps, and the temporary hidden-guidance reference.
- Durable dispatch intents reconcile report completion, approval decisions, and same-run User continuation into exact Temporal signals. Workflow handlers enforce correlation, and Activities independently enforce canonical PostgreSQL authority before mutation.
- Approved notification execution remains exclusively behind the Task 8 approval service/capability; rejected decisions persist a canonical not-sent result and never enter the send executor.

## 2026-08-17 - Task 15 fixed-actor tRPC and tracked SSE

- The Node boundary uses tRPC 11.18.0 with two fixed transport contexts: `/trpc/user/` constructs `mvp_user` and `/trpc/admin/` constructs `mvp_admin`; procedure middleware still verifies the exact actor pair before execution.
- Live delivery uses a thin polling signal source over persisted projections instead of an in-process event payload bus or new database trigger. The listener is active before canonical catch-up, and no signal itself is exposed as a domain event.
- Tracked IDs encode the canonical run cursor. Invalid IDs return a typed canonical-snapshot-refetch signal, while visible tracked events advance over any previously inspected hidden sequence.

## 2026-08-17 - Task 16 accessible User and Admin routes

- User and Admin use separate fixed-context tRPC clients and independent React state. User SSE frames are parsed at the boundary and discarded unless their contract visibility is exactly `user`; User navigation also contains no Admin actions.
- The User canonical recovery path intentionally reads `runs.get` before `conversations.get`. This guarantees the completed-message projection is not older than the cursor used to resume SSE.
- The operations-console design uses a tokenized warm graphite event-ledger system, a single signal-cyan accent, tonal surfaces with borders, native controls, and no decorative animation.

## 2026-08-17 - Task 16 independent Visual QA corrections

- Approval discovery subscribes to every authorized nonterminal run returned by Task 15 `runs.list`, not only runs represented by the current pending list. A keyed subscription map reconciles additions/removals, ignores callbacks after removal, and reports connected only when the complete eligible set is connected.
- Admin projection reads use a monotonically increasing request generation plus the current selected run ID. Selection clears the previous details immediately, and hidden-command refreshes pass through the same guarded commit path.
- Approval list refreshes are generation-versioned; an in-flight deciding card is retained, and mutation responses are upserted. This preserves the exact card DOM node and its native focus target through concurrent SSE refresh.

## 2026-08-17 - Task 17 dual-runtime acceptance harness

- One testkit acceptance catalog defines P01-P11/F01-F10 record semantics for both runtimes, while the existing Simple Loop and Temporal suites retain their architecture-specific setup and emit records only after their real flow test passes.
- F05 is one matrix cell with two independently written mandatory records, `P05.json` and `P06.json`; the post-run validator rejects either omission.
- Runtime diagnostics remain in a dedicated `runtimeDiagnostics` field and never enter `normalizedEventTrace`; User projections are derived by visibility filtering and checked for Admin actor, rejection-reason, and hidden-command leakage on every record.

## 2026-08-17 - Task 18 final runtime gates

- `test:restart` owns clean Compose setup/teardown, targeted worker restart, identity/health capture, deterministic runtime recovery scenarios, and the existing database/runtime/API adversarial suites. PostgreSQL remains the canonical state inspected by those suites; Redis and Temporal remain coordination mechanisms.
- `test:parity` loads and validates Task 17 schema-v2 PostgreSQL captures for all eleven prompt records per runtime instead of treating a static expected catalog as runtime output.
- Release decisions use restart, parity, and Temporal replay as exact gates. Compose recovery duration, runtime-specific source size, and parity execution duration are measurements with no pass threshold.

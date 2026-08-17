# Learnings — agentic-chat-mvp-vercel-ai-sdk

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-16 - Task 01 workspace scaffold

- Vite 8.2.1 uses Rolldown by default and requires Node 22.12+ on the Node 22 line, so the workspace engine is `>=22.12.0` rather than the less precise `>=22`.
- AI SDK 7.0.66 declares Node `>=22`; the live-provider packages are pinned as `ai@7.0.66` and `@ai-sdk/openai@4.0.42` without implementing the provider adapter early.
- Empty future Vitest suites use `--passWithNoTests`, which visibly reports that no tests exist. Playwright E2E/restart suites remain fail-closed until scenarios are added.
- Plan-specific `--runtime` and `--flows` E2E arguments must be translated to `TEST_RUNTIME` and `TEST_FLOWS` before invoking Playwright because Playwright rejects those custom flags.

## 2026-08-16 - Task 01 verification correction

- Task 01's frontend boundary is intentionally limited to React, React DOM, Vite, the React Vite plugin, Tailwind CSS, and the Tailwind Vite plugin. React inspection tooling belongs with later UI implementation rather than the workspace scaffold.
- Removing `react-doctor`, `react-grab`, `react-scan`, and `vite-plugin-react-scan` pruned 223 installed packages while preserving the Vite production build and all Task 1 quality gates.

## 2026-08-16 - Task 02 shared contracts

- Canonical run events use positive database-assigned per-run sequences, while snapshot cursors permit sequence `0` to represent a pre-event snapshot boundary.
- Zod discriminated unions can freeze event visibility by variant, so malformed `admin.command.*` events with `visibility=user` fail parsing before projection code runs.
- Native Node 24 manual QA for TypeScript-authored workspace exports needs `--experimental-transform-types`; a temporary loader can remap source-authored `.js` specifiers to `.ts` without adding a runtime dependency.
- Biome formatting expanded the canonical event union enough to trigger the 250-pure-LOC review rule; moving shared payload schemas and runtime observability into focused modules kept every source file below the ceiling.

## 2026-08-16 - Task 03 PostgreSQL persistence

- The official PostgreSQL image starts a temporary Unix-socket server during initialization. A Docker health check using bare `pg_isready` can report healthy before that server shuts down; probing `-h 127.0.0.1` waits for the final TCP server and removes the migration-startup race.
- Keeping PostgreSQL enum tuples as `as const satisfies readonly ContractStatus[]` preserves compile-time contract checking while avoiding a runtime dependency from the standalone migration/seed artifact to source-authored contract exports.
- Drizzle migration reruns are ledger-idempotent, while seed inserts use conflict-safe transactions so the exact two actors, three skills, and six registry tools remain stable across repeated setup.

## 2026-08-16 - Task 05 durable application services

- An idempotency insert with `ON CONFLICT DO NOTHING` inside the domain transaction makes concurrent callers wait for the winner and then replay its receipt without a pending reservation state.
- Canonical DB JSON must be treated as untrusted on reads; rebuilding each event and snapshot through frozen contract schemas catches malformed storage before projection output.
- A compiled Node probe can consume built runtime/DB entry points while a tiny loader maps source-authored workspace `.js` specifiers to `.ts`; this avoids adding a runtime loader dependency.
- Application integration tests use UUID-isolated PostgreSQL containers but deterministic domain IDs and clocks, allowing concurrent suites without receipt drift.

## 2026-08-16 - Task 05 catch-up privacy correction

- Filtering only initial snapshots is insufficient: every replay/catch-up path must carry viewer context and apply the same visibility projection.
- A visibility-filtered cursor cannot be derived from visible output. It must advance over the canonical range inspected or reconnects will repeatedly scan the same hidden tail.

## 2026-08-16 - Task 04 health-gated Compose

- The pinned `temporalio/temporal:1.5.1` CLI supports `server start-dev --headless` but predates the newer `--ui-disable-news-fetch` flag; its own `temporal operator cluster health` command provides an honest gRPC readiness probe.
- pnpm 11 rejects placeholder `allowBuilds` entries during a container install. `--ignore-scripts` preserves the repository supply-chain policy without manifest changes, and Vite/TypeScript builds still succeed from their platform packages.
- A blocked migration health override leaves all five app/worker containers in `Created` state with empty logs, demonstrating that dependency health prevents schema races rather than merely reporting them afterward.
- Ordinary PostgreSQL restart and full Compose recreation without `--volumes` preserved both the QA marker and exactly one Drizzle migration ledger row.

## 2026-08-16 - Task 04 lint correction

- Running the repository-wide `pnpm lint` gate exposed only Biome import ordering and formatter layout in `infra/tests/compose-topology.mjs`. Applying Biome to that exact file preserved topology behavior; full lint, the topology test, and LSP diagnostics then passed.

## 2026-08-16 - Task 06 AI SDK provider boundary

- AI SDK 7 `MockLanguageModelV4` accepts deterministic V4 `doGenerate` results directly; V4 tool-call inputs are JSON strings, while `generateText` returns parsed tool-call input values.
- Application continuation can remain SDK-independent by normalizing assistant tool calls and tool results, then rebuilding private `ModelMessage` values only inside the adapter.
- An intercepted standard `fetch` verifies the live OpenAI Responses route and wire options without credentials or mandatory network access.
- The existing workspace source loader is required for literal compiled Node probes because workspace package exports point to TypeScript sources whose internal specifiers use `.js`.

## 2026-08-16 - Task 07 synchronous fixture tools

- A canonical skill snapshot must be resolved again at exposure and execution boundaries; trusting a caller-supplied, schema-valid snapshot would allow its `allowedTools` array to be widened after load.
- Separating denied requests from executor invocations lets later F05/F07/F08 assertions prove both that policy was exercised and that prohibited side effects executed zero times.
- A bounded recursive-descent arithmetic parser is sufficient for the fixture grammar and rejects identifiers, exponent syntax, dynamic access, non-finite results, excess tokens, and excess nesting without dynamic code execution.
- Canonicalized notification content hashed with SHA-256 provides stable retry identity while keeping prompt-injection-shaped content inert.

## 2026-08-16 - Task 07 package-boundary correction

- A nominal capability is insufficient if its issuer is re-exported from the same ordinary package entry point; runtime namespace tests must verify that minting values are absent, not merely that direct execution rejects missing authorization.
- A deliberately named internal package subpath preserves Task 8's issuance seam while the root entry point exports only the opaque authorization type and non-side-effect preview/hash operations.
- Testing the exact package manifest export map and test command catches both accidental wildcard exposure and regressions back to `--passWithNoTests`.

## 2026-08-16 - Task 08 exact approvals and hidden Admin commands

- Persisting the tool version beside the approval arguments/hash closes the remaining exact-action binding gap; canonical arguments are rebuilt and hashed at preparation, decision, and send reservation boundaries.
- Reserving the call-keyed simulated-send row before invoking the approved fixture gives concurrent retries one executor winner without holding a database transaction across execution.
- Hidden Admin lifecycle events carry only command identity and status. The raw instruction remains in `admin_commands` and the internal model-boundary result, so the existing User projection remains fail-closed without content redaction heuristics.

## 2026-08-17 - Task 09 durable report jobs

- BullMQ 6 treats Redis clients as optional peers. Passing connection options without explicitly installing the selected `ioredis` backend causes repeated asynchronous initialization errors rather than one fail-fast constructor error; declaring `ioredis` directly prevents that loop.
- A stable public fixture ID such as `job_001` needs a separate deterministic ledger key and BullMQ ID so independent namespace/run scopes can reuse the fixture contract without colliding in PostgreSQL or Redis.
- Holding completion behind a test barrier after durable progress provides a sleep-free assertion point for the exact queued -> 50% -> completed sequence and makes retry/crash tests deterministic.

## 2026-08-17 - Task 10 bounded Simple Loop

- A private AI SDK V4 language-model bridge lets `ToolLoopAgent` own the real multi-step loop while every provider request and response still crosses the application-owned normalized provider contract.
- Persisting the normalized pre-step context and incremented `consumed_steps` before each provider generation accounts for malformed responses and provider failures without exposing AI SDK message types in durable state.
- AI SDK tool input schemas provide the first validation boundary; the canonical tool registry then reparses the call before policy and reparses tool-specific arguments at execution, preserving zero fixture execution for malformed and disallowed calls.

## 2026-08-17 - Task 11 durable Simple Loop waits and recovery

- AI SDK 7 `ToolLoopAgent` stops cleanly when an exposed tool has no executor. Persisting that assistant call as normalized provider context lets the resumed agent receive one canonical PostgreSQL tool result without replaying the original call.
- Durable resume uses the total consumed-step count to configure only the remaining `isStepCount` budget; PostgreSQL pre-step accounting remains authoritative across worker reconstruction.
- Job completion and approval decisions create deterministic resume intents while leaving the run in its waiting status until a fresh fenced owner atomically installs the canonical result and returns it to `running`.

## 2026-08-17 - Task 12 deterministic Temporal foundation

- A small directive protocol keeps workflow orchestration deterministic while allowing later model, database, tool, queue, and reconciliation implementations to remain ordinary idempotent Activities.
- Temporal history position is an architecture-specific transition counter exposed only by the inspect query; normalized parity events remain unchanged.
- A server-fetched history can be replayed with no registered Activities because Temporal records completed Activity results and `Worker.runReplayHistory` consumes those results without external I/O.

## 2026-08-17 - Task 13 State Workflow synchronous Activities

- Persisting normalized provider context before each generation and complete assistant/tool exchanges with each Activity-side effect lets an Activity retry resume from PostgreSQL without replaying an already-recorded tool effect.
- A retry after the atomic final commit can short-circuit from terminal run state, so the same Temporal Activity identity performs no second provider call, message insert, or completion event.
- Strict skill registry input must exclude Activity-only call identity; carrying `callId` beside registry arguments preserves both retry identity and the canonical registry boundary.

## 2026-08-17 - Task 14 State Workflow durable waits and recovery

- A correlated Temporal signal must remain a wakeup until its Activity reloads the exact PostgreSQL wait and canonical outcome; returning `ignored` keeps inspect state at the legal wait for exact-ID but non-canonical signals.
- Report completion needs a State Workflow signal intent at canonical completion rather than progress, while signal dispatch marks the durable intent only after Temporal accepts the signal so retries remain harmless.
- Stopping the real Temporal worker at report and approval boundaries preserves pending workflow history in the server; a replacement worker can resume the same workflow/run/call/job/approval identities and remaining model-step budget.

## 2026-08-17 - Task 15 fixed-actor tRPC and tracked SSE

- tRPC 11 tracked subscriptions expose tuple envelopes to server-side callers and `{ id, data }` to `httpSubscriptionLink` clients; both were exercised so reconnect IDs and serialized event data remain independently testable.
- A callback signal source can remain payload-free: each wakeup rereads the persisted viewer projection, so filtering, canonical cursor advancement, and privacy stay centralized in the completed application service.
- Returning the subscription iterator and disconnecting real EventSource both invoke generator cleanup, allowing deterministic listener-leak tests without sleeps.

## 2026-08-17 - Task 16 accessible User and Admin routes

- Parallel canonical reads can create a projection/cursor race: a conversation read may precede `message.completed` while a run read already includes its later cursor. Ordering the run read before the conversation read closes that atomicity gap.
- Focus restoration after an async form cannot occur while React still renders the control as disabled. A post-commit effect keyed to the busy transition preserves the native focus target reliably.
- Running fixed-actor UI projects concurrently against one deterministic fixture creates intentional state cross-talk. A single Playwright worker matches the MVP fixed-context boundary and keeps evidence repeatable.

## 2026-08-17 - Task 16 independent Visual QA corrections

- Per-run SSE discovery must exclude terminal history. Subscribing every persisted run can exhaust the browser HTTP/1.1 connection pool and starve mutations; the correct Task 15-compatible inventory is authorized nonterminal runs.
- A stale Admin projection may be visible for only one render before another SSE recovery masks it. A MutationObserver-backed response barrier is required to prove that no stale run ever commits, rather than merely asserting the eventual state.
- Full-page screenshots with a sticky header must reset document scroll before capture. A separate viewport capture at the scrolled position proves stickiness without producing a malformed full-page composition.

## 2026-08-17 - Task 17 dual-runtime acceptance harness

- Cleaning only the selected runtime artifact directory before execution prevents stale PASS files from satisfying a later partial or failed run while preserving the other runtime's independently produced evidence.
- The runtime selector must also constrain Playwright to the runtime project and F01-F10 title contract; otherwise `ui-races.spec.ts` is collected by the broad runtime project without its UI base URL.
- A strict normalized trace comparison must retain payloads as well as event types. Mutating `CHAT_OK` to `ALTERED` produces an actionable expected/actual diff and proves the harness cannot report success from event-name-only checks.

## 2026-08-17 - Task 17 acceptance evidence integrity correction

- PASS evidence must be created only from a schema-validated PostgreSQL observation containing the real run, projections, canonical events, calls, approvals, jobs, commands, and runtime diagnostics; Playwright status and expected scenario catalogs are not observations.
- Durable Playwright wrappers must pass runtime, flow, prompt, file, and title metadata into the child-owned integration process so evidence is written before that process tears down its PostgreSQL container.
- Vitest object-table titles retained the literal `$decision` in this suite, so narrow `-t "after approve"` selectors ran zero tests with exit code 0. Running the shared approval test and selecting evidence by prompt metadata prevents false-positive F07/F08 cells.
- Manually seeded waiting fixtures must first consume a real runtime step. Otherwise they can create an illegal `queued -> waiting_for_user` event that production execution never emits.

## 2026-08-17 - Task 18 isolated restart and adversarial parity gates

- A restart gate without an explicit runtime selector silently exercised Simple Loop and skipped State Workflow; the fail-closed runner now executes three deterministic report/pending-approval recovery scenarios for each runtime and rejects skipped output.
- `docker compose restart <worker>` preserves the target container ID while changing only its start timestamp. Capturing both fields proves a real isolated restart while stable IDs/timestamps prove every non-target service stayed untouched.
- Cross-runtime comparison of Task 17 records must preserve canonical payload semantics while normalizing architecture-specific identities and final-response prose. PostgreSQL provenance digests remain attached to every compared schema-v2 record.
- A direct wait-entry helper is a persistence boundary even when ordinary callers already enter from `running`; validating `assertRunTransition` and parsing the canonical status event before mutation prevents internal callers from committing illegal history.

## 2026-08-17 - F4 scope fidelity and parity review

- A parity comparator must use an explicit allowlist for generated identities. A suffix rule such as `endsWith("Id")` silently classifies semantic identifiers like `skillId` as noise and can convert a real runtime disagreement into PASS.
- Current-record equality does not make an incomplete gate trustworthy. Tool arguments/results/errors, selected skills, approval actors/decisions, and job results must participate in parity even when the present fixtures happen to match under an independent stricter audit.
- Context-specific identity normalization is stronger than a global key allowlist: event type and payload path identify generated values, while a derived approval hash is normalized only after recomputing it from the exact captured arguments.
- A compact mutation matrix can prove fail-closed evidence behavior without changing observed records: the pre-fix run exposed seven false accepts, and the corrected gate rejects all 18 semantic mutations with structural diffs.

## 2026-08-17 - Repository initialization

- The completed workspace was initialized as a local Git repository with atomic Conventional Commit history. The 9.8 MB `artifacts/validation/` audit trail is intentionally versioned; dependency trees, local `.env` files, build output, and transient `test-results/` remain ignored.

# Agentic Chat MVP with Vercel AI SDK - Work Plan

## TL;DR (For humans)

- **What you will get:** a greenfield pnpm monorepo implementing the complete Agentic Chat architecture-validation MVP, with one shared contract exercised by an AI SDK `ToolLoopAgent` Simple Loop and a durable Temporal State Workflow.
- **Why this approach:** contracts, persistence, deterministic fixtures, and recovery boundaries are built first so both runtimes can be compared fairly through the same API, UI, and F01-F10 suite.
- **What it will not do:** no login/OIDC, tenancy, real email, production deployment, files, retrieval, memory, AI SDK UI streaming, or other post-MVP features.
- **Effort/risk:** architecture-scale. Highest risks are duplicate execution, exact approval binding, Temporal determinism, wrong-runtime claims, SSE replay gaps, and false parity from provider nondeterminism.
- **Decisions:** AI SDK 7 on Node 22+; explicit OpenAI Responses API provider; local deterministic tools; contract-first TDD; PostgreSQL product-state authority; non-gating live-provider smoke test.

## Scope

### In scope

- Root pnpm workspace, strict TypeScript/ESM, Biome, Vitest, Playwright, Vite 8/Rolldown, Tailwind, environment validation, and Docker Compose.
- `apps/web`, `apps/api`, and one `apps/worker` image with `simple`, `workflow`, and `fixture` entry points.
- Focused shared packages: `contracts`, `db`, `runtime`, `tools`, and `testkit`; do not scaffold every production-blueprint package.
- Shared Zod/tRPC contracts, fixed actors, Drizzle/PostgreSQL persistence, tracked tRPC SSE projections, versioned skills/tools, approvals, hidden Admin commands, BullMQ jobs, and idempotency.
- `simple_loop` implemented with a bounded AI SDK 7 `ToolLoopAgent`.
- `state_workflow` implemented with Temporal; workflows orchestrate deterministically and Activities perform model, database, queue, and tool I/O.
- F01-F10 plus contract gaps identified during research: malformed inputs, wrong-runtime claims, immutable runtime assignment, approval tampering/races, negative Admin commands, duplicate async completion, pending-approval restart, SSE reconnect, projection privacy, and Temporal replay.

### Must not have

- Next.js, React Server Components, AI SDK UI streams, `message.delta`, or token-by-token rendering.
- Authentication/session/OIDC flows, tenant/account management, generalized RBAC, files, retrieval, citations, memory, sharing, exports, multi-agent work, or production operations.
- SMTP/email-provider SDKs, real email, browser/file/code-execution tools, or any external fixture side effect.
- Live-model outputs as deterministic release gates.
- Database/network/LLM/tool calls inside Temporal workflow code.
- A generic event platform or production-grade outbox framework beyond targeted durable intents and reconciliation required by F06-F10.

## Verification strategy

- **Strategy:** contract-first TDD. Each todo adds failing tests for its contract before implementation and retains agent-executable happy and failure evidence.
- **Deterministic gate:** all F01-F10 assertions use AI SDK `MockLanguageModelV4` scripted responses and local tool fixtures. Live OpenAI Responses smoke is optional and skipped with an explicit reason when credentials are absent.
- **Commands:** expose `pnpm lint`, `pnpm typecheck`, `pnpm test:contracts`, `pnpm test:db`, `pnpm test:integration`, `pnpm test:temporal-replay`, `pnpm test:e2e --runtime=<runtime>`, `pnpm test:parity`, and `pnpm test:restart`.
- **Environment:** `docker compose config --quiet` and `docker compose up --build --wait` must pass before integration/E2E. Tests reset or namespace fixture state and never rely on a developer's existing database.
- **Evidence:** every command writes JUnit/JSON/log/screenshot/trace artifacts under `artifacts/validation/<task-or-runtime>/<scenario>/`; artifacts are ignored from source control except documented schemas/example records.
- **UI QA:** Playwright performs all User/Admin interactions and verifies DOM, reconnect, and confidentiality without manual clicking or visual judgment.
- **Non-gating measurements:** latency, recovery time, inspectability, and runtime-specific source/fixture complexity are recorded for comparison because the blueprint defines no pass thresholds.

## Execution strategy

### Waves and dependencies

| Wave | Todos | Depends on | Parallelism |
| --- | --- | --- | --- |
| 1 Contract foundation | 1-3 | none | 1 then 2/3 after workspace |
| 2 Durable shared substrate | 4-9 | 1-3 | 4 can overlap 5; 6-9 follow contracts/db |
| 3 Runtime adapters | 10-14 | 5-9 | Simple Loop (10-11) and Temporal (12-14) may proceed in parallel |
| 4 Product boundary | 15-16 | shared substrate and stable runtime contracts | API then UI; UI shell may start after contracts |
| 5 Validation | 17-18 | all implementation todos | deterministic E2E then restart/parity evidence |

### Frozen contract decisions

- A conversation may contain multiple runs. F09 uses a testkit-seeded active run at a safe model boundary; `chat.sendMessage` with that `run_id` resumes the same run after an Admin command. No public start-run procedure is added.
- `skill.load` is a registry/control operation: it updates the run's selected-skill snapshot and emits `skill.loaded`; it never creates an AI-selected `tool_calls` row. Thus F02 has one skill load and zero tool calls.
- Shared run statuses: `queued`, `running`, `waiting_for_tool`, `waiting_for_admin`, `waiting_for_user`, `completed`, `failed`. Runtime-specific Temporal states remain diagnostics and are excluded from normalized parity traces.
- Shared operation statuses are discriminated unions with legal transitions: tool call `prepared|running|approval_required|waiting_job|completed|failed|rejected`; approval `pending|approved|rejected|expired`; job `queued|running|completed|failed`; Admin command `accepted|applied|rejected|expired`.
- IDs are opaque UUIDv7/ULID-style application IDs; event replay uses `(run_id, sequence)` with a database-assigned monotonic per-run sequence. Fixture-visible values such as `job_001` are scoped to a namespaced test run, not globally unique.
- The normalized parity trace contains shared externally meaningful events only: run status, skill loaded, tool lifecycle, approval lifecycle, job lifecycle, Admin command lifecycle, and `message.completed`. Runtime diagnostic events are separately inspectable.
- `ToolLoopAgent` uses `stopWhen: isStepCount(8)`. Persist consumed steps across pause/resume; exhaustion yields `LOOP_STEP_LIMIT_EXCEEDED`; malformed/unauthorized requests consume the model step but never invoke a tool.
- Mutations return after durable admission. Lifecycle changes arrive through tracked SSE; no mutation-response or AI text streaming.
- Transaction boundaries write canonical state, event, and durable dispatch intent together. Delivery to Temporal/BullMQ/SSE occurs after commit and is idempotently reconciled after crashes.
- Runtime workers filter by immutable `runs.runtime`; Simple Loop claims with a lease/fencing version. State Workflow uses deterministic workflow ID `agent-run/<run_id>` plus reconciliation for admitted-but-not-started runs.
- Approval stores the immutable prepared argument snapshot and canonical hash, run/call/tool-version binding, expiry, and one terminal decision. Simulated sends are unique by `call_id`.
- Environment names: `AI_PROVIDER_MODE=mock|openai_responses`, `OPENAI_MODEL_ID`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY`. Mock mode needs no secret; live mode validates all three OpenAI values and redacts them from logs.

## Todos

- [x] 1. Scaffold the strict workspace and quality/test commands
  - **Implement:** create root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.env.example`, package/app manifests, and minimal Vitest/Playwright configuration. Pin Node `>=22`, ESM, AI SDK 7-compatible dependencies, and root scripts named in Verification strategy. Add `packages/contracts`, `packages/db`, `packages/runtime`, `packages/tools`, `packages/testkit`, `apps/api`, `apps/web`, and `apps/worker` only.
  - **References:** `docs/agentic-chat-mvp-development-blueprint.md` §§3, 5, 11; `.omo/drafts/agentic-chat-mvp-vercel-ai-sdk.md` Decisions ledger; official AI SDK 7 Node requirements.
  - **Acceptance:** clean install, lint, and typecheck commands exist; no Next.js or production-only package appears; `.env.example` contains placeholders without secrets.
  - **QA happy:** run `corepack pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck`; expect exit 0 and save logs to `artifacts/validation/t01/workspace/`.
  - **QA failure:** run the environment parser test with `AI_PROVIDER_MODE=openai_responses` and missing credentials; expect typed startup-config failure with no secret values in `artifacts/validation/t01/env-invalid/`.
  - **Commit:** `chore(workspace): scaffold agentic chat monorepo`

- [x] 2. Freeze shared Zod contracts, states, errors, and normalized events
  - **Implement:** in `packages/contracts/src/`, define branded IDs, fixed actor/runtime enums, command/procedure inputs and outputs, statuses/legal transitions, tool/skill/approval/job/Admin-command envelopes, visibility, canonical event union, snapshot cursor, normalized parity trace, and typed errors. Encode `skill.load` as a control record/event rather than a `tool_call`; encode F09 active-run resume semantics; define the eight-step loop budget.
  - **References:** MVP blueprint §§2, 4, 6-9; validation plan §§2-6; Metis contradictions for F02/F09/event parity.
  - **Acceptance:** exhaustive discriminated unions reject illegal transitions, runtime changes, missing IDs, malformed arguments, and visibility mismatches; public contracts contain no AI SDK/Temporal/BullMQ types.
  - **QA happy:** `pnpm test:contracts`; expect all P01-P11 fixture payloads parse and normalized traces serialize, evidence `artifacts/validation/t02/contracts-valid/`.
  - **QA failure:** feed runtime mutation, invalid tool args, illegal approval transition, and User-visible hidden command; expect named typed errors and evidence `artifacts/validation/t02/contracts-invalid/`.
  - **Commit:** `feat(contracts): define shared agent runtime protocol`

- [x] 3. Implement Drizzle schema, reviewed migration, seeds, and repository tests
  - **Implement:** create `packages/db/src/schema/` and `packages/db/migrations/` for the blueprint's logical tables, adding only required join/control records (run skill snapshot, Admin commands, dispatch intents). Add unique constraints for `(run_id, sequence)`, call/job/approval identities, idempotency keys, one Admin decision, simulated send by `call_id`, and workflow identity; add optimistic `version`/lease fencing fields. Seed exactly `mvp_user`, `mvp_admin`, three skills, and six tool definitions/versions.
  - **References:** MVP blueprint §§7, 9; validation plan §§2-3; full blueprint §8 transaction/migration guidance.
  - **Acceptance:** migration is generated and reviewed SQL, applies once and idempotently reports no pending migration on rerun; repositories transact state+event+dispatch intent and never hold transactions during external work.
  - **QA happy:** `pnpm test:db`; apply migration to empty PostgreSQL, verify seeds/constraints/transactions, evidence `artifacts/validation/t03/db/`.
  - **QA failure:** race duplicate event, approval decision, idempotency key, and simulated send inserts; expect one winner and typed conflicts in `artifacts/validation/t03/db-races/`.
  - **Commit:** `feat(db): add durable mvp persistence model`

- [x] 4. Build the health-gated Docker Compose environment
  - **Implement:** add `compose.yaml` and minimal Dockerfiles/config for PostgreSQL, Redis, Temporal, migration runner, web, API, shared worker image as `worker-simple`/`worker-workflow`, and `fixture-worker`. Add named PostgreSQL volume, health/readiness gates, equal worker dependencies/resources, runtime-specific commands, and no production credentials.
  - **References:** MVP blueprint §10 and service boundary §5; validation plan F10.
  - **Acceptance:** `docker compose up --build --wait` starts the full topology; workers use the same image; restarting one worker leaves all other services healthy and data intact.
  - **QA happy:** run `docker compose config --quiet && docker compose up --build --wait`; capture service health and image IDs at `artifacts/validation/t04/compose-up/`.
  - **QA failure:** start app services while migration readiness is intentionally blocked; expect health-gated non-readiness rather than schema errors, evidence `artifacts/validation/t04/migration-gate/`.
  - **Commit:** `build(compose): add isolated mvp service topology`

- [x] 5. Implement durable admission, event ledger, claims, projections, and reconciliation
  - **Implement:** in `packages/runtime/src/application/` and DB repositories, implement command idempotency, conversation/run admission, immutable runtime assignment, Simple Loop lease/fencing claims filtered to `simple_loop`, State Workflow start intents using `agent-run/<run_id>`, canonical state+event transactions, User/Admin projection filters, monotonic cursors, and scans for undispatched/recoverable work.
  - **References:** MVP blueprint §§4-6, 8-10; validation plan §§3, 6 and F10; `docs/simple-loop-architecture.md`; `docs/state-workflow-architecture.md`.
  - **Acceptance:** duplicate commands return original receipts; wrong worker/runtime mutation/stale lease writes fail; state and event never diverge; User projections cannot include Admin-only payloads.
  - **QA happy:** `pnpm test:integration -- admission projections`; create one run per runtime and verify matching dispatch/claim/projection records, evidence `artifacts/validation/t05/admission/`.
  - **QA failure:** attempt cross-runtime claim, stale fencing mutation, duplicate command, and hidden-event User projection; expect zero forbidden mutations/leaks in `artifacts/validation/t05/isolation/`.
  - **Commit:** `feat(runtime): add durable admission and event projections`

- [x] 6. Add the AI SDK OpenAI Responses adapter and deterministic model harness
  - **Implement:** in `packages/runtime/src/provider/`, define an application-owned provider interface; adapt AI SDK 7 `MockLanguageModelV4` scripted steps for gating tests and `createOpenAI({baseURL,apiKey}).responses(modelId)` for optional live mode. Use non-streaming generation, `store:false`, `parallelToolCalls:false`, explicit abort/time limits, and map AI SDK results/errors into shared contracts without exporting SDK types.
  - **References:** user decisions; official AI SDK 7 OpenAI provider, Agents, Tool Calling, and Testing docs; MVP blueprint §§4, 6.
  - **Acceptance:** mock mode runs with no API key; live mode validates Responses-capable config; no `streamText`, UI stream, raw reasoning, provider secret, or SDK type crosses the application boundary.
  - **QA happy:** `pnpm test:integration -- provider-mock`; script text, tool call, tool result continuation, and typed provider failure; evidence `artifacts/validation/t06/provider-mock/`.
  - **QA failure:** start live mode with missing/invalid URL/model/key and force provider timeout; expect redacted typed failures in `artifacts/validation/t06/provider-errors/`.
  - **Commit:** `feat(provider): integrate ai sdk responses models`

- [x] 7. Implement versioned skills and synchronous fixture tools
  - **Implement:** in `packages/tools/src/`, add registry validation, `skill.load` control operation, skill snapshots/allowlists, calculator parser with `DIVISION_BY_ZERO`, notification preview normalization, simulated send executor, and runtime-internal `job.get_status`. Validate model arguments before authorization and again at execution. Never evaluate calculator input with `eval`/dynamic code.
  - **References:** MVP blueprint §7; validation plan §§2.1-2.2 and F02-F05/F07-F08.
  - **Acceptance:** exact skill versions/allowlists load; missing skill gives `SKILL_NOT_FOUND`; disallowed and malformed calls never invoke fixtures; simulated send is impossible without a consumed approval token.
  - **QA happy:** `pnpm test:integration -- sync-tools`; verify P02-P04 and preview normalization, evidence `artifacts/validation/t07/sync-tools/`.
  - **QA failure:** verify P05/P06, malformed schemas, injection-like calculator strings, and direct send invocation; expect zero prohibited invocations in `artifacts/validation/t07/tool-denials/`.
  - **Commit:** `feat(tools): add versioned deterministic fixtures`

- [x] 8. Implement exact approval and hidden Admin-command services
  - **Implement:** add services/repositories for immutable approval snapshots and hashes, expiry, transactionally single approve/reject decisions, simulated send uniqueness, and Admin commands with target/expiry/idempotency/single-use safe-boundary application. Add testkit clock and barriers; no public test-only bypass.
  - **References:** MVP blueprint §§2, 7-9; validation plan §§2.4-2.5 and F07-F09; Metis approval/Admin lifecycle findings.
  - **Acceptance:** only fixed Admin context decides/sends commands; altered/wrong-run/expired/already-decided approvals fail; approve/reject races produce one decision; raw command content is Admin/audit-only.
  - **QA happy:** `pnpm test:integration -- approvals admin-commands`; prove one approved simulated send, one rejection with zero sends, and one safe-boundary command application, evidence `artifacts/validation/t08/happy/`.
  - **QA failure:** race approve/reject and test tampered, expired, duplicate, wrong-run, completed-run, and User-context operations; evidence `artifacts/validation/t08/adversarial/`.
  - **Commit:** `feat(hitl): add exact approvals and hidden commands`

- [x] 9. Implement BullMQ report fixture, durable job ledger, and test barriers
  - **Implement:** add report queue/fixture worker that persists accepted `job_001`, 50% progress, and completed `report_001` scoped by test/run; use deterministic BullMQ job IDs and application idempotency. Add reconciliation through `job.get_status`, duplicate-event inbox keys, and test-only pause-after-accept/hold-completion/release/duplicate-delivery controls available only under test configuration.
  - **References:** MVP blueprint §§2, 7, 9-10; validation plan §2.3, F06, F10; official BullMQ retry/idempotency guidance.
  - **Acceptance:** mutation/admission never waits for completion; PostgreSQL reflects canonical progress/result; retries or duplicate completion yield one logical job/call/result.
  - **QA happy:** `pnpm test:integration -- async-job`; assert queued→50%→completed and reconciliation after a dropped live event, evidence `artifacts/validation/t09/async-job/`.
  - **QA failure:** redeliver job/completion and crash fixture worker around persistence; expect one logical execution/result in `artifacts/validation/t09/redelivery/`.
  - **Commit:** `feat(jobs): add durable report fixture`

- [x] 10. Implement Simple Loop direct, skill, and synchronous flows F01-F05
  - **Implement:** in `packages/runtime/src/simple-loop/`, construct a per-run AI SDK `ToolLoopAgent` from selected skill tools, use `isStepCount(8)`, persist step budget/context, intercept skill control and application policy, map model/tool outcomes into shared events, and atomically persist final text once.
  - **References:** MVP blueprint §§4-5, 11-12; validation plan F01-F05 and §6.1; official AI SDK ToolLoopAgent docs.
  - **Acceptance:** F01-F05/P01-P06 pass for `simple_loop`; failures complete with typed User-visible explanations; no partial message/event exists; bound exhaustion invokes no ninth step.
  - **QA happy:** `pnpm test:e2e --runtime=simple_loop --flows=F01-F05`; evidence `artifacts/validation/simple_loop/F01-F05/`.
  - **QA failure:** run repeating-tool model, malformed calls, and prohibited email request; expect `LOOP_STEP_LIMIT_EXCEEDED`/typed denials and zero extra invocation in `artifacts/validation/simple_loop/loop-failures/`.
  - **Commit:** `feat(simple-loop): support direct and sync flows`

- [x] 11. Add Simple Loop durable waits, resume, Admin flow, and restart recovery F06-F10
  - **Implement:** persist/release the lease on `waiting_for_tool`, `waiting_for_admin`, and `waiting_for_user`; resume with stable IDs and remaining step budget after job, decision, hidden command/User continuation, or restart; reconcile pending jobs/approvals and reject stale fencing writes.
  - **References:** validation plan F06-F10 and §6.1; MVP blueprint §§5, 9-10; `docs/simple-loop-architecture.md`.
  - **Acceptance:** F06-F10 pass for Simple Loop, including approved/rejected simulated email, hidden command privacy, worker-only restart, pending-approval restart, duplicate completion, and no second job/send/message.
  - **QA happy:** `pnpm test:e2e --runtime=simple_loop --flows=F06-F10`; evidence `artifacts/validation/simple_loop/F06-F10/`.
  - **QA failure:** `pnpm test:restart --runtime=simple_loop`; stop after durable job acceptance and while approval is pending, then assert stable IDs, one resume, and workflow worker zero claims in `artifacts/validation/simple_loop/restart/`.
  - **Commit:** `feat(simple-loop): persist waits and recovery`

- [x] 12. Build the deterministic Temporal workflow, Activities, signals, and replay harness
  - **Implement:** in `packages/runtime/src/state-workflow/`, define legal workflow states/transitions, deterministic workflow ID/reuse policy, signals for Admin decision, User continuation, and job completion, plus queryable inspect state. Put AI SDK generation, DB access, tools, queue actions, and reconciliation in Activities with explicit timeouts/retry policies and idempotency keys. Add workflow start reconciliation and history replay tests.
  - **References:** MVP blueprint §§3-5, 11; validation plan §6.2; `docs/state-workflow-architecture.md`; official Temporal TypeScript workflow/activity/testing docs.
  - **Acceptance:** workflow module imports no DB/AI SDK/tool/Redis clients; invalid/cross-run signals are rejected; replay runs without external I/O; Activity retries cannot duplicate logical state.
  - **QA happy:** `pnpm test:temporal-replay`; execute legal state/signal history and replay it, evidence `artifacts/validation/t12/replay/`.
  - **QA failure:** inject wrong IDs, illegal transitions, Activity timeout/retry, and forbidden workflow import check; evidence `artifacts/validation/t12/determinism-failures/`.
  - **Commit:** `feat(workflow): add durable temporal state machine`

- [x] 13. Implement State Workflow direct, skill, and synchronous flows F01-F05
  - **Implement:** connect workflow states/Activities to the shared provider, skill, tool, policy, event, and final-message services for RECEIVED→INTAKE→THINKING→tool/response terminal paths.
  - **References:** validation plan F01-F05 and State Workflow paths; MVP blueprint §§4, 11; todo 12 contracts.
  - **Acceptance:** F01-F05/P01-P06 pass for `state_workflow` with the same normalized traces/outcomes as Simple Loop while retaining legal Temporal diagnostics.
  - **QA happy:** `pnpm test:e2e --runtime=state_workflow --flows=F01-F05`; evidence `artifacts/validation/state_workflow/F01-F05/`.
  - **QA failure:** repeat malformed/unauthorized/bound-exhaustion scenarios and Activity retry; expect no duplicate tool/message in `artifacts/validation/state_workflow/sync-failures/`.
  - **Commit:** `feat(workflow): support direct and sync flows`

- [x] 14. Implement State Workflow durable waits, signals, and recovery F06-F10
  - **Implement:** wire WAITING_FOR_TOOL/WAITING_FOR_ADMIN/waiting-user states to durable signals and canonical-state Activities; resume once after correlated job/approval/Admin events; reconcile accepted jobs after worker restart and expose architecture-specific state/history position for inspection.
  - **References:** validation plan F06-F10 and §6.2; MVP blueprint §§5, 9-10; todo 12.
  - **Acceptance:** F06-F10 pass for State Workflow; restart/replay preserves workflow/run/call/job/approval IDs; duplicate signals/results are harmless; Simple worker never claims workflow runs.
  - **QA happy:** `pnpm test:e2e --runtime=state_workflow --flows=F06-F10`; evidence `artifacts/validation/state_workflow/F06-F10/`.
  - **QA failure:** `pnpm test:restart --runtime=state_workflow`; restart Temporal worker after job acceptance and during pending approval, duplicate signals, then assert one outcome in `artifacts/validation/state_workflow/restart/`.
  - **Commit:** `feat(workflow): add durable waits and recovery`

- [x] 15. Expose thin fixed-actor tRPC procedures and tracked SSE
  - **Implement:** in `apps/api` and shared router modules, implement exactly the blueprint procedure subset with Zod input/output, `mvpUserProcedure`/`mvpAdminProcedure`, thin application-service calls, snapshots carrying cursors, and `tracked()` SSE over persisted events. Register live listener before catch-up query, filter projections before yield, dedupe by event ID, handle abort cleanup, and refetch canonical state on cursor invalidation.
  - **References:** MVP blueprint §§5-6, 8; validation plan §3.1; official tRPC v11 subscription docs.
  - **Acceptance:** no procedure runs model/tool loops; User cannot invoke Admin procedures or receive hidden payloads; reconnect produces no gap/duplicate; only discrete persisted events are emitted.
  - **QA happy:** `pnpm test:integration -- trpc-sse`; verify all procedures, queued mutation receipt, catch-up/live sequencing, evidence `artifacts/validation/t15/trpc-sse/`.
  - **QA failure:** disconnect around event commit, use stale cursor, invoke Admin procedure as User, and inspect frames for secrets/hidden data; evidence `artifacts/validation/t15/trpc-sse-failures/`.
  - **Commit:** `feat(api): expose fixed actor trpc contract`

- [x] 16. Build accessible User and Admin React routes
  - **Implement:** in `apps/web/src/routes/`, add `/user/chat`, `/admin`, and `/admin/approvals`; runtime selector, composer, atomic message list, run/tool/job status, Admin run inspector, hidden-command composer, exact approval cards, connection recovery, and projection refetch. Use stable test IDs from Metis, `role="log"`, keyboard-native controls, focus preservation, textual progress, responsive layout, and no AI SDK React transport.
  - **References:** MVP blueprint §6; validation plan §3.1; accessibility requirements in full blueprint §6.5 only where relevant to these MVP controls.
  - **Acceptance:** User sees no Admin content/action and no partial text; Admin sees runtime/commands/approvals; both update without refresh and recover after SSE reconnect.
  - **QA happy:** `pnpm test:e2e --project=ui-happy`; Playwright sends direct/async prompts, approves/rejects, and sends hidden command across both runtimes, evidence/screenshots/traces `artifacts/validation/t16/ui-happy/`.
  - **QA failure:** Playwright disconnects/reconnects, checks duplicate suppression, keyboard operation, hidden-content DOM absence, and no `message.delta`, evidence `artifacts/validation/t16/ui-adversarial/`.
  - **Commit:** `feat(web): add user and admin mvp views`

- [x] 17. Complete the dual-runtime F01-F10 deterministic acceptance suite
  - **Implement:** build one parameterized harness for P01-P11/F01-F10, separate mandatory P05/P06 records under F05, attach cross-view assertions to every relevant flow, normalize event traces, and emit machine-readable acceptance records using the validation-plan template. Isolate fixture namespaces per runtime/test.
  - **References:** entire `docs/agentic-chat-mvp-validation-test-plan.md`; MVP blueprint §12; todos 10-16.
  - **Acceptance:** all 20 runtime/flow cells PASS; no BLOCKED/NOT RUN; each cell contains actor, IDs, calls, approval/job events, final response, projections, event trace, and evidence links.
  - **QA happy:** run `pnpm test:e2e --runtime=simple_loop && pnpm test:e2e --runtime=state_workflow`; evidence `artifacts/validation/acceptance/<runtime>/F01-F10/`.
  - **QA failure:** deliberately alter one expected normalized event in a harness self-test; ensure parity/acceptance fails rather than reporting misleading success, evidence `artifacts/validation/acceptance/harness-negative/`.
  - **Commit:** `test(e2e): validate f01-f10 across runtimes`

- [x] 18. Prove isolated restart, duplicate safety, parity, and comparison outputs
  - **Implement:** automate Compose-only restart of each matching runtime worker at deterministic F10 barriers and pending approval; verify other services/workers remain healthy. Add wrong-runtime/mutation, approval race/tampering, duplicate command/job/signal/event, SSE reconnect, Temporal replay, projection privacy, and atomic-message suites. Produce normalized trace diff and non-gating latency/recovery/complexity comparison report.
  - **References:** MVP blueprint §§10-12; validation plan F10 and §§6-9; research risk ledger.
  - **Acceptance:** `pnpm test:restart`, `pnpm test:parity`, and `pnpm test:temporal-replay` pass; no duplicate logical effect/message/job; normalized shared traces match; report clearly separates pass gates from measurements.
  - **QA happy:** execute all three commands against the full Compose environment, capture container IDs/health before and after, evidence `artifacts/validation/final-runtime-evidence/`.
  - **QA failure:** inject duplicate completion, stale lease, mismatched approval hash, wrong worker claim, and forbidden workflow I/O; every injection is detected with zero silent success in `artifacts/validation/final-adversarial/`.
  - **Commit:** `test(recovery): prove parity and restart safety`

## Final verification wave

- [x] F1. Plan compliance audit
  - Verify every requirement and Must-NOT-Have against the completed diff, map F01-F10 to implementation/evidence, and reject unplanned production scope. Run `pnpm test:contracts && pnpm test:db`; output `artifacts/validation/final/F1-plan-compliance.md` with an APPROVE/REJECT verdict.

- [x] F2. Code quality and security-boundary review
  - Run `pnpm lint && pnpm typecheck`; inspect module boundaries, Temporal determinism, SQL constraints, secret redaction, argument validation, authorization, approval binding, and idempotency. Output `artifacts/validation/final/F2-quality-security.md`; APPROVE only with no unresolved critical/high issue.

- [x] F3. Real system QA
  - From a clean state run `docker compose down --volumes`, `docker compose up --build --wait`, both runtime F01-F10 suites, Playwright UI/reconnect/privacy tests, and isolated worker restart tests. Output JUnit, traces, screenshots, service health, and `artifacts/validation/final/F3-system-qa.md`; all required cells must PASS.

- [x] F4. Scope fidelity and parity review
  - Compare normalized traces/final outcomes for both runtimes, verify no real email/network fixture side effect, no auth/Next.js/AI UI stream/deferred feature, and validate the comparison report distinguishes measurements from gates. Output `artifacts/validation/final/F4-scope-parity.md` with APPROVE/REJECT.

## Commit strategy

- Use the atomic conventional commit listed in each todo; do not combine unrelated waves.
- Never commit `.env`, `.env.local`, credentials, generated test artifacts, database volumes, or Temporal/Redis state.
- Keep migrations, schema changes, and their tests in the same commit.
- Keep runtime behavior and its contract/integration tests in the same commit.
- Before each commit run the task-specific QA command; before handoff run all final-wave commands from a clean Compose state.

## Success criteria

- `docker compose up --build --wait` starts PostgreSQL, Redis, Temporal, migration runner, web, API, both runtime workers, and fixture worker with health gates and persistent PostgreSQL volume.
- All F01-F10 cells PASS for both `simple_loop` and `state_workflow` using one shared deterministic harness and contract.
- Simple Loop uses bounded AI SDK 7 `ToolLoopAgent`; State Workflow uses Temporal with all external I/O in Activities and replay tests passing.
- Optional live mode uses `createOpenAI(...).responses(modelId)` with environment-provided Responses-capable base URL/model/key; deterministic gates need no credentials.
- AI output is persisted/rendered atomically through `message.completed`; no token delta or AI SDK UI stream exists.
- Runtime assignment is immutable, workers never cross-claim, restart reuses original IDs, and duplicate delivery creates no second logical job, send, resume, or final message.
- Exact approval is required for the simulated email logical side effect; rejection/tampering/races cannot execute it.
- User projections never expose hidden Admin commands or decision metadata; reconnect has no gap/duplicate.
- All four final verification tasks APPROVE, with machine-readable evidence retained at the documented paths.

# F1 Plan Compliance Audit

Date: 2026-08-17  
Scope: Final Verification Wave F1 only  
Auditor conclusion: **REJECT**  
Confidence: **0.99 (high)**

## Audit Basis

The audit independently read the full work plan, MVP development blueprint, MVP validation plan, decisions/learnings/issues notepads, current source boundaries, Task 17 schema-v2 records, and Task 18 Compose/adversarial evidence. Prior DoneClaims and static expected catalogs were not accepted as observed evidence.

Primary governing documents:

- `.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`
- `docs/agentic-chat-mvp-development-blueprint.md`
- `docs/agentic-chat-mvp-validation-test-plan.md`
- `.omo/notepads/agentic-chat-mvp-vercel-ai-sdk/{decisions,learnings,issues}.md`
- `.omo/start-work/ledger.jsonl`

## Exact Commands And Results

| Command | Result |
| --- | --- |
| `corepack pnpm test:contracts && corepack pnpm test:db` | PASS, exit 0. Contracts: 5 files, 75 tests. DB: 4 files, 20 tests against PostgreSQL. |
| Read-only inline Node audit over `artifacts/validation/acceptance/{simple_loop,state_workflow}/F*/P*.json` | PASS. 20 cells, 22 records, 22 schema-v2, 22 PostgreSQL-derived, 22 valid SHA-256 observation digests, 22 resolved evidence links, 22 existing test files, 0 BLOCKED, 0 NOT RUN. |
| Read-only inline Node audit over `artifacts/validation/final-runtime-evidence/restart.json` | PASS. 2 runtime recovery scenarios, 4 in-flight report/approval cases, target-only restarts, stable identities, one completion/send. |
| `docker compose down --volumes --remove-orphans` | PASS. Current project removed. |
| `docker compose -p agentic-chat-mvp down --volumes --remove-orphans` | PASS. Removed two stale exited PostgreSQL/Redis containers, their network, and PostgreSQL volume. |
| `docker compose ps --all` | 0 services. |
| `docker ps --all --filter name=agentic-chat --format '{{.ID}} {{.Names}} {{.Status}}'` | Empty. |
| `docker volume ls --filter name=agentic-chat` | No matching volumes. |
| `docker network ls --filter name=agentic-chat` | No matching networks. |
| `lsof -nP -iTCP:3000 -iTCP:4173 -iTCP:7233 -sTCP:LISTEN` | No listeners. |

## Task 1-18 Compliance Matrix

| Task | Deliverable verified | Source boundary | Actual evidence | Result |
| --- | --- | --- | --- | --- |
| 1 | Strict pnpm/ESM/Node 22 workspace, required scripts, Vite React stack, env validation, no Next.js production dependency | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.env.example`, app/package manifests | `artifacts/validation/t01/workspace/commands.log`, `t01/env-invalid/commands.log` | PASS |
| 2 | Shared branded Zod contracts, actors/runtimes, legal statuses, visibility, events, parity trace, F09 continuation, eight-step budget | `packages/contracts/src/` | `artifacts/validation/t02/contracts-valid/`, `t02/contracts-invalid/`; current F1 contract gate 75/75 | PASS |
| 3 | Drizzle PostgreSQL schema/migrations/seeds, constraints, idempotency, fencing, exact two actors/three skills/six tools | `packages/db/src/schema/`, `packages/db/src/repositories/`, `packages/db/migrations/`, `packages/db/src/seed-data.ts` | `artifacts/validation/t03/db/`, `t03/db-races/`; current F1 DB gate 20/20 | PASS |
| 4 | Health-gated Compose topology with PostgreSQL, Redis, Temporal, migration, web/API, shared Simple/Workflow/fixture worker image | `compose.yaml`, `infra/docker/`, `infra/tests/compose-topology.mjs` | `artifacts/validation/t04/compose-up/`, `t04/migration-gate/` | PASS |
| 5 | Durable admission, immutable runtime, fenced claims, canonical state/event/intent transactions, projections, reconciliation | `packages/runtime/src/application/admission.ts`, `projections.ts`, `reconciliation.ts`; `packages/db/src/repositories/leases.ts`; `migrations/0001_immutable_run_runtime.sql` | `artifacts/validation/t05/admission/results.md`, `t05/isolation/results.md` | PASS |
| 6 | Application provider boundary, deterministic AI SDK mock and optional Responses adapter, non-streaming/redacted/bounded behavior | `packages/runtime/src/provider/adapter.ts`, `environment.ts`, provider contracts | `artifacts/validation/t06/provider-mock/results.md`, `t06/provider-errors/results.md` | PASS |
| 7 | Versioned registry, skill control, calculator, preview, simulated send, job status, validation/policy boundary, no dynamic evaluation | `packages/tools/src/` | `artifacts/validation/t07/sync-tools/receipt.md`, `t07/tool-denials/receipt.md` | PASS |
| 8 | Exact immutable approval binding, single decision/send, hidden Admin command at safe boundary, no public bypass | `packages/db/src/schema/approvals.ts`, `repositories/approval-decisions.ts`, `schema/control.ts`; `packages/runtime/src/application/{approvals,admin-commands}.ts` | `artifacts/validation/t08/happy/receipt.md`, `t08/adversarial/receipt.md` | PASS |
| 9 | BullMQ report fixture, PostgreSQL job authority, queued/50%/completed lifecycle, deterministic identity and duplicate-safe reconciliation | `packages/runtime/src/application/report-jobs.ts`, `jobs/report-queue.ts`; DB report-job repositories | `artifacts/validation/t09/async-job/verification.txt`, `t09/redelivery/verification.txt` | PASS |
| 10 | Simple Loop F01-F05 uses per-run AI SDK 7 `ToolLoopAgent`, remaining `isStepCount` budget, exact tool exposure, atomic final message | `packages/runtime/src/simple-loop/runtime.ts`, DB Simple Loop repositories | `artifacts/validation/acceptance/simple_loop/F01-F05/` (6 PostgreSQL captures) | PASS |
| 11 | Simple Loop durable F06-F10 waits/resume/recovery with stable IDs, fence reacquisition, no duplicate effect | `packages/runtime/src/simple-loop/{durable-waits,wait-resolution,worker}.ts` | `artifacts/validation/acceptance/simple_loop/F06-F10/`; `final-runtime-evidence/restart.json` | PASS |
| 12 | Deterministic Temporal workflow, legal signals/queries, external I/O only in Activities, replay without external activity | `packages/runtime/src/state-workflow/workflows.ts`, `state-machine.ts`, `activity-runner.ts`; `tests/temporal-replay/` | `artifacts/validation/t12/replay/results.md`, `t12/determinism-failures/results.md`, `final-runtime-evidence/temporal-replay.json` | PASS |
| 13 | State Workflow F01-F05 through shared provider/tool/policy/event/message services | `packages/runtime/src/state-workflow/activity-runner.ts`, `activity-tools.ts` | `artifacts/validation/acceptance/state_workflow/F01-F05/` (6 PostgreSQL captures), `t13/verification.md` | PASS |
| 14 | State Workflow durable F06-F10 waits/signals/recovery with stable workflow/run/call/job/approval IDs | `packages/runtime/src/state-workflow/{activity-waits,signal-reconciliation,worker}.ts` | `artifacts/validation/acceptance/state_workflow/F06-F10/`; `final-runtime-evidence/restart.json` | PASS |
| 15 | Thin fixed-actor tRPC boundary and persisted tracked SSE catch-up/live ordering, privacy, dedupe, stale-cursor refetch | `apps/api/src/trpc.ts`, routers, `apps/api/src/events/stream.ts`; runtime projections | `artifacts/validation/t15/trpc-sse/verification.md`, `t15/trpc-sse-failures/verification.md` | PASS |
| 16 | Accessible fixed User/Admin React routes, runtime selection, approvals, hidden commands, reconnect/privacy, atomic messages | `apps/web/src/routes/`, `apps/web/src/api/` | `artifacts/validation/t16/verification.md` and `t16/playwright/.last-run.json` exist, but the claimed 10 traces/22 PNGs and planned `ui-happy`/`ui-adversarial` evidence do not | **FAIL (evidence gap)** |
| 17 | One dual-runtime P01-P11/F01-F10 harness, separate P05/P06, schema-v2 actual observations, negative self-test | `packages/testkit/src/{acceptance,acceptance-observation,acceptance-types}.ts`, acceptance scripts/specs | 20/20 cells PASS, 22/22 PostgreSQL records under `artifacts/validation/acceptance/`; `acceptance/harness-negative/altered-event.json` | PASS |
| 18 | Real Compose isolated restart, adversarial duplicate/race/privacy/replay gates, parity and non-gating comparison measurements | `packages/runtime/src/{compose-worker,compose-control}.ts`; `packages/testkit/scripts/task18-*.mjs` | `artifacts/validation/final-runtime-evidence/`, `final-adversarial/` | PASS |

The historical Task 10/11/13/14 plan-specific directory names were consolidated into the later schema-v2 acceptance root and final runtime evidence. The current evidence is stronger than the earlier per-task receipts: it is PostgreSQL-derived, digest-protected, linked to existing test files, and covers every required runtime/flow cell. This path consolidation is non-blocking and does not change production scope.

## F01-F10 Source And Evidence Mapping

Every row below has two observed records, one per runtime, except F05 which has four records because P05 and P06 are mandatory separate captures. All records report `PASS`; none report `BLOCKED` or `NOT RUN`.

| Flow | Requirement observed | Source boundary | Simple Loop evidence | State Workflow evidence | Result |
| --- | --- | --- | --- | --- | --- |
| F01/P01 | Correct actors, exact `CHAT_OK`, no skill/tool, one atomic AI completion, terminal run | Runtime completion transaction and shared events | `acceptance/simple_loop/F01/P01.json` | `acceptance/state_workflow/F01/P01.json` | PASS |
| F02/P02 | Exactly `calculator_assistant@1`, calculator-only allowlist, zero tool invocation | Skill registry/snapshot persistence | `acceptance/simple_loop/F02/P02.json` | `acceptance/state_workflow/F02/P02.json` | PASS |
| F03/P03 | One calculator call with exact expression and result `1040`; AI consumes result | Tool registry and runtime tool adapters | `acceptance/simple_loop/F03/P03.json` | `acceptance/state_workflow/F03/P03.json` | PASS |
| F04/P04 | Typed `DIVISION_BY_ZERO`, failed tool status, no fabricated number, User explanation | Calculator/tool error mapping | `acceptance/simple_loop/F04/P04.json` | `acceptance/state_workflow/F04/P04.json` | PASS |
| F05/P05+P06 | P05 `SKILL_NOT_FOUND` with no call; P06 calculator skill plus rejected email tool, no approval/side effect | Registry resolution and allowlist policy | `acceptance/simple_loop/F05/{P05,P06}.json` | `acceptance/state_workflow/F05/{P05,P06}.json` | PASS |
| F06/P07 | One correlated run/call/job, 50% progress, same-run resume, final `report_001`, one logical execution | PostgreSQL report ledger, BullMQ coordination, wait resolution | `acceptance/simple_loop/F06/P07.json` | `acceptance/state_workflow/F06/P07.json` | PASS |
| F07/P08 | Exact pending approval, zero pre-approval send, one Admin-approved send and final confirmation | Exact approval service and simulated-send uniqueness | `acceptance/simple_loop/F07/P08.json` | `acceptance/state_workflow/F07/P08.json` | PASS |
| F08/P09 | Exact Admin rejection, zero send, same-run completion with not-sent outcome | Approval decision transaction and rejection result | `acceptance/simple_loop/F08/P09.json` | `acceptance/state_workflow/F08/P09.json` | PASS |
| F09/P10 | Fixed Admin command persisted/applied at `before_model`; exact response; raw command absent from User projection | Admin command service and role-filtered projections | `acceptance/simple_loop/F09/P10.json` | `acceptance/state_workflow/F09/P10.json` | PASS |
| F10/P11 | Stable original run/call/job, no second job/result, recovered matching worker, other worker unchanged | Fenced Simple resume and Temporal history/workflow identity | `acceptance/simple_loop/F10/P11.json`; `final-runtime-evidence/restart.json` | `acceptance/state_workflow/F10/P11.json`; `final-runtime-evidence/restart.json` | PASS |

Task 17 record audit counts:

- Runtime/flow cells: **20/20 PASS**.
- Individual records: **22/22 PASS**, because F05 has separate P05/P06 records per runtime.
- `schemaVersion: 2`: **22/22**.
- `provenance.source: postgresql_projection_capture`: **22/22**.
- Valid SHA-256 observation digest: **22/22**.
- Resolved evidence link and existing `metadata.testFile`: **22/22**.
- `BLOCKED`: **0**. `NOT RUN`: **0**.
- P05/P06 distinctness: **4/4 unique digests**, distinct run IDs and fixture namespaces; P05 has no selected skill/call, while P06 selects calculator and records a rejected `notification.send_email` call with zero approval/side effect.
- `packages/testkit/src/acceptance-expectations.ts` and the two `matrix.json` files were treated only as expected/index data, never as observed acceptance evidence.

## Critical Architecture Controls

- **Bounded Simple Loop:** `packages/runtime/src/simple-loop/runtime.ts` constructs `ToolLoopAgent`, computes remaining persisted budget, applies `stopWhen: isStepCount(remainingSteps)`, disables retries, uses total/step timeouts, and calls non-streaming `agent.generate`.
- **Deterministic State Workflow:** `packages/runtime/src/state-workflow/workflows.ts` contains only Temporal workflow primitives, pure state transitions, signals/queries, conditions, and proxied Activities. Provider, PostgreSQL, queue, and tool work occurs in Activity-side modules such as `activity-runner.ts`. The reachable workflow import test forbids Node, AI SDK, DB, tools, BullMQ, Redis, and PostgreSQL clients.
- **PostgreSQL authority:** runs, canonical events, messages, skills, tool calls, approvals, jobs, commands, idempotency keys, dispatch intents, and simulated sends are persisted through Drizzle/PostgreSQL. Redis/BullMQ and Temporal coordinate delivery/orchestration only.
- **Immutable assignment and fencing:** PostgreSQL trigger `runs_runtime_immutable`, runtime predicates, lease owner/expiry, aggregate version, and fencing version reject runtime mutation, cross-claim, stale lease, and stale write.
- **Idempotency:** `reserveIdempotency` atomically inserts or replays the hash-bound original response; changed scope/hash conflicts.
- **Exact approvals:** schema permits only `notification.send_email` with `mvp_admin`; request stores call/tool-version/arguments/hash/expiry/version; row-locked decision validates exact binding and permits one action/send.
- **Hidden Admin privacy:** commands are fixed to `mvp_admin` and `model_only`, apply only at `before_model`, and User event projection filters before schema output and SSE delivery.
- **SSE replay:** listener registration precedes catch-up; persisted cursor reads advance across inspected hidden events; stale cursor produces canonical refetch; event IDs are deduplicated; abort unsubscribes.
- **Atomic messages:** both runtime completion repositories insert the complete AI message, update terminal run state, and insert `message.completed` plus status event in one PostgreSQL transaction. No partial text path exists.

## Task 18 Causal Compose Verification

The restart evidence is not scaffold health combined with unrelated tests.

- Compose runs three real worker roles from the shared runtime image: `worker-simple` executes Simple Loop and Bull report coordination; `worker-workflow` runs a real Temporal worker and Activities; `fixture-worker` runs the BullMQ fixture worker.
- `task18-compose.mjs` admits real report and approval runs through the runtime worker's `compose-control.js` against PostgreSQL.
- Before restart, the report barrier is `waiting_for_tool` plus a running job and the approval barrier is `waiting_for_admin` plus a pending approval.
- The harness executes `docker compose restart <matching-worker>` while both cases are in-flight, proves only the target start timestamp changes, then releases the report fixture and approves the exact call.
- Simple Loop resumes with increased fencing versions. State Workflow resumes with the same Temporal workflow identities.
- Both runtimes produce one completed report job/event and one approved simulated send.

Observed counts:

- Real Compose worker roles: **3**.
- Runtime recovery scenarios: **2** (`simple_loop`, `state_workflow`).
- In-flight causal cases: **4** (report + approval per runtime).
- Simple recovery: **6251 ms**, 7 unchanged healthy peers.
- State Workflow recovery: **10084 ms**, 7 unchanged healthy peers.
- Adversarial suites: **3**, tests **52** total (17 DB + 19 runtime + 16 API), all PASS with `zeroSilentSuccess: true`.
- Temporal replay: **10 tests PASS**, external Activities during replay **0**, canonical post-commit effects **1**.
- Comparison gates: restart PASS, parity PASS, Temporal replay PASS. Complexity and durations are explicitly non-gating measurements with no thresholds.

Task 18 controls are test-only and production-gated:

- `TASK18_COMPOSE_MODE` must equal `enabled` in worker/control schemas.
- `compose-control.ts` additionally requires `NODE_ENV=test`.
- Test report service/worker constructors throw outside `NODE_ENV=test`.
- Test constructors are exposed only through `@agentic-chat/runtime/testing`; the production runtime root and `apps/worker` do not export them.
- `async-job.integration.test.ts` explicitly proves production-mode construction fails and test constructors are absent from the production namespace.

## Must-NOT-Have Audit

| Exclusion | Verification | Result |
| --- | --- | --- |
| Next.js, RSC, App Router | Package manifests contain no Next dependency; web is Vite React; source scan found no Next imports/conventions | PASS |
| AI SDK UI stream, `message.delta`, token deltas, partial AI rendering | Provider and agents use non-streaming generation; event contract rejects `message.delta`; app/package source scan found no UI stream/`streamText` path | PASS |
| Authentication/session/OIDC, accounts, tenancy, generalized RBAC | API creates only fixed `mvp_user`/`mvp_admin` contexts and exact procedure guards; manifests/source contain no auth or tenancy implementation | PASS |
| Files, retrieval, citations, memory, sharing, exports, multi-agent, production operations | No corresponding production package, schema, procedure, route, or tool exists | PASS |
| SMTP/provider email or real external side effect | Only local `simulated_sends` exists; no SMTP/email SDK dependency or network delivery implementation exists | PASS |
| Browser/file/code execution or destructive/external/database-mutation tools | Registry remains exactly the six MVP tool definitions; calculator uses a bounded parser, not dynamic evaluation | PASS |
| Live model output as deterministic gate | Acceptance and Compose gates use deterministic mock provider; live Responses mode is optional | PASS |
| DB/network/LLM/tool calls inside Temporal workflow code | Workflow source delegates all external work to Activities; reachable-import test and replay evidence pass | PASS |
| Generic event platform or production outbox | Only targeted `dispatch_intents` and reconciliation for required durable delivery exist | PASS |
| More than one approval-gated tool or public bypass | PostgreSQL check restricts approvals to `notification.send_email` and `mvp_admin`; capability/test controls are not production-exported | PASS |

No unplanned production scope was found.

## Evidence Integrity And Cleanup

- All 22 acceptance evidence links resolve and match runtime/flow/prompt identity.
- All 22 observation digests recompute correctly from the stored observation body.
- User projections contain only `visibility=user` events and no `mvp_admin` actor marker.
- `final-runtime-evidence/cleanup.json` records PASS, exit 0, zero containers, and zero listeners.
- The F1 post-gate cleanup independently found and removed two stale exited `agentic-chat-mvp` containers plus their network/volume. Final independent checks found zero Compose services, zero matching containers/volumes/networks, and no listeners on ports 3000, 4173, or 7233.
- Task 16 evidence is internally inconsistent: `artifacts/validation/t16/verification.md` claims 10 retained `trace.zip` files and 22 PNG captures under `artifacts/validation/t16/playwright/`, but the current directory contains only `.last-run.json`. The plan-designated `t16/ui-happy/` and `t16/ui-adversarial/` roots also do not exist.
- This audit modified no product code, tests, or plan checkbox. Only this F1 report and the corresponding reviewer finding in the issues notepad were written.

## Blocking Gaps

One blocking evidence-retention gap remains. Task 16's required generated browser evidence is absent despite the retained verification receipt claiming it exists. The four-line `.last-run.json` proves only that the last Playwright invocation reported `passed`; it does not substantiate the claimed 10 scenarios, visual surfaces, traces, screenshots, responsive checks, or console/page-error assertions. F1 cannot independently verify every Task 16 plan deliverable from current evidence without performing F3-style browser QA, which is outside this gate's scope.

All other audited requirements pass: every Task 1-15 and 17-18 deliverable is mapped to current source/evidence, all 20 runtime/flow cells pass, all Must-NOT-Have exclusions hold, the exact F1 contract/DB command passes, and no database/Compose resource remains.

**VERDICT: REJECT**

---

## Remediation Rerun - 2026-08-17

The original F1 rejection above is preserved as historical evidence. This rerun inspected the current filesystem after fresh F3 system QA repaired Task 16 evidence retention, then accounted for the subsequent F2 dispatch/provider/test-gate fixes and F4 comparator hardening.

Current disposition: **APPROVE**  
Confidence: **0.99 (high)**

### Original Blocker Resolution

The Task 16 evidence-retention blocker is resolved in the current tree:

- `artifacts/validation/t16/playwright/` contains exactly **10** `trace.zip` files and **22** PNG files.
- All 10 ZIP files are non-empty and pass archive integrity testing.
- All 22 PNG files are non-empty and have valid PNG signatures.
- Artifact modification times span `2026-08-17T10:50:27.619Z` through `2026-08-17T10:50:35.222Z`, matching the final F3 count receipt.
- `F3-system-qa/20-ui-junit.xml` reports 10 tests, 0 failures, 0 skipped, and 0 errors. All **26/26** JUnit attachment links resolve.
- `F3-system-qa/20-ui-combined-junit.log` reports **10 passed (11.6s)**: 3 happy, 4 adversarial/privacy/layout/reconnect, and 3 deterministic race tests.
- All **31/31** Markdown evidence links in `F3-system-qa.md` resolve.
- All 22 screenshots were directly inspected. They cover desktop User chat, Admin inspector, normal/scrolled approvals, 375px mobile reflow, User privacy/wait state, reconnect, and race terminal states. No blocking corruption, clipping, overlap, horizontal overflow, malformed composition, duplicate in-page response, or visible cross-role leakage was found.
- The JUnit attachment set contains 16 PNG links because six named screenshots are also retained as duplicate attachment copies. The physical total of 22 PNGs is correct and the redundancy is evidence duplication, not duplicated UI content.

`F3-system-qa/11-ui-artifact-manifest.json` describes the earlier 10:41 artifact set and is stale relative to the authoritative final 10:50 set. It is retained as historical run metadata only. The authoritative final evidence is the physical directory, `20-ui-junit.xml`, `20-ui-combined-junit.log`, and `26-final-ui-artifact-count.json`.

### F2 Corrections And Scope Compliance

The later F2 corrections remain inside the frozen MVP scope and do not invalidate Tasks 1-18:

| Correction | Current source verification | Plan/scope result |
| --- | --- | --- |
| Simple Loop intent acknowledgement | `compose-simple-dispatch.ts` acknowledges only after a durable wait/terminal result, clears stale terminal delivery, and rethrows transient failure. `simple-loop-dispatch.ts` transactionally validates intent ID/topic/aggregate/runtime/payload before changing `pending` to `dispatched`. | Restores Task 5/11/18 durable dispatch behavior; no new product feature. |
| Completion-bound report resume | Report resume intent is created at canonical completion rather than premature progress, and real restart evidence passes. | Preserves F06/F10 same-run resume and duplicate safety. |
| Dual test-mode worker gate | `compose-worker.ts` now requires both `NODE_ENV=test` and `TASK18_COMPOSE_MODE=enabled` for all three worker roles; control/test constructors remain test-gated. | Test-only Task 18 behavior remains excluded from production exports. |
| Provider abort propagation | `provider-model.ts` forwards the exact caller-owned `AbortSignal` into `provider.generate`; streaming remains disabled. | Strengthens Task 6 bounded provider behavior without changing contracts. |
| Tools package gate | `package-boundary.test.ts` parses the conditional production/default export map and retains root approval-capability denial; package test remains fail-closed `vitest run`. | Preserves Task 7/8 package and approval boundaries. |

Manifest and production-source searches found no auth/OIDC/session/tenancy dependency or implementation. The only identity behavior remains the blueprint-mandated unauthenticated fixed-route `mvp_user`/`mvp_admin` context. No login, account, tenant, generalized RBAC, or production identity scope was added.

### F4 Comparator Hardening

The F4 correction is confined to Testkit comparator/mutation tests and generated parity/comparison evidence:

- `acceptance-comparison.ts` uses an explicit generated-identity path allowlist; it has no suffix-based `endsWith("Id")` or `endsWith("Hash")` normalization.
- Semantic `skillId`, selected skill/version/instructions/allowlist, tool arguments/results/errors, approval actor/decision, job progress/result, event type/order/visibility/payload, and final status remain comparable.
- Approval hashes normalize only when recomputed from the exact captured send-call arguments. Runtime-specific final prose normalizes only for P04 and P08.
- A fresh focused run of `corepack pnpm --filter @agentic-chat/testkit exec vitest run tests/parity/acceptance-comparison.mutation.test.ts` passed **18/18** fail-closed semantic mutation barriers.
- Comparator and mutation files only read/clone acceptance records. The parity record test writes only `final-runtime-evidence/parity.json`; the Task 18 parity script writes only comparison evidence.
- All **22/22** current acceptance observation digests remain valid and match the digest references in the hardened `parity.json`; no acceptance-record writer exists in the hardening path.

One initial focused mutation invocation observed three missing record files while concurrent acceptance/restart activity was replacing runtime evidence. After the writer completed, the current tree contained all 22 records and the identical command passed 18/18. The final validation below was performed after Compose cleanup and against the stable current tree.

### Task 17 And Task 18 Revalidation

Final stable-tree Task 17 audit:

- Runtime/flow cells: **20/20 PASS**.
- Individual records: **22/22 PASS**.
- Schema v2 and PostgreSQL projection provenance: **22/22**.
- Recomputed observation digests: **22/22 valid**.
- Hardened parity digest references: **22/22 match**.
- Evidence links and metadata test files: **22/22 resolve**.
- User projection privacy checks: **22/22 pass**.
- `BLOCKED`: **0**. `NOT RUN`: **0**.
- P05/P06: four records with **4/4 distinct digests** and distinct missing-skill versus prohibited-tool outcomes.

Final stable-tree Task 18 audit:

- Real runtime recovery scenarios: **2**, covering Simple Loop and State Workflow.
- Causal in-flight cases: **4**, report plus pending approval for each runtime.
- Each report barrier is `waiting_for_tool` with a running job; each approval barrier is `waiting_for_admin` with a pending approval before restart.
- Each target worker has a changed start time and returns healthy; all seven peers retain container identity/start time and health.
- Each recovered report has one `job.completed`; each approval has one approved decision and one send.
- Current recovery measurements are 6491 ms for Simple Loop and 10559 ms for State Workflow; they remain non-gating measurements.
- `final-runtime-evidence/cleanup.json` remains PASS with no remaining containers or listeners.

### Fresh Required Gates

Exact command:

```sh
corepack pnpm test:contracts && corepack pnpm test:db
```

Result: exit 0.

- Contracts: **5 files, 75/75 tests passed**.
- PostgreSQL DB: **4 files, 21/21 tests passed**, including the added completion-bound resume regression.

### Cleanup

During the first post-gate check, a concurrent Task 18 run owned a healthy nine-service Compose topology. It was not interrupted. After that run completed its own teardown, final independent checks found:

- `docker compose ps --all`: **0 services**.
- Matching `agentic-chat` containers: **0**.
- Matching volumes: **0**.
- Matching networks: **0**.
- Listeners on ports 3000, 4173, 7233, 4310, and 4311: **0**.

No product code, tests, plan checkbox, or Git state was modified by this F1 rerun. Only this remediation disposition was appended to the existing F1 report.

### Fresh Disposition

The historical Task 16 evidence blocker is repaired, F2 corrections preserve the frozen scope while restoring required durable/provider/test boundaries, F4 is fail-closed across 18 semantic mutation classes without changing the 22 observed records, all Tasks 1-18 remain mapped and compliant, and no blocking gap remains.

VERDICT: APPROVE

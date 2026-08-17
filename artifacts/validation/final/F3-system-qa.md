# F3 Real System QA

**VERDICT: APPROVE**

---

## Current-source rerun after F2/F4 corrections

This section appends a new clean-state F3 wave. The preceding approval and its evidence remain as historical record.

### Rerun scope and timing

- Source under test includes the F2 dispatch/provider corrections and F4 parity hardening.
- Wave started at `2026-08-17T11:32:02Z` and cleanup completed at `2026-08-17T11:41:43.319Z`.
- Docker-sensitive commands ran sequentially.
- Product code, tests, plan checkboxes, and Git state were not modified.
- New evidence root: `artifacts/validation/final/F3-system-qa-rerun-20260817T113202Z/`.

### Clean Compose rebuild

`docker compose down --volumes --remove-orphans` exited 0, followed by `docker compose up --build --wait` exiting 0. All nine current-source services were running and healthy:

| Service | Container ID | Health |
| --- | --- | --- |
| api | `cf68bbbcd24f` | healthy |
| fixture-worker | `cb45da3fd9d9` | healthy |
| migration | `ddbadb154204` | healthy |
| postgres | `bed3c8640619` | healthy |
| redis | `b545058d4f97` | healthy |
| temporal | `9ef9ec2d0f20` | healthy |
| web | `9a9515a47572` | healthy |
| worker-simple | `981c7b6e5099` | healthy |
| worker-workflow | `78996b72ccc7` | healthy |

API scaffold health, web HTTP, and Temporal cluster probes passed. Migration completed, and `fixture_jobs`, `simple_loop`, and `state_workflow` each logged `worker.ready`. Compose worker startup also proved the corrected `NODE_ENV=test` plus `TASK18_COMPOSE_MODE=enabled` boundary.

Evidence: [clean teardown](F3-system-qa-rerun-20260817T113202Z/01-clean-down.log), [build and wait](F3-system-qa-rerun-20260817T113202Z/02-compose-up.log), [service IDs and health](F3-system-qa-rerun-20260817T113202Z/03-compose-services.jsonl), [API probe](F3-system-qa-rerun-20260817T113202Z/04-api-health.json), [web probe](F3-system-qa-rerun-20260817T113202Z/05-web-health.html), [Temporal probe](F3-system-qa-rerun-20260817T113202Z/06-temporal-health.txt), and [service logs](F3-system-qa-rerun-20260817T113202Z/07-compose-services.log).

### Dual-runtime acceptance

| Runtime | Required cells | Result | JUnit failures/errors |
| --- | ---: | --- | ---: |
| Simple Loop | 10 | 10/10 PASS | 0/0 |
| State Workflow | 10 | 10/10 PASS | 0/0 |

All **20/20 required F01-F10 cells passed**. Each Playwright invocation discovered both runtimes and intentionally skipped only the ten opposite-runtime specs; no selected required cell was skipped, blocked, or not run. The regenerated matrices contain ten PASS cells each, including both F05 prompt records.

Evidence: [Simple Loop log](F3-system-qa-rerun-20260817T113202Z/08-acceptance-simple-loop.log), [Simple Loop JUnit](F3-system-qa-rerun-20260817T113202Z/08-simple-loop-junit.xml), [State Workflow log](F3-system-qa-rerun-20260817T113202Z/09-acceptance-state-workflow.log), [State Workflow JUnit](F3-system-qa-rerun-20260817T113202Z/09-state-workflow-junit.xml), [Simple Loop matrix](../acceptance/simple_loop/matrix.json), and [State Workflow matrix](../acceptance/state_workflow/matrix.json).

### Browser UI, privacy, reconnect, and races

The combined `ui-happy` and `ui-adversarial` run passed **10/10** with one worker: three happy paths, four adversarial/privacy/layout/reconnect paths, and three deterministic race paths.

- Console errors: 0; page errors: 0, enforced by every scenario's fail-closed observer.
- Fresh retained Task 16 output: **10 non-empty traces and 22 non-empty PNGs**.
- Artifact timestamps: `2026-08-17T11:35:31.780Z` through `2026-08-17T11:35:39.864Z`.
- Privacy passed: no hidden Admin command, prepared approval details, `mvp_admin`, or `message.delta` leaked to User DOM.
- Atomicity/reconnect passed: complete messages only, no duplicates, canonical stale-cursor recovery, and no late-response projection overwrite.
- Manual inspection covered desktop User chat, Admin inspector, approvals normal/scrolled, User privacy wait, and 375px mobile. No clipping, overlap, horizontal overflow, malformed layout, duplicate content, partial message, or cross-role leakage was visible.

Evidence: [UI log](F3-system-qa-rerun-20260817T113202Z/10-ui-combined.log), [UI JUnit](F3-system-qa-rerun-20260817T113202Z/10-ui-junit.xml), [artifact manifest](F3-system-qa-rerun-20260817T113202Z/11-ui-artifact-manifest.json), and [retained Task 16 traces/screenshots](../t16/playwright/).

### Causal Compose restart and durable acknowledgement

`corepack pnpm test:restart` passed its independent clean rebuild, both targeted worker restarts, 52 adversarial integration tests, and internal cleanup.

| Runtime | Target | Pre-restart report barrier | Pre-restart approval barrier | Recovery |
| --- | --- | --- | --- | ---: |
| Simple Loop | `worker-simple` | `waiting_for_tool`, job running at 50% | `waiting_for_admin`, approval pending | 6,491 ms |
| State Workflow | `worker-workflow` | `waiting_for_tool`, job running at 50% | `waiting_for_admin`, approval pending | 10,559 ms |

Both runtimes retained the exact run, job, call, ledger, approval, and workflow identities across restart. Each report completed with exactly one `job.completed`; each approved action produced exactly one completed send call and one send record. Target containers retained identity but changed `StartedAt`, returned healthy, and every peer container ID/start time remained unchanged and healthy.

The corrected Simple Loop acknowledgement behavior was observed directly in persisted evidence:

- The report resume intent was absent at the 50% progress barrier.
- Admission intent `dispatch_simple_loop_f10_report_3` was already `dispatched`, attempts `1`.
- Completion resume intent `report-job-c52c7a3d6b05bed19b3899fc-resume` appeared only after canonical completion and was `dispatched`, attempts `1`.
- Approval admission and approval-resume intents were both `dispatched`, attempts `1`.
- Pending Simple Loop execute intents after both completed scenarios: **0**.
- Therefore replacement workers did not repeatedly retry already handled boundaries.

Evidence: [restart log](F3-system-qa-rerun-20260817T113202Z/12-restart.log), [current restart result](../final-runtime-evidence/restart.json), [current command ledger](../final-runtime-evidence/restart-commands.json), and [fail-closed acknowledgement/identity summary](F3-system-qa-rerun-20260817T113202Z/13-restart-ack-summary.json).

### Corrected parity and Temporal replay

- Corrected parity: **25/25 PASS** across three files.
- Cross-runtime evidence: all 11 PostgreSQL-derived comparisons had matching normalized traces and outcomes.
- Semantic barriers: **18/18** isolated mutations were rejected, covering skill identity/version/allowlist/instructions, tool argument/result/error, approval actor/hash/decision, job percent/result, event visibility/type/order/payload, and terminal status.
- Temporal replay: **10/10 PASS** across four files, with `externalActivitiesDuringReplay=0` and `postCommitRetryCanonicalEffects=1`.
- The replay's injected post-commit timeout was the intended retry stimulus and completed with one canonical effect.

Evidence: [parity log](F3-system-qa-rerun-20260817T113202Z/14-parity.log), [current parity JSON](../final-runtime-evidence/parity.json), [replay log](F3-system-qa-rerun-20260817T113202Z/15-temporal-replay.log), [current replay JSON](../final-runtime-evidence/temporal-replay.json), and [25-test/18-mutation/replay summary](F3-system-qa-rerun-20260817T113202Z/16-parity-replay-summary.json).

The parity test environment emitted one non-fatal Temporal metrics-trailer shutdown diagnostic (`SendHeader called multiple times`) after a worker stopped. All 25 assertions passed, subsequent workflows completed, and no required gate or persisted result was affected.

### Cleanup and decision

- Final `docker compose down --volumes --remove-orphans`: exit 0.
- Remaining Compose containers: 0.
- Remaining project-labelled volumes: 0.
- Remaining project-labelled networks: 0.
- Listeners on 3000, 4173, 7233, 4310, and 4311: 0.
- Task 16 traces/screenshots remain retained for F1 inspection.
- Aggregate current-code gate summary: `verified=true`.

Evidence: [final teardown](F3-system-qa-rerun-20260817T113202Z/17-final-down.log), [cleanup receipt](F3-system-qa-rerun-20260817T113202Z/18-cleanup-receipt.json), and [aggregate gate summary](F3-system-qa-rerun-20260817T113202Z/19-gate-summary.json).

VERDICT: APPROVE

## Scope and timing

- Gate: Final Verification Wave F3, real system QA only.
- Workspace: `/Users/riegan/Project/ruangguru/new-agentic-chat-v2`.
- Fresh wave: `2026-08-17T10:37:52Z` through cleanup confirmation at `2026-08-17T10:52:15.726Z`.
- Product code, tests, plan checkboxes, and Git state were not modified.
- Docker-sensitive suites were executed sequentially.
- No required cell was `BLOCKED`, `NOT RUN`, skipped, failed, or errored.

## Clean Compose topology

1. `docker compose down --volumes --remove-orphans` exited 0 at `2026-08-17T10:37:57.503Z`.
2. `docker compose up --build --wait` exited 0 at `2026-08-17T10:39:22.857Z` after fresh app and worker builds.
3. All nine services were running and healthy. Initial clean-build container IDs were:

| Service | Container ID | Health |
| --- | --- | --- |
| api | `e72696693738` | healthy |
| fixture-worker | `d5df3a615758` | healthy |
| migration | `559bda192301` | healthy |
| postgres | `2138e5369daf` | healthy |
| redis | `4a38812943c7` | healthy |
| temporal | `62c3534e8699` | healthy |
| web | `3be34788080f` | healthy |
| worker-simple | `90682e5e6df3` | healthy |
| worker-workflow | `41dc2a90b686` | healthy |

4. Live probes passed: API `/healthz/` returned `{"status":"ready","scope":"infrastructure_scaffold"}`, web `/` returned HTML, and Temporal cluster health returned `SERVING`. The API result is recorded only as scaffold health, not as worker recovery evidence.
5. A final fresh service-log capture retained migration success, Postgres/Redis readiness, Temporal serving, and `worker.ready` for `fixture_jobs`, `simple_loop`, and `state_workflow`.

Evidence: [clean down](F3-system-qa/01-clean-down.log), [build/up](F3-system-qa/02-compose-up.log), [initial service IDs/health](F3-system-qa/03-compose-services.jsonl), [images](F3-system-qa/04-compose-images.jsonl), [API health](F3-system-qa/05-api-health.txt), [web probe](F3-system-qa/06-web-health.html), [Temporal health](F3-system-qa/07-temporal-health.txt), [service logs](F3-system-qa/22-compose-services.log), and [final service health](F3-system-qa/23-final-service-health.jsonl).

## Dual-runtime acceptance

The required commands were run sequentially. Each invocation selected one runtime's ten F01-F10 cells; the ten reported skips were exclusively the unselected opposite-runtime specs and are not required-cell skips.

| Runtime | Command | Required result | Matrix |
| --- | --- | --- | --- |
| Simple Loop | `corepack pnpm test:e2e --runtime=simple_loop` | 10 passed, 0 required skipped/failed | 10/10 PASS |
| State Workflow | `corepack pnpm test:e2e --runtime=state_workflow` | 10 passed, 0 required skipped/failed | 10/10 PASS |

- Total required runtime cells: **20/20 PASS**.
- F01-F10 all passed for both runtimes; F05 retained both P05 and P06 records, giving 11 PostgreSQL projection records per runtime.
- The final JUnit reporter pass reproduced the same matrices. Simple Loop JUnit: 20 discovered, 10 selected passed, 10 opposite-runtime skipped, 0 failures/errors. State Workflow JUnit: 20 discovered, 10 selected passed, 10 opposite-runtime skipped, 0 failures/errors.

Evidence: [Simple Loop log](F3-system-qa/08-acceptance-simple-loop.log), [State Workflow log](F3-system-qa/09-acceptance-state-workflow.log), [Simple Loop JUnit](F3-system-qa/18-simple-loop-junit.xml), [State Workflow JUnit](F3-system-qa/19-state-workflow-junit.xml), [Simple Loop matrix](../acceptance/simple_loop/matrix.json), and [State Workflow matrix](../acceptance/state_workflow/matrix.json).

## Browser UI, reconnect, privacy, and races

`corepack pnpm test:e2e --project=ui-happy --project=ui-adversarial` passed **10/10** using one project Playwright Chromium worker:

- Happy: 3/3 passed.
- Adversarial/privacy/layout/reconnect: 4/4 passed.
- Deterministic races: 3/3 passed.
- Browser console errors: 0. Page errors: 0. Every scenario installs the fail-closed `observeConsole` assertion.
- Privacy assertions passed: no Admin command, Admin metadata, `mvp_admin`, or `message.delta` in User DOM.
- Reconnect and race assertions passed: canonical refetch, one final answer, no duplicate prompt/message, and no stale projection overwrite.
- Layout assertions passed: sticky desktop header, compact approval headers, static mobile header, `scrollWidth <= 375`, no horizontal overflow.
- Fresh artifacts: **10 trace ZIPs** and **22 non-empty PNGs**, timestamped `2026-08-17T10:50:27.620Z` through `2026-08-17T10:50:35.222Z`.
- Manual screenshot inspection covered desktop User chat, Admin inspector, approvals normal/scrolled, and 375x812 mobile User chat. No clipping, overlap, overflow, duplicate content, malformed layout, or visible cross-role leakage was found.

Evidence: [UI run log](F3-system-qa/20-ui-combined-junit.log), [UI JUnit](F3-system-qa/20-ui-junit.xml), [artifact count](F3-system-qa/26-final-ui-artifact-count.json), and [Playwright traces/screenshots](../t16/playwright/).

## Causal isolated worker restart

`corepack pnpm test:restart` exited 0. Its own flow performed clean volume teardown, `docker compose up --build --wait`, persisted two barriers per runtime, restarted only the targeted real Compose worker, verified recovery, ran 52 adversarial integration tests, and cleaned the topology.

| Runtime | Target | Persisted barriers before restart | Recovery | Completion |
| --- | --- | --- | --- | --- |
| Simple Loop | `worker-simple` | report `waiting_for_tool`, job `running` at 50%; approval `waiting_for_admin` and `pending` | 6,353 ms | report completed once; approval completed/approved; one send |
| State Workflow | `worker-workflow` | report `waiting_for_tool`, job `running` at 50%; approval `waiting_for_admin` and `pending` | 10,523 ms | report completed once; approval completed/approved; one send |

Identity continuity and isolation were exact:

- Simple Loop report: run `run_simple_loop_f10_report_4`, job `job_001`, call `call_report_simple_loop_f10_report`, ledger `report-job-c52c7a3d6b05bed19b3899fc`, job workflow `bullmq/report-c52c7a3d6b05bed19b3899fc`.
- Simple Loop approval: run `run_simple_loop_pending_approval_4`, approval `approval_c3733f03-cbca-4bd5-835f-46c58d8334a7`, call `call_send_simple_loop_pending_approval`.
- State Workflow report: run `run_state_workflow_f10_report_4`, workflow `agent-run/run_state_workflow_f10_report_4`, job `job_001`, call `call_report_state_workflow_f10_report`, ledger `report-job-e56c10109fe2841d3ab9d736`.
- State Workflow approval: run `run_state_workflow_pending_approval_4`, workflow `agent-run/run_state_workflow_pending_approval_4`, approval `approval_91c8e0d30713dff2f9409061a52eb35e628eb67cc247ebc1ffad7fd57bf9624a`, call `call_send_state_workflow_pending_approval`.
- Every listed run/job/call/ledger/approval/workflow identity matched before and after restart.
- Each report had exactly one `job.completed` event. Each approval had exactly one completed send call and one send record.
- Target container identity was preserved, target `StartedAt` changed, target returned healthy, and all peer container IDs/start times remained unchanged and healthy.

Evidence: [restart result](../final-runtime-evidence/restart.json), [restart command ledger](../final-runtime-evidence/restart-commands.json), [concise restart assertions](F3-system-qa/15-restart-summary.json), [adversarial 52-test receipt](../final-adversarial/injections.json), and [restart cleanup](../final-runtime-evidence/cleanup.json).

## Parity and replay corroboration

- `corepack pnpm test:parity`: 2 files and 7 tests passed; all **11/11** F01/P01-F10/P11 PostgreSQL projection comparisons had `traceMatch=true` and `outcomeMatch=true`.
- `corepack pnpm test:temporal-replay`: 4 files and **10/10** tests passed; `externalActivitiesDuringReplay=0` and `postCommitRetryCanonicalEffects=1`.
- The replay log's injected post-commit timeout is the expected adversarial retry stimulus; the suite and canonical-effect assertion passed.

Evidence: [parity log](F3-system-qa/13-parity.log), [parity JSON](../final-runtime-evidence/parity.json), [replay log](F3-system-qa/14-temporal-replay.log), and [replay JSON](../final-runtime-evidence/temporal-replay.json).

## Final cleanup

- Final `docker compose down --volumes --remove-orphans` exited 0.
- Remaining Compose containers: 0.
- Remaining project-labelled volumes: 0.
- Remaining project-labelled networks: 0.
- Listeners on documented Compose ports 3000, 4173, and 7233: 0.
- Listeners on browser fixture ports 4310 and 4311: 0.
- No browser session or temporary server remained.

Evidence: [final teardown](F3-system-qa/24-final-down.log), [cleanup receipt](F3-system-qa/25-final-cleanup-receipt.json), and [timeline](F3-system-qa/27-timeline.json).

## Non-blocking observation

The State Workflow service log contains Temporal's advisory that Node does not automatically size its heap to the container's 256 MiB memory limit. The worker remained healthy and every required recovery and acceptance cell passed; this warning did not produce a gate failure.

**VERDICT: APPROVE**

---

## Current-source rerun final decision

The appended current-source evidence above supersedes the historical decision for release gating. Every F3 requirement passed with no blocked or unrun required cell, and the retained Task 16 browser artifacts are fresh for F1 inspection.

VERDICT: APPROVE

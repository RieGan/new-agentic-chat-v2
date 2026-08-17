# Issues — agentic-chat-mvp-vercel-ai-sdk

Problems and gotchas encountered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-16 - Task 01 workspace scaffold

- Context7 lookup was unavailable because the configured monthly quota was exceeded. Current package metadata was verified from the npm registry, AI SDK 7 status from `ai-sdk.dev`, and Vite 8/Rolldown/Node requirements from `vite.dev` instead. This did not block implementation.

## 2026-08-16 - Task 01 verification correction

- Verification identified four frontend inspection dependencies that exceeded the minimal scaffold scope. They and their Vite/runtime integrations were removed; regenerated lockfile and full Task 1 validation are clean.

## 2026-08-16 - Task 03 PostgreSQL persistence

- `codegraph_explore` timed out and Context7 remained quota-exhausted. Targeted source reads and current official Drizzle transaction/migration documentation were used as the prescribed fallback.
- The first Testcontainers dependency attempt triggered pnpm's ignored-native-build supply-chain gate. The dependency was removed; tests now use UUID-named Docker CLI containers, ephemeral ports, TCP health checks, and explicit volume cleanup.
- A manual compiled seed initially exposed runtime imports from source-only contract exports. Converting DB enum declarations to contract-typed literal tuples removed that packaging coupling; the rebuilt seed then ran successfully.

## 2026-08-16 - Task 05 durable application services

- `codegraph_explore` timed out twice; targeted reads and the completed repository explorer result were used as the required fallback.
- Two LSP requests timed out during active index refresh. Re-running diagnostics after formatting returned no findings on all Task 5 TypeScript files.
- Full-workspace Biome remains red only on concurrent Task 4's `infra/tests/compose-topology.mjs`. Task 5-owned files pass Biome; the out-of-scope Compose test was not modified.

## 2026-08-16 - Task 05 catch-up privacy correction

- Verification found that the original context-free catch-up method returned model-only events. Viewer-aware filtering and inspected-sequence cursor tests now close that leakage seam.
- Task 4 formatting was corrected independently; full workspace Biome now passes.

## 2026-08-16 - Task 04 health-gated Compose

- `codegraph_explore` timed out and Context7 remained quota-exhausted. The required source was read directly, and current official Docker Compose startup-order and Temporal local-development documentation were used instead.
- Initial validation exposed pnpm's expected ignored-build policy and a Temporal 1.5.1 flag mismatch; both were corrected in Docker/runtime configuration without editing package manifests or application code.

## 2026-08-16 - Task 06 AI SDK provider boundary

- `codegraph_explore` timed out and Context7 remained quota-exhausted. Current official `ai-sdk.dev` documentation and installed AI SDK 7/OpenAI provider source were used as the required fallback.
- Direct import of the built runtime root in a Node probe traversed source-exported DB modules and failed `.js` to `.ts` resolution. Importing the focused built provider entry with the existing workspace source loader exercised the compiled deliverable successfully without adding files or dependencies.

## 2026-08-16 - Task 07 synchronous fixture tools

- `codegraph_explore` timed out on the required initial contract/seed query, so the prescribed targeted source-read fallback was used.
- The `rtk lint` alias resolved to an unavailable ESLint command even though this workspace uses Biome. The canonical `./node_modules/.bin/biome check .` gate passed with no findings.
- Node's compiled manual probe required `--experimental-transform-types` plus the repository-local source-workspace resolver because workspace package exports point at TypeScript source with `.js` specifiers. The compiled tools artifact itself built successfully, and the support loader is retained under tool tests.

## 2026-08-16 - Task 07 package-boundary correction

- Verification correctly identified that the initial root wildcard export made the nominal approval capability issuer publicly mintable. Explicit root exports and an internal subpath close that boundary defect.
- `codegraph_explore` again timed out on the required initial blast-radius query; targeted current-source reads and workspace reference search were used as the prescribed fallback.
- Package export-map changes do not alter dependency resolution data in `pnpm-lock.yaml`; the existing lockfile remains current.

## 2026-08-16 - Task 08 exact approvals and hidden Admin commands

- The required initial `codegraph_explore` request timed out. Targeted package reads and three parallel repository explorers were used as the prescribed fallback.
- Per-file TypeScript LSP refreshes intermittently timed out after formatting, while package-directory diagnostics completed with zero errors across DB/runtime source and tests; strict workspace `tsc --noEmit` also passed.
- Node cannot strip TypeScript directly beneath `node_modules`, so the no-excuse audit was rerun with Bun and passed all 18 changed TypeScript files.

## 2026-08-17 - Task 09 durable report jobs

- The required CodeGraph exploration timed out and Context7 remained quota-exhausted. Targeted source reads, three repository explorers, official BullMQ job-ID/idempotency/retry/worker documentation, and installed BullMQ type/source inspection were used as fallbacks.
- The first BullMQ integration run exhausted V8 memory because BullMQ 6 repeatedly reported its missing optional `ioredis` backend. A focused 512 MB reproduction exposed the repeated error; adding the required direct peer made the same real Redis test pass in under four seconds.
- Three per-file runtime LSP refreshes timed out twice after formatting. Runtime directory diagnostics reported zero errors across 33 TypeScript files, and strict package/workspace `tsc --noEmit` passed.

## 2026-08-17 - Task 10 bounded Simple Loop

- The required CodeGraph query timed out and Context7 remained quota-exhausted; two completed repository maps, installed AI SDK 7 source/docs, and targeted current-source reads provided the prescribed fallback.
- Several per-file LSP refreshes timed out after formatting. Directory diagnostics reported zero errors across runtime source/tests and testkit E2E plus zero DB errors; the only DB directory diagnostic was a pre-existing deprecation hint in `admission.ts`. Strict workspace typecheck and build passed.

## 2026-08-17 - Task 11 durable Simple Loop waits and recovery

- The required CodeGraph request timed out. Three completed repository maps and targeted source reads supplied the fallback; the usage-limited jobs/restart child was cancelled and no replacement was spawned.
- `runtime.ts` was split before resume work into session, durable-wait, wait-resolution, Admin-guidance, failure, and worker modules. It remains below the production ceiling at 244 pure LOC; `admission.ts`, `admin-commands.ts`, and the provider adapter are also in the 200-250 warning band and require a split before future growth.

## 2026-08-17 - Task 12 deterministic Temporal foundation

- CodeGraph timed out and Context7 was quota-exhausted. Current official Temporal TypeScript docs, npm metadata, and installed SDK `1.22.0` types supplied the required workflow, client, worker, testing, and replay API contracts.
- One per-file LSP refresh timed out after formatting; state-workflow source, replay-test, and worker directory diagnostics all completed with zero errors, and recursive strict typecheck passed.
- DoneClaim: Task 12 passed replay 10/10, forbidden-import, invalid-signal, illegal-transition, real Activity retry/idempotency, workspace lint/typecheck/build, no-excuse, pure-LOC, and LSP gates; evidence is in `artifacts/validation/t12/`.

## 2026-08-17 - Task 13 State Workflow synchronous Activities

- CodeGraph timed out on the required initial architecture query. The prescribed direct source, installed SDK types, and existing verified test fallback was used without Context7 because no Temporal API remained unresolved.
- Per-file LSP refreshes intermittently timed out after formatting; runtime and testkit directory diagnostics completed with zero errors, changed DB files reported zero diagnostics, and recursive strict typecheck passed.
- DoneClaim: Task 13 passed real Temporal F01-F05 E2E 5/5, normalized parity 6/6, Activity post-commit retry, synchronous failure/limit coverage 5/5, Simple Loop regression 9/9, replay 10/10, integration 51/51, lint/typecheck/build, no-excuse, pure-LOC, and LSP gates; evidence is in `artifacts/validation/t13/`.

## 2026-08-17 - Task 14 State Workflow durable waits and recovery

- CodeGraph timed out on the required initial architecture query. The prescribed direct source, installed Temporal SDK types, existing Simple Loop wait implementation, and verified restart harness supplied the fallback without child delegation.
- DoneClaim: Task 14 passed real Temporal F06-F10 E2E 5/5, worker restart 1/1, durable runtime recovery 4/4, State Workflow integration 6/6, replay 10/10, normalized parity 6/6, runtime integration 56/56, workspace lint/typecheck/build, no-excuse 26/26, pure-LOC, and LSP directory gates.

## 2026-08-17 - Task 15 fixed-actor tRPC and tracked SSE

- The required CodeGraph architecture query timed out and Context7 remained quota-exhausted. Direct source inspection, current official tRPC 11 subscription/procedure/middleware/validator/standalone-adapter documentation, and installed 11.18.0 package types supplied the prescribed fallback.
- DoneClaim: Task 15 passed the exact integration command with 72/72 tests, including 16/16 API boundary/SSE tests, plus contracts 75/75, DB 18/18, real HTTP/SSE, malformed input, stale cursor refetch, registration/reconnect races, Admin-as-User denial, privacy, exact procedure and forbidden-import checks, workspace lint/typecheck/build, no-excuse 27/27, pure-LOC, and LSP gates; evidence is in `artifacts/validation/t15/`.

## 2026-08-17 - Task 16 accessible User and Admin routes

- CodeGraph resolved to a broader workspace instead of this project and Context7 remained quota-exhausted. Direct current-source reads, installed tRPC 11 client source/docs, and Task 15 HTTP/SSE integration tests supplied the prescribed fallback.
- The Playwright MCP expected a system Chrome installation that is unavailable. Project Playwright Chromium executed all interactions, console checks, screenshots, and traces; BrowserMCP independently confirmed the rendered accessibility tree for `/user/chat`.
- DoneClaim: Task 16 passed User/Admin route behavior, both runtimes through direct and async flows, exact approve/reject, hidden command, stale-cursor recovery, duplicate suppression, keyboard/focus, User DOM privacy, atomic completed-message rendering, responsive desktop/mobile, useful not-found routing, zero browser console errors, final Playwright 6/6 with 6 traces and 16 screenshots, workspace lint 242/242, recursive typecheck 8/8, build, no-excuse 21/21, pure-LOC, and LSP gates; evidence is in `artifacts/validation/t16/`.

## 2026-08-17 - Task 16 independent Visual QA corrections

- The failing-first barrier run reproduced all five reviewer findings: 5 failed and 1 unrelated scenario passed. The exact failures were missing resolved approval DOM, missed empty-list discovery, observed stale rapid-selection projection, observed stale hidden-command projection, and inherited approval route-header spacing.
- Individual testkit LSP refreshes intermittently timed out after formatting; the testkit E2E directory scan completed across 11 TypeScript files with zero diagnostics, and recursive strict typecheck passed all 8 configured projects.
- DoneClaim: Task 16 Visual QA corrections passed the final combined Playwright run 10/10 with one worker, 10 fresh traces, 22 fresh PNGs, five required visual surfaces independently inspected as PASS, zero console/page errors, empty-initial eligible-run discovery, stale-selection and hidden-command barriers, retained approval focus under decision/SSE race, desktop sticky/mobile static topbar, compact approval headers, privacy/reconnect/not-found regressions, workspace lint 243/243, recursive typecheck 8/8, build, no-excuse 10/10, pure-LOC, and zero LSP directory diagnostics; ports 4310 and 4311 were closed after execution and evidence is in `artifacts/validation/t16/`.

## 2026-08-17 - Task 17 dual-runtime acceptance harness

- CodeGraph targeted the broader workspace instead of this project. The prescribed fallback used the full validation plan, direct current-source reads, ast-grep structural discovery, and three repository explorers.
- The first exact runtime attempt exposed that `ui-races.spec.ts` was unintentionally included in the broad runtime Playwright project without a base URL. Runtime invocation now narrows to F01-F10 tests; UI project behavior remains unchanged.

## 2026-08-17 - Task 18 isolated restart and comparison

- Baseline `test:restart` reported success with one passed and one skipped test because no explicit `TEST_RUNTIME=state_workflow` was supplied. The replacement runner asserts three passes and zero skipped scenarios per runtime.
- The restart runner initially exceeded the 250 pure-LOC review ceiling. Compose lifecycle/identity capture and adversarial suite declarations were split into focused modules before final verification.
- Broad ast-grep correctly finds database imports in State Workflow Activity adapters; the reachable workflow dependency graph test remains the authoritative forbidden-I/O proof and passed as part of Temporal replay.
- DoneClaim: Task 18 passed targeted Compose restart for both workers, six deterministic recovery scenarios, 11/11 schema-v2 parity pairs, Temporal replay 10/10, adversarial database/runtime/API suites, workspace lint/typecheck/build, no-excuse, pure-LOC, LSP directory diagnostics, and cleanup receipts.

## 2026-08-17 - F2 code quality and security-boundary review

- VERDICT: REJECT. A no-credential live HTTP probe proved that selecting `/trpc/admin/*` creates `mvp_admin` context and permits Admin mutations; URL routing is currently the entire actor provenance boundary.
- `simple_loop.execute` dispatch intents are never marked dispatched by `compose-worker.ts`. Every terminal run remains in the pending scan and is retried/logged every 100 ms indefinitely, with durable amplification across restarts.
- Additional medium findings: incomplete `NODE_ENV=test` gating for Task 18 deterministic runtime workers, dropped provider abort propagation, a crash gap between simulated-send reservation/effect/completion, and one stale tools package-boundary test (27/28 passed).
- Required `corepack pnpm lint && corepack pnpm typecheck` passed; report and detailed evidence are in `artifacts/validation/final/F2-quality-security.md`.

## 2026-08-17 - F1 plan compliance audit

- Blocking evidence-retention finding: `artifacts/validation/t16/verification.md` claims 10 retained Playwright traces and 22 PNG captures under `artifacts/validation/t16/playwright/`, but the current directory contains only `.last-run.json`; the plan-designated `t16/ui-happy/` and `t16/ui-adversarial/` evidence roots are also absent. F1 therefore cannot independently substantiate Task 16's generated visual/browser evidence and returns REJECT despite all other audited requirements and exact contract/DB gates passing.

## 2026-08-17 - F4 scope fidelity and parity review

- REJECT: the current 22 PostgreSQL-derived schema-v2 records have valid recomputed observation digests and independently match across all 11 runtime pairs, but Task 18's comparator normalizes every `*Id`/`*Hash` string, including semantic `skillId`, and its outcome projection omits tool argument/result/error, selected-skill, approval-actor, and job-result semantics. The generated parity PASS is therefore not fail-closed against all F4-required differences. Full evidence: `artifacts/validation/final/F4-scope-parity.md`.
- Secondary evidence limitation: `task18-parity.mjs` reads existing restart/replay PASS JSON into the comparison report without freshness or common-run provenance checks. Its labels are correct, but the comparison report alone is not an atomic three-gate execution receipt.
- CORRECTED / APPROVE: suffix normalization was replaced by exact event/tool identity paths; approval hashes normalize only after recomputation from the captured send arguments; full skill/tool/approval/job/final semantics now participate. The failing-first suite exposed 7 false accepts, then 18 independent mutation barriers and all current 11 pairs passed under the corrected gate. Root F4 parity regenerated 25/25 green evidence. The original rejection remains preserved in `artifacts/validation/final/F4-scope-parity.md`.

## 2026-08-17 - F2 remediation and fresh review

- QS-02 now uses exact transactional Simple Loop intent acknowledgement after durable execution boundaries; terminal redelivery is idempotent and transient execution failure remains pending.
- The first real Compose rerun exposed premature report resume dispatch at 50% progress. A failing-first PostgreSQL test reproduced it, dispatch creation moved to canonical report completion, and the dual-runtime restart harness then passed with clean teardown.
- QS-03, QS-04, and QS-06 are resolved through the dual test-mode worker gate, provider abort propagation, and strict conditional-export boundary test respectively.
- QS-01 was reclassified against the frozen blueprint's explicit route-selected fixed actors and no-auth scope. QS-05 remains a non-blocking at-most-once fixture availability risk.
- Fresh F2 verdict: APPROVE. The original REJECT remains preserved in `artifacts/validation/final/F2-quality-security.md`.

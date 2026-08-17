# Docker Compose Remediation and Regression Tracker

## Purpose and status rules

This document is the source of truth for repairing the Docker Compose path and proving that the completed Agentic Chat MVP still meets the acceptance contract in `.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`.

All work starts unchecked. An implementation agent may check a task only after its focused verification passes and evidence is recorded. A command that has not run is `NOT RUN`, never `PASS`. A blocked command is `BLOCKED` with the missing dependency recorded. Mandatory result values are `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN`.

## Scope

### In scope

- Keep local deterministic Compose as the mandatory release gate.
- Prevent local environment files and secrets from entering the Docker build context or image.
- Route browser tRPC traffic through the Vite container to the real API container.
- Run the real tRPC application server in the API container and make health checks prove application readiness.
- Make both model workers honor the validated provider environment.
- Keep the Temporal worker within the 256 MB Compose memory limit.
- Add BrowserMCP coverage through Browser to Vite container to API container to PostgreSQL and workers.
- Rerun every mandatory gate from the completed MVP plan after all fixes land.

### Out of scope

- Production deployment, authentication, real email, new product features, and provider output quality comparisons.
- Making live-provider output a release gate.
- Combining unrelated fixes in one commit.

## Security rules

- [x] `.env`, `.env.local`, and any environment-specific secret file are excluded from the Docker build context.
- [x] `.env.local` and secret values are never copied into an image layer, build output, container log, test artifact, screenshot, trace, or command transcript.
- [ ] `.env.local` and secret values are never copied into a source commit.
- [x] Tests use sentinel names or hashes when checking redaction. They never print a real secret.
- [ ] Live-provider credentials enter containers only through the explicit optional override at runtime.
- [ ] `docker compose config` evidence is redacted or limited to structural assertions. Never retain interpolated secret values.
- [ ] Logs and typed startup errors may name a missing variable, but must not include its value.
- [ ] Before each commit, inspect the staged file list and patch for `.env`, `.env.local`, `OPENAI_API_KEY`, bearer tokens, and secret values. Do not record the inspection output if it would reveal a value.

## Current failing reproduction

Run from the repository root. These steps reproduce the current false-health and routing state. They are observations, not completion evidence.

```sh
docker compose down --volumes --remove-orphans
docker compose config --quiet
docker compose up --build --wait
docker compose ps
curl --fail-with-body --show-error http://127.0.0.1:3000/healthz/
curl --fail-with-body --show-error http://127.0.0.1:4173/trpc/user/catalog.skills
docker compose logs api web worker-simple worker-workflow
```

Current observations:

- Compose reports the API healthy because BusyBox serves static JSON with `scope: infrastructure_scaffold`.
- The API process is not `createApiHttpServer`; tRPC requests cannot reach the application router.
- Vite defaults `/trpc` to `http://127.0.0.1:3000`, which points back to the web container instead of `api:3000`.
- Both model workers call `createComposeDeterministicProvider()` directly, regardless of `AI_PROVIDER_MODE`.
- The Temporal worker starts Node without a heap cap despite a 256 MB container limit.
- Playwright starts `ui-fixture-server.ts`, so current UI success does not prove the real Compose path.

After remediation, the first `curl` must return application-owned readiness and the second must return a tRPC response from the API container. A static scaffold payload, connection refusal, proxy error, or HTML fallback is `FAIL`.

## Confirmed issue register

| ID | Severity | Status | Observable evidence | Root cause |
| --- | --- | --- | --- | --- |
| CMP-SEC-01 | Critical | [x] Closed | `.dockerignore` excludes `.env` and `.env.*`, retains `!.env.example`, and the fresh image contains only the example file. | The build context now denies local environment files before `COPY . .`. |
| CMP-ROUTE-02 | High | [x] Closed | Compose web resolves `VITE_API_TARGET` to `http://api:3000`; the host-local Vite fallback remains `http://127.0.0.1:3000`. | Container loopback is process-local. The web container now uses Docker DNS `http://api:3000`. |
| CMP-API-03 | Critical | [x] Closed | The rebuilt API runs compiled `compose-main.js` as PID 1; `GET /healthz` reports database-aware application readiness, fixed-User `skills.get` responds through tRPC, unknown routes remain 404, and SIGTERM exits 0 within the five-second grace period. | The API Compose command never started `createApiHttpServer` or bound application services to PostgreSQL. |
| CMP-PROVIDER-04 | High | [x] Closed | Both model workers parse provider environment before entering their run loop and select through `createComposeProvider()`; the fixture worker remains provider-independent. | Worker startup now selects the Task 18 deterministic provider for parsed mock mode and the OpenAI Responses adapter for parsed live mode. |
| CMP-MEM-05 | High | [x] Closed | Workers run with a 128 MB V8 old-space cap under a 256 MiB hard limit, with no cgroup reservation; all workers stay healthy without OOM events and fresh logs contain no Temporal unsafe-memory warning. | Temporal SDK 1.22 selects `memory.low`/`memory.min` before `memory.max`; the former 64 MiB reservation made its 75% recommendation 48 MiB even though the hard limit was 256 MiB. |
| CMP-E2E-06 | Critical | [ ] Open | `playwright.config.ts` starts `packages/testkit/e2e/ui-fixture-server.ts`; UI suites do not traverse Compose services. | Browser tests replace the Vite, API, database, and worker path with fixture services. |

## Atomic remediation tasks

### [x] T01: Exclude local environment files from Docker builds

**Issue:** CMP-SEC-01  
**Fix files:** `.dockerignore`, `infra/tests/compose-build-context.mjs`  
**Commit:** `fix(container): exclude local environment files`

Tasks:

- [x] Add `.env`, `.env.local`, and environment-specific variants to `.dockerignore` while retaining `.env.example`.
- [x] Add a focused test that parses `.dockerignore` and proves `.env` plus `.env.local` are excluded.
- [x] Build with the existing local environment boundary, inspect the resulting image filesystem, then remove the disposable image without printing any value.
- [x] Confirm no secret-bearing file or value appears in build logs or image history.

Focused verification:

```sh
node infra/tests/compose-build-context.mjs
docker build --no-cache --tag agentic-chat-secret-boundary:test --file infra/docker/Dockerfile .
docker run --rm --entrypoint sh agentic-chat-secret-boundary:test -c 'test ! -e /workspace/.env && test ! -e /workspace/.env.local && test -e /workspace/.env.example'
docker history --no-trunc agentic-chat-secret-boundary:test
docker image rm agentic-chat-secret-boundary:test
```

**PASS:** the test exits 0, neither environment file exists in the container, `.env.example` remains available as documentation, and image history contains no sentinel value. Record only a redacted history review result.

### [x] T02: Route Vite tRPC traffic to the API service

**Issue:** CMP-ROUTE-02  
**Fix files:** `compose.yaml`, `infra/tests/compose-topology.mjs`  
**Commit:** `fix(web): route compose trpc traffic to api`

Tasks:

- [x] Set the web service `VITE_API_TARGET` to `http://api:3000` in base Compose.
- [x] Extend the topology test to require Docker DNS and reject a loopback API target for the web service.
- [x] Keep host development fallback behavior in `apps/web/vite.config.ts` unchanged.

Focused verification:

```sh
docker compose config --quiet
node infra/tests/compose-topology.mjs
docker compose up --build --wait web api
docker compose exec web wget --server-response --output-document=- http://api:3000/healthz
curl --fail-with-body --show-error --get --data-urlencode 'input={"skillId":"calculator_assistant","version":"1"}' http://127.0.0.1:4173/trpc/user/skills.get
```

**PASS:** the resolved web target is `http://api:3000`; the web container reaches API readiness by service name; the browser-facing `/trpc` request returns a tRPC response with no connection refusal, `502`, or Vite HTML fallback.

### [x] T03: Start the real tRPC API and application health check

**Issue:** CMP-API-03  
**Fix files:** `apps/api/package.json`, `apps/api/src/application.ts`, `apps/api/src/server.ts`, `apps/api/src/compose-main.ts`, `apps/api/src/index.ts`, `apps/api/tests/compose-server.integration.test.ts`, `apps/api/tests/trpc-sse-http.integration.test.ts`, `apps/api/tests/trpc-sse-support.ts`, `packages/runtime/package.json`, `infra/docker/Dockerfile`, `infra/docker/service-entrypoint.sh`, `compose.yaml`, `infra/tests/compose-api-boot.mjs`
**Commit:** `fix(api): run real trpc server in compose`

Tasks:

- [x] Add an application entrypoint that validates environment, creates database-backed services and event source, starts `createApiHttpServer`, and handles shutdown.
- [x] Add application-owned `/healthz` readiness that checks the API process and its required PostgreSQL dependency.
- [x] Build `@agentic-chat/api` into the shared image.
- [x] Replace BusyBox API startup with the compiled API entrypoint.
- [x] Point the Compose API health check at the application-owned endpoint.
- [x] Add focused tests proving a tRPC request reaches the real router and a broken database dependency makes readiness fail.

Focused verification:

```sh
pnpm --filter @agentic-chat/api build
pnpm --filter @agentic-chat/api test:integration
node infra/tests/compose-api-boot.mjs
docker compose up --build --wait postgres migration api
curl --fail-with-body --show-error http://127.0.0.1:3000/healthz
curl --fail-with-body --show-error --get --data-urlencode 'input={"skillId":"calculator_assistant","version":"1"}' http://127.0.0.1:3000/trpc/user/skills.get
docker compose exec api sh -c "tr '\\000' ' ' < /proc/1/cmdline"
```

**PASS:** PID 1 is the compiled Node API, readiness is application-owned and database-aware, a real tRPC procedure returns a typed response, and no payload contains `scaffold_ready` or `infrastructure_scaffold`.

### [x] T04: Honor provider selection in Compose workers

**Issue:** CMP-PROVIDER-04  
**Fix files:** `packages/runtime/src/compose-worker.ts`, `packages/runtime/src/provider/factory.ts`, `packages/runtime/tests/compose-provider-selection.test.ts`, `compose.yaml`, `compose.live.yaml`, `.env.example`, `infra/tests/compose-provider-mode.mjs`  
**Commit:** `fix(runtime): honor compose provider configuration`

Tasks:

- [x] Create one provider factory from validated `parseEnvironment()` output.
- [x] Use the factory in both `worker-simple` and `worker-workflow`.
- [x] Keep `fixture-worker` independent of model-provider credentials.
- [x] Keep base `compose.yaml` fixed to `AI_PROVIDER_MODE=mock` with no live credentials.
- [x] Add an explicit optional `compose.live.yaml` override for both model workers only.
- [x] Fail closed with a redacted typed startup error when live mode is incomplete.
- [x] Test mock selection, live adapter selection, invalid configuration, and secret redaction.

Focused verification:

```sh
pnpm --filter @agentic-chat/runtime test:integration -- provider-mock provider-errors
pnpm --filter @agentic-chat/runtime exec vitest run tests/compose-provider-selection.test.ts
node infra/tests/compose-provider-mode.mjs
docker compose config --quiet
docker compose -f compose.yaml -f compose.live.yaml --env-file .env.local config --quiet
```

**PASS:** base Compose resolves both model workers to mock mode with no key; the optional override resolves both to `openai_responses`; missing live values stop startup with variable names only; the fixture worker receives no OpenAI values. A live model response is non-gating.

### [x] T05: Cap Node heap for Compose workers

**Issue:** CMP-MEM-05  
**Fix files:** `compose.yaml`, `infra/docker/service-entrypoint.sh`, `infra/tests/compose-topology.mjs`, `infra/tests/compose-worker-boot.mjs`
**Commit:** `fix(worker): cap node heap for compose workers`

Tasks:

- [x] Start every worker role with `node --max-old-space-size=128` while preserving production conditions and source maps.
- [x] Remove only the worker `memory` reservation while retaining the `256M` hard limit and CPU setting.
- [x] Extend the topology and worker boot tests to require the hard limit, reject reservations and the obsolete 48 MB flag, and require the exact 128 MB worker command.
- [x] Confirm the workflow worker no longer prints the unsafe heap warning under the 256 MB limit.

Focused verification:

```sh
node infra/tests/compose-worker-boot.mjs
node infra/tests/compose-topology.mjs
docker compose up --build --wait worker-simple worker-workflow fixture-worker
docker compose exec worker-workflow node -e 'const v8=require("node:v8"); console.log(Math.round(v8.getHeapStatistics().heap_size_limit/1024/1024))'
docker compose logs worker-workflow
```

**PASS:** the boot and topology tests exit 0; the worker Node child includes exactly `--max-old-space-size=128`; cgroup `memory.low` and `memory.min` are zero while `memory.max` remains 268435456; the reported V8 heap limit is 131 MiB; all workers stay healthy through two startups and both runtime restart scenarios; OOM events remain zero; and fresh worker logs contain no unsafe-memory warning or V8 fatal marker.

### [ ] T06: Add real-Compose BrowserMCP coverage

**Issue:** CMP-E2E-06  
**Fix files:** `playwright.compose.config.ts`, `packages/testkit/e2e/compose-user-admin.spec.ts`, `packages/testkit/e2e/compose-browser-support.ts`, `packages/testkit/scripts/run-compose-browser.mjs`, `packages/testkit/package.json`, `package.json`  
**Commit:** `test(compose): cover real browser application flows`

Tasks:

- [ ] Add a separate Compose browser configuration that never starts `ui-fixture-server.ts`.
- [ ] Point the browser only at `http://127.0.0.1:4173`.
- [ ] Seed or namespace deterministic state through supported application/testkit boundaries.
- [ ] Parameterize User chat and Admin flows for `simple_loop` and `state_workflow`.
- [ ] Capture screenshots, traces, browser console, service logs, run IDs, and database evidence under `artifacts/validation/compose-browser/`.
- [ ] Fail if BrowserMCP observes a failed request, console error, hidden User content, duplicate final message, or fixture-server process.

Focused verification:

```sh
docker compose down --volumes --remove-orphans
docker compose up --build --wait
pnpm test:compose-browser --runtime=simple_loop
pnpm test:compose-browser --runtime=state_workflow
docker compose ps
```

**PASS:** both runtime commands exit 0; all browser actions traverse port 4173; API and worker logs contain the matching run IDs; PostgreSQL contains the canonical records; no fixture UI service was started.

## Compose provider rules

### Deterministic base Compose

- [x] `docker compose up --build --wait` uses `AI_PROVIDER_MODE=mock` for both model workers.
- [x] Base Compose contains no `OPENAI_API_KEY`, `OPENAI_BASE_URL`, or `OPENAI_MODEL_ID` interpolation.
- [x] All mandatory contracts, F01 to F10, restart, parity, UI, and privacy gates run against the deterministic provider.
- [x] A missing `.env.local` cannot block base Compose.
- [x] The fixture worker never receives model credentials.

### Optional live-provider override

- [x] Live mode requires `docker compose -f compose.yaml -f compose.live.yaml --env-file .env.local up --build --wait`.
- [x] The override sets `AI_PROVIDER_MODE=openai_responses` plus all three validated OpenAI variables for both model workers.
- [x] The override does not change database, routing, health, memory, runtime ownership, or approval policy.
- [x] Startup fails closed if any required live variable is missing or malformed.
- [x] Provider values are redacted from logs and retained artifacts.
- [x] Live smoke results are recorded separately and cannot replace or fail the deterministic release gate.

## Real-Compose BrowserMCP matrix

Before each row, run:

```sh
docker compose down --volumes --remove-orphans
docker compose up --build --wait
docker compose ps
```

Use BrowserMCP to navigate to `http://127.0.0.1:4173`. Capture a snapshot before and after each action, inspect browser console output, and correlate the visible run ID with API, worker, and PostgreSQL evidence.

| ID | Runtime | BrowserMCP route and actions | Required backend path | PASS criteria | Status |
| --- | --- | --- | --- | --- | --- |
| B01 | `simple_loop` | Open `/user/chat`, select Simple Loop, send P01, wait for completion. | Browser to Vite to API to PostgreSQL to `worker-simple`. | `CHAT_OK` appears once after `message.completed`; no tool call, partial text, failed request, or console error. | [ ] NOT RUN |
| B02 | `state_workflow` | Open `/user/chat`, select State Workflow, send P01, wait for completion. | Browser to Vite to API to PostgreSQL to Temporal and `worker-workflow`. | `CHAT_OK` appears once; legal workflow completes; no Simple worker claim, failed request, or console error. | [ ] NOT RUN |
| B03 | `simple_loop` | Send P08 in User view, open `/admin/approvals`, approve the exact call, return to User view. | Vite to API to PostgreSQL to `worker-simple`, approval service, simulated send. | Pending approval is Admin-only; exact call executes once after approval; User sees one final sent result. | [ ] NOT RUN |
| B04 | `state_workflow` | Send P09 in User view, open `/admin/approvals`, reject with `MVP rejection test`, return to User view. | Vite to API to PostgreSQL to Temporal signal and `worker-workflow`. | Rejection binds to the call; zero sends; same workflow resumes and User sees one not-sent result. | [ ] NOT RUN |
| B05 | `simple_loop` | Open `/admin`, target a seeded active run, submit P10 command, open User view and send `Respond now.` | Vite to Admin API to PostgreSQL to `worker-simple`, then User API. | Admin sees accepted and applied; User sees only `ADMIN_GUIDANCE_OK`; raw command is absent from User DOM and stream. | [ ] NOT RUN |
| B06 | `state_workflow` | Repeat B05 for a State Workflow run. | Vite to Admin API to PostgreSQL to Temporal and `worker-workflow`, then User API. | Same shared result and privacy boundary; command applies once at a safe boundary. | [ ] NOT RUN |
| B07 | Both | Start P07, force SSE disconnect and reconnect while progress changes. | Browser reconnect to Vite proxy to tracked API SSE and canonical PostgreSQL state. | Canonical state refetches; 50 percent and completion are observable; no message, event, job, or decision duplicates. | [ ] NOT RUN |
| B08 | Both | Try keyboard operation, malformed input, duplicate submit, unauthorized User access to Admin behavior, and viewport resize. | Same real Compose path. | Controls remain operable; invalid or unauthorized actions fail closed; no hidden content, duplicate side effect, or stuck state. | [ ] NOT RUN |

BrowserMCP evidence commands after each row:

```sh
docker compose logs --since 10m web api worker-simple worker-workflow fixture-worker
docker compose exec postgres psql -U agentic_chat -d agentic_chat -c 'select id, runtime, status from runs order by created_at desc limit 10;'
docker compose ps
```

Do not place secret values in browser fields, screenshots, traces, SQL output, or service logs.

## Full previous-plan regression matrix

Run this matrix from a clean checkout state after T01 to T06 are individually verified. Store command output under `artifacts/validation/compose-remediation/` using one directory per row.

| Gate | Command | PASS criteria | Status |
| --- | --- | --- | --- |
| Clean install | `corepack pnpm install --frozen-lockfile` | Exit 0 with the locked dependency graph unchanged. | [ ] NOT RUN |
| Lint | `pnpm lint` | Exit 0 with no Biome error. | [ ] NOT RUN |
| Typecheck | `pnpm typecheck` | Exit 0 for every workspace package. | [ ] NOT RUN |
| Build | `pnpm build` | Exit 0; web, API, contracts, DB, runtime, tools, and testkit build targets complete. | [ ] NOT RUN |
| Compose model | `docker compose config --quiet` | Exit 0; no unresolved variable or invalid service model. | [ ] NOT RUN |
| Clean Compose start | `docker compose down --volumes --remove-orphans && docker compose up --build --wait` | Exit 0; PostgreSQL, Redis, Temporal, migration, web, real API, three workers are ready. | [ ] NOT RUN |
| Contracts | `pnpm test:contracts` | P01 to P11 payloads parse; illegal transitions, malformed arguments, runtime mutation, and visibility mismatch fail with typed errors. | [ ] NOT RUN |
| Database | `pnpm test:db` | Migration and seeds succeed; transaction, uniqueness, idempotency, approval, and race constraints hold. | [ ] NOT RUN |
| Integration | `pnpm test:integration` | Provider, tools, jobs, approvals, Admin commands, admission, projections, tRPC, and SSE suites pass. | [ ] NOT RUN |
| Temporal replay | `pnpm test:temporal-replay` | Legal histories replay with no external I/O; illegal transitions and forbidden imports are detected. | [ ] NOT RUN |
| F01 to F10 Simple Loop | `pnpm test:e2e --runtime=simple_loop` | All ten flows, including separate P05 and P06 records, are `PASS`; no `BLOCKED` or `NOT RUN`. | [ ] NOT RUN |
| F01 to F10 State Workflow | `pnpm test:e2e --runtime=state_workflow` | All ten flows, including separate P05 and P06 records, are `PASS`; no `BLOCKED` or `NOT RUN`. | [ ] NOT RUN |
| Harness negative | `pnpm test:acceptance:harness-negative` | The deliberately altered expected event makes the harness fail its comparison as designed. | [ ] NOT RUN |
| Restart Simple Loop | `pnpm test:restart --runtime=simple_loop` | Stable run, call, job, and approval IDs; one resume; other worker stays healthy and never claims the run. | [ ] NOT RUN |
| Restart State Workflow | `pnpm test:restart --runtime=state_workflow` | Stable workflow, run, call, job, and approval IDs; one resume; other worker stays healthy. | [ ] NOT RUN |
| Parity | `pnpm test:parity` | Normalized shared traces and final outcomes match across runtimes; runtime diagnostics remain separate. | [ ] NOT RUN |
| UI happy | `pnpm test:e2e --project=ui-happy` | Fixture UI suite remains green for direct, async, approval, rejection, and hidden-command paths. | [ ] NOT RUN |
| UI adversarial | `pnpm test:e2e --project=ui-adversarial` | Reconnect, keyboard, race, duplicate suppression, privacy, and atomic-message checks pass. | [ ] NOT RUN |
| Real Compose browser, Simple Loop | `pnpm test:compose-browser --runtime=simple_loop` | User and Admin BrowserMCP rows for Simple Loop pass through real services. | [ ] NOT RUN |
| Real Compose browser, State Workflow | `pnpm test:compose-browser --runtime=state_workflow` | User and Admin BrowserMCP rows for State Workflow pass through real services. | [ ] NOT RUN |
| Health | `docker compose ps && curl --fail-with-body http://127.0.0.1:3000/healthz && curl --fail-with-body http://127.0.0.1:4173/` | Every required service is healthy; API readiness is application-owned; web is reachable. | [ ] NOT RUN |
| Privacy | `pnpm test:integration -- projections trpc-sse && pnpm test:e2e --project=ui-adversarial` | User projections and DOM contain no raw Admin command, Admin decision metadata, provider secret, or `message.delta`. | [ ] NOT RUN |
| Duplicate safety | `pnpm test:integration -- async-job approvals admin-commands` | Duplicate command, event, job completion, signal, approval race, and simulated send produce one logical result. | [ ] NOT RUN |
| Approval behavior | `pnpm test:integration -- approvals admin-commands` | Exact approve executes once; reject, tamper, expiry, wrong run, wrong actor, and race execute zero prohibited sends. | [ ] NOT RUN |
| SSE reconnect | `pnpm test:integration -- trpc-sse && pnpm test:compose-browser --grep reconnect` | Catch-up and live sequencing have no gap or duplicate; canonical state refetch works after cursor invalidation. | [ ] NOT RUN |
| Migration gate | `docker compose -f compose.yaml -f infra/tests/compose-migration-blocked.yaml up --build` | App services remain unready while migration readiness is blocked; no schema error is presented as healthy. | [ ] NOT RUN |
| Base provider mode | `node infra/tests/compose-provider-mode.mjs && docker compose config --quiet` | Both model workers use deterministic mock mode; no live credential enters the model or fixture workers. | [x] PASS |
| Optional live override structure | `docker compose -f compose.yaml -f compose.live.yaml --env-file .env.local config --quiet` | With local credentials present, override validates and affects both model workers only. No values are retained in evidence. | [x] PASS |
| Cleanup | `docker compose down --volumes --remove-orphans` | Containers, networks, and named test volumes for this project are removed; no test process remains. | [ ] NOT RUN |

## F01 to F10 acceptance record

Each cell must link to actor, run ID, call IDs, approval or job events, final response, User projection, Admin projection, normalized event trace, and artifacts.

| Flow | Simple Loop | State Workflow | Mandatory PASS criteria |
| --- | --- | --- | --- |
| F01 Direct chat | [ ] NOT RUN | [ ] NOT RUN | `CHAT_OK` once, no skill or tool, atomic final message, one completed run. |
| F02 Load skill | [ ] NOT RUN | [ ] NOT RUN | Exactly `calculator_assistant@1`, one allowed tool, no tool invocation. |
| F03 Sync success | [ ] NOT RUN | [ ] NOT RUN | One calculator call with exact arguments, result `1040`, final response uses it. |
| F04 Sync failure | [ ] NOT RUN | [ ] NOT RUN | Typed `DIVISION_BY_ZERO`, no invented value, User-visible terminal explanation. |
| F05 Authorization | [ ] NOT RUN | [ ] NOT RUN | P05 and P06 separate; missing skill and disallowed tools create zero prohibited calls or approvals. |
| F06 Async success | [ ] NOT RUN | [ ] NOT RUN | One job and call, 50 percent progress, same-run resume, final `report_001`. |
| F07 HITL approve | [ ] NOT RUN | [ ] NOT RUN | Exact Admin approval, zero sends before approval, one send after, one final response. |
| F08 HITL reject | [ ] NOT RUN | [ ] NOT RUN | Exact Admin rejection, zero sends, same-run resume, clear not-sent result. |
| F09 Admin command | [ ] NOT RUN | [ ] NOT RUN | Authorized command applies once, exact `ADMIN_GUIDANCE_OK`, raw command absent from User projection. |
| F10 Restart resume | [ ] NOT RUN | [ ] NOT RUN | Stable IDs, one job, one tool result, one resume, other runtime worker never claims the run. |

## Evidence ledger

Add rows as commands run. Preserve failures as evidence. Never rewrite a failed result as passing without adding a new dated row.

| Evidence ID | Task or gate | Command | Expected result | Actual result | Artifact path | Status |
| --- | --- | --- | --- | --- | --- | --- |
| E-001 | Baseline | `docker compose up --build --wait` | Real API and all dependencies become ready. | Current stack reports false API health; remediation not run. | `artifacts/validation/compose-remediation/baseline/` | [ ] FAIL |
| E-002 | T01 | `node infra/tests/compose-build-context.mjs` | Environment files are excluded and `.env.example` remains allowed. | Test passed; no environment file contents were loaded or printed. | `artifacts/validation/compose-remediation/T01/` | [x] PASS |
| E-003 | T02 | `node infra/tests/compose-topology.mjs` | Web target is `http://api:3000`; loopback is rejected. | Not run before the T02 assertion was added. | `artifacts/validation/compose-remediation/T02/` | [ ] NOT RUN |
| E-004 | T03 | `node infra/tests/compose-api-boot.mjs` | Entrypoint starts compiled API and real readiness. | 2026-08-17: PASS; the static guard rejects BusyBox/scaffold startup, requires the compiled API build/entrypoint, and requires the canonical GET health probe. | `artifacts/validation/compose-remediation/T03/` | [x] PASS |
| E-005 | T04 | `node infra/tests/compose-provider-mode.mjs` | Base and override provider rules are enforced without exposing values. | 2026-08-18: PASS. Structural assertions proved deterministic mock mode for both model workers, provider-independent fixture configuration, model-worker-only live overrides, removed Task 18 gates in live mode, and provider selection before worker execution. Base and live `config --quiet` checks passed; no resolved provider value was printed or retained. Runtime selection/redaction tests passed 21/21, serial integration passed 59/59, and all three base workers became healthy with role-specific ready events. | `artifacts/validation/compose-remediation/T04/` | [x] PASS |
| E-006 | T05 | `node infra/tests/compose-worker-boot.mjs`; `node infra/tests/compose-topology.mjs` | Every worker uses exactly a 128 MB old-space cap, rejects obsolete 48 MB configuration, has no reservation, and retains a 256 MiB hard limit. | 2026-08-17: PASS. Boot and topology assertions passed; resolved worker limit was 268435456 bytes; worker reservations were absent; the shared command required `--max-old-space-size=128` and rejected `48`. | `artifacts/validation/compose-remediation/T05/` | [x] PASS |
| E-007 | T06 | `pnpm test:compose-browser --runtime=simple_loop` | Real-Compose User and Admin paths pass for Simple Loop. | Not run. | `artifacts/validation/compose-browser/simple_loop/` | [ ] NOT RUN |
| E-008 | T06 | `pnpm test:compose-browser --runtime=state_workflow` | Real-Compose User and Admin paths pass for State Workflow. | Not run. | `artifacts/validation/compose-browser/state_workflow/` | [ ] NOT RUN |
| E-009 | Final | Full previous-plan regression matrix | Every mandatory row is `PASS`. | Not run. | `artifacts/validation/compose-remediation/final/` | [ ] NOT RUN |
| E-010 | T01 | `docker build --no-cache --tag agentic-chat-secret-boundary:test --file infra/docker/Dockerfile .`; `docker run --rm --entrypoint sh agentic-chat-secret-boundary:test -c 'test ! -e /workspace/.env && test ! -e /workspace/.env.local && test -e /workspace/.env.example'`; sanitized image-history scan; `docker image rm agentic-chat-secret-boundary:test` | Fresh image omits `.env` and `.env.local`, retains `.env.example`, contains no secret markers in history, and is removed after inspection. | 2026-08-17: Fresh build passed; existence-only inspection found `/workspace/.env` and `/workspace/.env.local` absent and `/workspace/.env.example` present; sanitized image-history scan found no `.env.local` or `OPENAI_API_KEY` markers; disposable image and temporary build log were removed. No secret value was printed or persisted. | `artifacts/validation/compose-remediation/T01/` | [x] PASS |
| E-011 | T03 | Initial `docker compose up --build --wait postgres migration api` after replacing the scaffold | Rebuilt API becomes healthy through its application-owned probe. | 2026-08-17: FAIL preserved. The compiled API returned ready to `GET /healthz`, but Compose used `wget --spider`, sent `HEAD`, received 404, and marked the container unhealthy. | `artifacts/validation/compose-remediation/T03/` | [ ] FAIL |
| E-012 | T03 | `pnpm --filter @agentic-chat/api build`; `pnpm --filter @agentic-chat/api test:integration`; `node infra/tests/compose-api-boot.mjs`; `docker compose up --wait --force-recreate api`; live health, tRPC, 404, PID 1, and SIGTERM probes | Compiled Node API is healthy, database-aware, routable, fail-closed, and shuts down within five seconds. | 2026-08-17: PASS. Build exited 0; API integration passed 21/21; Compose API became healthy; health returned application/database ready JSON; fixed-User `skills.get` returned the seeded typed skill; `/unknown` returned 404; `/proc/1/cmdline` named compiled `compose-main.js`; stop completed in 0.309 seconds with exit 0 and no OOM. | `artifacts/validation/compose-remediation/T03/` | [x] PASS |
| E-013 | T02 | `docker compose config --quiet`; `node infra/tests/compose-topology.mjs`; `docker compose up --build --wait web api` | Resolved web target is exact Docker DNS and rebuilt web/API pair is healthy. | 2026-08-18: PASS. The pre-fix topology assertion failed with `actual: undefined`; after the Compose-only override, config validation passed, topology passed, and rebuilt web/API services became healthy. | `artifacts/validation/compose-remediation/T02/` | [x] PASS |
| E-014 | T02 | `docker compose exec -T web sh -c 'wget --server-response --output-document=- http://api:3000/healthz'`; `curl --fail-with-body --show-error --get --data-urlencode 'input={"skillId":"calculator_assistant","version":"1"}' http://127.0.0.1:4173/trpc/user/skills.get`; scoped web log review | Web container reaches API by service name; through-web typed tRPC query returns the seeded response with no proxy refusal, 502, or HTML fallback. | 2026-08-18: PASS, independently rerun by parent. Container health probe resolved `api` to Docker IP and returned HTTP 200 application readiness; through-web `skills.get` returned `calculator_assistant` version `1`, typed instructions, and `calculator.evaluate`; web logs from the rerun had no proxy error, `ECONNREFUSED`, 502, or bad gateway. | `artifacts/validation/compose-remediation/T02/` | [x] PASS |
| E-015 | T05 | Clean rebuilt workers with `node --max-old-space-size=48` under the 256 MiB worker limit | Workers should boot without V8 fatal errors. | 2026-08-17: FAIL preserved. All three roles repeatedly reached roughly 45-48 MiB heap usage and emitted V8 `FATAL ERROR` / `heap out of memory` before readiness. | `artifacts/validation/compose-remediation/T05/` | [ ] FAIL |
| E-016 | T05 | Clean rebuilt workers with `node --max-old-space-size=128` while the 64 MiB worker reservation remained | Workers should boot without the Temporal unsafe-memory warning. | 2026-08-17: FAIL preserved. All workers became healthy with 131 MiB V8 limits and `OOMKilled=false`, but fresh workflow logs emitted `high probability` and recommended `--max-old-space-size=48`; cgroup reservation precedence selected 64 MiB. | `artifacts/validation/compose-remediation/T05/` | [ ] FAIL |
| E-017 | T05 | Remove worker reservation; clean rebuild/startup twice; numeric cgroup probes; PID/heap/OOM/memory probes; `node packages/testkit/scripts/task18-restart.mjs`; fresh log scan | No nonzero reservation, 256 MiB hard limit retained, bounded 128 MB workers healthy through repeated startup and Simple Loop/State Workflow restart recovery, no OOM events, and no unsafe/fatal log markers. | 2026-08-17: PASS. Installed Temporal SDK 1.22 source showed `memory.low ?? memory.min ?? soft_limit` selected before `memory.high ?? memory.max`, then 75% recommendation. Workflow cgroup values were `memory.low=0`, `memory.min=0`, `memory.max=268435456`, `memory.events` all zero; child commands had exactly `--max-old-space-size=128`; V8 limit was 131 MiB; startup memory stayed below 256 MiB; all workers emitted `worker.ready` on both startups; restart gate passed both runtime recovery scenarios and cleanup; fresh logs matched neither unsafe warning nor `heap out of memory`/`FATAL ERROR`. | `artifacts/validation/compose-remediation/T05/`, `artifacts/validation/final-runtime-evidence/` | [x] PASS |

## Commit boundaries

| Order | Task | Required commit | Boundary rule | Status |
| --- | --- | --- | --- | --- |
| 1 | T01 | `fix(container): exclude local environment files` | Secret-boundary ignore rules and their focused test only. | [ ] |
| 2 | T02 | `fix(web): route compose trpc traffic to api` | Compose web target and topology assertion only. | [ ] |
| 3 | T03 | `fix(api): run real trpc server in compose` | API startup, readiness, image build, Compose wiring, and focused tests together. | [ ] |
| 4 | T04 | `fix(runtime): honor compose provider configuration` | Provider factory, worker wiring, base and override rules, and provider tests together. | [ ] |
| 5 | T05 | `fix(worker): cap node heap for compose workers` | Worker Node flags, cgroup boundary, and focused topology/boot assertions only. | [ ] |
| 6 | T06 | `test(compose): cover real browser application flows` | Real-Compose browser harness, scripts, matrix tests, and package scripts together. | [ ] |

Do not squash these boundaries. Do not mix generated evidence or local environment files into any commit. If a task needs a migration or contract change, keep that change and its tests in the same task commit and record the scope change here before implementation.

## Completion criteria

The remediation is complete only when every item below is checked:

- [ ] CMP-SEC-01 through CMP-E2E-06 are closed with focused `PASS` evidence.
- [ ] T01 through T06 each have exactly one atomic conventional commit using the listed message.
- [ ] The security rules are satisfied, including image inspection and secret-redaction checks.
- [ ] Base Compose is deterministic and requires no provider credential.
- [ ] Optional live-provider override is explicit, isolated, redacted, and non-gating.
- [ ] BrowserMCP rows B01 through B08 pass against the real Compose stack for both runtimes.
- [ ] Every mandatory row in the full previous-plan regression matrix is `PASS`.
- [ ] All twenty F01 to F10 runtime cells are `PASS`, with separate P05 and P06 records.
- [ ] No mandatory result is `FAIL`, `BLOCKED`, or `NOT RUN`.
- [ ] Health proves the real API and dependencies, not a static scaffold.
- [ ] Privacy, duplicate safety, approval behavior, SSE reconnect, restart, replay, and parity evidence are retained.
- [ ] Final cleanup removes containers, networks, volumes, disposable images, sentinels, and test processes.
- [ ] The evidence ledger records actual results and artifact paths without secret values.

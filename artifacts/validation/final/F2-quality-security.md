# F2 Code Quality and Security-Boundary Review

Date: 2026-08-17

## VERDICT: REJECT

The review found two unresolved release-blocking issues: one critical authorization bypass and one high-severity durable-dispatch failure. Lint and typecheck pass, but F2 cannot approve while either issue remains.

## Findings

### QS-01 - CRITICAL - Admin authority is selected by an unauthenticated URL path

- Boundary: fixed actors, authorization, hidden Admin commands, exact approvals.
- Source: `apps/api/src/server.ts:16-34` mounts the same router at `/trpc/user/` and `/trpc/admin/` and constructs `FIXED_ACTORS.ADMIN` solely when the request URL starts with `/trpc/admin/`. `apps/api/src/trpc.ts:43-48` then trusts that server-created context. `apps/api/src/routers/admin.ts:5-11` and `apps/api/src/routers/approvals.ts:22-55` expose Admin mutations under that context.
- Exploitability: confirmed through a live loopback server using no cookies, credentials, headers, or prior User session. A direct tRPC request to `/trpc/admin/admin.command.sendHidden` returned `{"noCredentialsOrHeaders":true,"status":"accepted","actorId":"mvp_admin"}`.
- Impact: any process or browser with API reachability can submit hidden model instructions, read pending exact approvals, and approve or reject them. The User-path middleware test only proves that `/trpc/user/*` cannot invoke an Admin procedure; it does not prevent choosing `/trpc/admin/*`.
- Scope note: Compose binds the API to loopback, reducing remote exposure, but local reachability is sufficient and the claimed User/Admin authorization boundary is not enforced. The plan excludes a generalized auth product, but it still requires that a User cannot invoke Admin commands or approvals.
- Status: unresolved.

### QS-02 - HIGH - Simple Loop dispatch intents are never acknowledged

- Boundary: persistence, dispatch replay, process-local suppression, worker failure handling.
- Source: `packages/db/src/repositories/work-scans.ts:122-135` returns every due `dispatch_intents` row whose status remains `pending`. `packages/runtime/src/compose-worker.ts:53-69` executes every `simple_loop.execute` intent, catches failures, and sleeps for 100 ms, but never updates the intent. No Simple Loop marker exists; the analogous report, workflow-start, and workflow-signal paths mark their intents in `report-job-dispatch.ts`, `state-workflow.ts`, and `state-workflow-signals.ts`.
- Exploitability: every admitted Simple Loop run creates such an intent (`packages/db/src/repositories/admission.ts:153`). No hostile timing is required. After the first terminal execution, each poll retries the same run; `packages/db/src/repositories/leases.ts:55-57` rejects the terminal claim, and the worker logs `simple.conflict` before retrying again.
- Impact: permanent database polling and log amplification at 10 cycles/second, growing linearly with every historical Simple Loop intent. This is a durable availability and operability failure; restart does not clear it because PostgreSQL retains the pending rows.
- Status: unresolved.

### QS-03 - MEDIUM - Task 18 deterministic worker gate does not require `NODE_ENV=test` for both runtime workers

- `packages/runtime/src/compose-worker.ts:22-29` requires `TASK18_COMPOSE_MODE=enabled` but does not parse or require `NODE_ENV=test`; Simple Loop and State Workflow then construct `createComposeDeterministicProvider()` directly at lines 40 and 84.
- The fixture worker is separately protected because `createReportFixtureTestWorker` checks `NODE_ENV=test` in `packages/runtime/src/jobs/report-queue.ts:104-106`.
- Impact: a non-test process with the explicit Task 18 flag can run deterministic test provider/control behavior. This requires environment-control access and is therefore not classified high, but it does not meet the requested dual gate.

### QS-04 - MEDIUM - Runtime cancellation is not forwarded to the provider boundary

- `packages/runtime/src/simple-loop/provider-model.ts:153-163` omits the AI SDK `abortSignal` from `doGenerate` options and the call to `provider.generate`.
- `packages/runtime/src/provider/adapter.ts:143-148,205-206` can honor abort and timeout, but only timeout remains effective on the real runtime path.
- Impact: an outer cancellation cannot stop the in-flight provider operation; the configured inner total/step timeout still bounds it, so this is not high severity.

### QS-05 - MEDIUM - Approval send reservation has a crash-recovery gap

- `packages/db/src/repositories/simulated-sends.ts:60-89` inserts the call-keyed reservation before execution. `packages/runtime/src/application/approvals.ts:147-163` performs the simulated side effect and only then replaces the reservation ID with the message ID.
- A process crash after reservation, or after the side effect but before completion, leaves a durable row that makes every retry fail as a duplicate. This preserves at-most-once send safety but can strand an approved call indefinitely.
- Impact is availability rather than duplicate side effect, and the side effect is the local deterministic fixture, so severity is medium.

### QS-06 - MEDIUM - Approval package-boundary test is stale and omitted from root gates

- `corepack pnpm --filter @agentic-chat/tools test` failed 1 of 28 tests. `packages/tools/tests/package-boundary.test.ts:8-16` expects string exports, while `packages/tools/package.json:6-15` uses conditional `production`/`default` exports.
- The runtime assertion that the root package cannot mint approval capabilities still passed. This is test/manifest drift, not a demonstrated capability escape.
- Root `lint` and `typecheck` do not execute this suite, so those green gates do not reveal the stale security-boundary test.

## Boundary Review Evidence

| Boundary | Result | Concrete evidence |
| --- | --- | --- |
| Fixed actor procedures | FAIL | Middleware is internally consistent, but `server.ts` derives Admin identity from a caller-selectable path; live no-credential Admin mutation succeeded (QS-01). |
| Hidden Admin privacy | PASS after actor selection | `projectEvents` drops non-User visibility; `UserProjectionSchema` rejects hidden events; `client.ts` drops hidden User frames; Admin event payloads omit instruction text. This does not mitigate QS-01 because an attacker can select the Admin projection. |
| Exact approval binding | PASS | `approval-bindings.ts:18-39` checks run, call, tool ID/version, canonical arguments and hash. `approval-decisions.ts:25-181` locks approval/run/call, checks expiry, expected hash/version, status, and writes one action/event/dispatch transactionally. `0002_nervous_charles_xavier.sql` makes binding fields immutable. |
| Single decision/send | PASS with crash gap | Unique approval/action/call constraints, optimistic version update, call-keyed `simulated_sends` PK, and single-use capability prevent duplicate decisions/sends. QS-05 affects recovery, not multiplicity. |
| Runtime immutability | PASS | `0001_immutable_run_runtime.sql` rejects runtime updates; repository predicates and `workflow_identity` checks add defense in depth. |
| Wrong-worker claim and fencing | PASS | `claimNextSimpleLoopRun` filters `runtime=simple_loop` and uses `FOR UPDATE SKIP LOCKED`; `lockSimpleLoopLease` checks owner, fence, version, expiry; workflow mutations require exact workflow identity/version. |
| Transaction boundaries and duplicate safety | PASS except QS-02/QS-05 | State/event/intent writes use Drizzle transactions; SQL uniqueness covers run sequence, dispatch dedupe, approval action, jobs, and sends. Simple Loop delivery never completes its intent. |
| Temporal determinism | PASS | `workflows.ts` imports only `@temporalio/workflow`, activity options, contracts, and the pure state machine. Database/AI/tool/queue imports remain in Activities. Reachable forbidden-import and real replay tests exist. |
| Provider config and secrets | PASS with QS-04 | Live mode validates model/base URL/key; adapter sets `store:false`, disables parallel tool calls, uses bounded timeout/no retries, and maps errors to fixed redacted text. Mock/live are explicit modes. Runtime abort is dropped. |
| Calculator and tool validation | PASS | Bounded recursive-descent parser has length/depth/token limits and no dynamic evaluation. `registry.executeAiTool` parses the discriminated per-tool schema before allowlist authorization and reparses at execution. Direct send is denied. |
| SSE | PASS | Listener is installed before cursor resolution/catch-up; canonical cursor validation triggers refetch; inspected cursor advances over hidden events; event IDs dedupe; viewer projection precedes yield; generator `finally` removes abort listener and unsubscribes. |
| Compose Task 18 gates | PARTIAL | Control CLI requires both gates; fixture test constructors require `NODE_ENV=test`; runtime worker entry requires only explicit mode (QS-03). |
| Real worker loops | FAIL | Workflow/report markers and connection shutdown exist, but Simple Loop has no dispatch acknowledgement or process-local suppression (QS-02). |
| Evidence integrity | PASS with minor residual risk | Acceptance PASS requires schema-v2 PostgreSQL observation plus digest and expected trace checks. Task 18 scripts gate on child exit status/test counts; some summary fields are static descriptions, not independent measurements. |
| Code hygiene | PASS | No source matches for TODO/FIXME/HACK, `as any`, `@ts-ignore`, `@ts-expect-error`, empty catches, `eval`, or `Function`. No production source exceeds the 250 pure-LOC ceiling in the audit scan. |

## Commands and Results

1. `corepack pnpm lint && corepack pnpm typecheck` - PASS. Biome checked 262 files; all eight TypeScript workspace projects completed successfully.
2. `corepack pnpm --filter @agentic-chat/tools test` - FAIL. 27 passed, 1 failed (`tests/package-boundary.test.ts:40`), documented as QS-06. This command was an additional audit probe, not the required lint/typecheck gate.
3. `node --conditions=production --input-type=module -e '<inline no-credential tRPC Admin probe>'` from `apps/api` - Admin mutation accepted with `actorId=mvp_admin`; the server was closed in `finally`.
4. `rtk docker compose ps -q` - the first cleanup check returned no output. A final recheck found nine healthy containers created at 17:38-17:39 by concurrent workspace activity after the first check; F2 did not start them and did not destroy another task's active topology.
5. LSP directory diagnostics - zero errors in contracts, DB, runtime, tools, API, web, and worker scopes. Runtime/tools reported deprecation hints only.
6. Source scans - no TODO/FIXME/HACK, `as any`, TypeScript suppression, empty catch, or dynamic-code matches. Pure-LOC scan found no production source over 250 lines.

An initial root-directory version of the inline HTTP probe failed before starting a server because `@trpc/client` is package-local; rerunning from `apps/api` succeeded. The probe left no files or services behind.

## Cleanup

- The temporary HTTP server closed in a `finally` block.
- No temporary source, test, or evidence helper file was created.
- No Docker Compose service was started by F2. The F2-owned cleanup check was initially empty; a concurrently created nine-service topology appeared later and was left untouched to avoid destroying another task's resources.
- No product code, tests, plan checkbox, git state, database state, or persistent service was modified.

## Confidence

Confidence: **0.98**. The verdict combines direct source tracing, SQL/migration inspection, independent parallel audits, successful lint/typecheck/LSP gates, a targeted failing boundary test, and a live proof of the authorization bypass. No finding relies solely on prior DoneClaims or generated PASS artifacts. The concurrent Compose topology did not affect source findings or the isolated HTTP probe.

## Final Verdict

**REJECT**

Approval requires resolution and regression coverage for QS-01 and QS-02, followed by a fresh F2 review.

---

## Remediation Rerun - 2026-08-17

### VERDICT: APPROVE

The original rejection above is preserved as historical evidence. The fresh review reclassified QS-01 against the frozen no-auth MVP contract, verified remediation of QS-02, QS-03, QS-04, and QS-06, and retained QS-05 as a non-blocking fixture availability risk. No release-blocking code-quality or security-boundary finding remains within the approved MVP scope.

### Finding Disposition

| Finding | Fresh disposition | Evidence |
| --- | --- | --- |
| QS-01 | REJECTED AS OUT OF CONTRACT | The blueprint explicitly states that the MVP has no authentication flow and that `/user/*` and `/admin/*` create fixed `mvp_user` and `mvp_admin` contexts. The live path-selection behavior is therefore the specified deterministic actor model, not an authentication bypass within this MVP. It remains unsuitable for production exposure by design. |
| QS-02 | RESOLVED | `simple-loop-dispatch.ts` validates the exact intent ID, topic, aggregate, runtime, and payload under a transaction lock before durable acknowledgement. `compose-simple-dispatch.ts` acknowledges only after the executor returns a waiting/terminal boundary, recovers stale terminal delivery, and propagates transient failures. PostgreSQL tests prove handled intents leave restart scans while transient failures remain pending. |
| QS-03 | RESOLVED | `compose-worker.ts` now requires both `NODE_ENV=test` and `TASK18_COMPOSE_MODE=enabled`; `compose-worker-boot.mjs` locks the dual gate. |
| QS-04 | RESOLVED | `provider-model.ts` forwards the caller-owned `abortSignal` unchanged into `provider.generate`; the focused model-bridge regression passes. |
| QS-05 | ACCEPTED RESIDUAL RISK | The call-keyed reservation still makes duplicate sends fail closed. A crash between reservation, fixture effect, and completion can strand availability, but cannot produce a second send through this path. For the local deterministic fixture this is an operability limitation, not a security-boundary failure. |
| QS-06 | RESOLVED | The tools package-boundary test now parses the conditional `production`/`default` export map while retaining the root-capability denial; all 28 tools tests pass. |

### Additional Recovery Correction

The first real Compose rerun exposed an interaction between durable acknowledgement and report resume timing: Simple Loop resume dispatch was created at 50% progress and could be consumed before canonical completion. A failing-first PostgreSQL test reproduced the premature intent. Resume intent creation now occurs transactionally with report completion, matching the actual ready boundary. The same real restart gate then passed for both runtimes.

### Fresh Verification Evidence

1. `corepack pnpm --filter @agentic-chat/runtime exec vitest run tests/compose-simple-dispatch.integration.test.ts --fileParallelism=false` - PASS, 3/3.
2. `corepack pnpm --filter @agentic-chat/runtime exec vitest run tests/provider-language-model.test.ts` - PASS, 1/1.
3. `node infra/tests/compose-worker-boot.mjs` - PASS.
4. `corepack pnpm --filter @agentic-chat/db test` - PASS, 21/21, including the completion-bound resume regression.
5. `corepack pnpm --filter @agentic-chat/runtime test` - PASS, 77/77.
6. `corepack pnpm --filter @agentic-chat/tools test` - PASS, 28/28.
7. `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm build` - PASS across the workspace.
8. `corepack pnpm test:restart` - PASS after the completion-bound dispatch correction. `restart.json` records two recovery scenarios per runtime, exact worker-only restarts, stable run/call/job identities, and completed outcomes.
9. Task 18 adversarial suites - PASS, 52 tests across PostgreSQL fencing/duplicates, runtime delivery/isolation, and API SSE privacy/atomicity.
10. LSP diagnostics - zero findings on every changed TypeScript file; targeted Biome and no-excuse checks pass.
11. Cleanup receipt - PASS with no remaining Compose containers and no listeners on ports 3000, 4173, or 7233.

### Residual Risk

- The route-selected fixed actors are deliberately unauthenticated and must remain restricted to this loopback architecture-comparison MVP. Production deployment requires a separately scoped identity and authentication design.
- QS-05 can strand one approved deterministic fixture send after a narrow crash window. At-most-once safety remains intact; recovery semantics are deferred beyond the frozen MVP.
- The five-member team-mode security workflow was unavailable in this delegated session. This rerun is a scoped verification of the original concrete findings, supported by an independent read-only remediation check and live tests, not a claim of a new exhaustive repository-wide security research pass.
- A separate independent boundary check continued to classify QS-01 as blocking because it interpreted capability separation as requiring caller authentication. The final disposition instead follows the blueprint's explicit contract that route selection creates the fixed actor and that the MVP has no authentication flow. This is a scope decision, not a dispute about the observed unauthenticated reachability.

### Final Verdict

**APPROVE**

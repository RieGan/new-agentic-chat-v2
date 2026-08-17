# F4 Scope Fidelity and Parity Review

Date: 2026-08-17  
Reviewer gate: F4 only  
Verdict: **APPROVE**  
Confidence: **0.99**

## Original rejecting finding (preserved)

The 22 current PostgreSQL-derived records are internally sound and independently match across runtimes, but the release parity comparator is not trustworthy enough to prove that result in the presence of a regression.

In [`acceptance-records.parity.test.ts`](../../../packages/testkit/tests/parity/acceptance-records.parity.test.ts), `sharedPayload` replaces every string whose key ends in `Id` or `Hash`. This erases `skillId`, which is a semantic skill-selection outcome rather than a runtime-generated identity, and would allow two runtimes to select different skills while still reporting `traceMatch: true`. The same generic rule can erase future semantic hashes without proving that they differ only because of an allowed generated identity.

The comparator's `sharedOutcome` also retains only tool name/status, approval status/decision, and job status/percent. It omits tool arguments, tool result/error semantics, selected skill, approval actor, and job result semantics. Those are required F4 outcome dimensions, so the generated PASS in [`parity.json`](../final-runtime-evidence/parity.json) is not fail-closed against all prohibited semantic differences.

This is an evidence-gate defect, not a demonstrated mismatch in the current records. The independent stricter comparison below preserved `skillId`, tool names, arguments, results/errors, approval decisions/actors, job progress/results, visibility, event payload semantics, and final status. It normalized only generated call/approval/command/job/message/preview/report identities, the approval hash derived from the runtime-specific preview identity, and runtime-specific final AI prose. All 11 current pairs matched under that stricter comparison.

## Record and matrix audit

Both matrix files contain exactly 10 runtime/flow cells, for 20 total cells. F01-F04 and F06-F10 each map to one prompt; F05 maps to the distinct P05 and P06 records in both runtimes.

| Flow/prompt | Simple Loop evidence/run | State Workflow evidence/run | Digest/source | Strict trace/outcome |
| --- | --- | --- | --- | --- |
| F01/P01 | [`P01.json`](../acceptance/simple_loop/F01/P01.json), `run_e2e_f01_4` | [`P01.json`](../acceptance/state_workflow/F01/P01.json), `run_f01_4` | valid / PostgreSQL | match |
| F02/P02 | [`P02.json`](../acceptance/simple_loop/F02/P02.json), `run_e2e_f02_4` | [`P02.json`](../acceptance/state_workflow/F02/P02.json), `run_f02_4` | valid / PostgreSQL | match |
| F03/P03 | [`P03.json`](../acceptance/simple_loop/F03/P03.json), `run_e2e_f03_4` | [`P03.json`](../acceptance/state_workflow/F03/P03.json), `run_f03_4` | valid / PostgreSQL | match |
| F04/P04 | [`P04.json`](../acceptance/simple_loop/F04/P04.json), `run_e2e_f04_4` | [`P04.json`](../acceptance/state_workflow/F04/P04.json), `run_f04_4` | valid / PostgreSQL | match |
| F05/P05 | [`P05.json`](../acceptance/simple_loop/F05/P05.json), `run_e2e_f05_missing_4` | [`P05.json`](../acceptance/state_workflow/F05/P05.json), `run_f05_missing_4` | valid / PostgreSQL | match |
| F05/P06 | [`P06.json`](../acceptance/simple_loop/F05/P06.json), `run_e2e_f05_prohibited_4` | [`P06.json`](../acceptance/state_workflow/F05/P06.json), `run_f05_disallowed_4` | valid / PostgreSQL | match |
| F06/P07 | [`P07.json`](../acceptance/simple_loop/F06/P07.json), `run_wait-f06_4` | [`P07.json`](../acceptance/state_workflow/F06/P07.json), `run_state_durable_report_4` | valid / PostgreSQL | match |
| F07/P08 | [`P08.json`](../acceptance/simple_loop/F07/P08.json), `run_wait-approve_4` | [`P08.json`](../acceptance/state_workflow/F07/P08.json), `run_state_durable_approve_4` | valid / PostgreSQL | match |
| F08/P09 | [`P09.json`](../acceptance/simple_loop/F08/P09.json), `run_wait-reject_4` | [`P09.json`](../acceptance/state_workflow/F08/P09.json), `run_state_durable_reject_4` | valid / PostgreSQL | match |
| F09/P10 | [`P10.json`](../acceptance/simple_loop/F09/P10.json), `run_wait-admin_4` | [`P10.json`](../acceptance/state_workflow/F09/P10.json), `run_state_durable_user_4` | valid / PostgreSQL | match |
| F10/P11 | [`P11.json`](../acceptance/simple_loop/F10/P11.json), `run_wait-f06_4` | [`P11.json`](../acceptance/state_workflow/F10/P11.json), `run_state_durable_report_4` | valid / PostgreSQL | match |

For every record:

- `schemaVersion` is 2.
- `provenance.source` is exactly `postgresql_projection_capture`.
- `provenance.capturedRunId`, top-level `runId`, and `stableIds.runId` agree.
- The run ID is a captured fixture run ID and is not a synthetic `run_acceptance_*` catalog ID.
- Recomputing SHA-256 over the schema-v2 observed capture, before provenance/evidence fields are added, equals `provenance.observationDigest`.
- User projections contain only `user` visibility and no Admin command event.

P05 and P06 remain distinct in both runtimes after legitimate normalization. P05 has no selected skill/call and terminates failed for `SKILL_NOT_FOUND`. P06 selects `calculator_assistant`, records a rejected `notification.send_email` call, includes `skill.loaded` and tool lifecycle events, and terminates failed for `TOOL_NOT_ALLOWED`.

## Semantic parity audit

The independent comparison checked the following, rather than relying on matrix PASS labels:

- Event position/order, event type, visibility, and complete payload semantics.
- Skill identity/version/instructions/allowed tools.
- Tool name, status, arguments, result, and error semantics.
- Approval status, decision, actor, and lifecycle visibility.
- Job status, percent progress, result, and lifecycle events.
- Admin command lifecycle and `model_only` privacy in F09.
- Final run status and exactly one final AI message per record.
- User projection privacy for all records.

All current pairs matched. The only observed cross-runtime trace differences were generated identities, approval hashes derived from runtime-specific preview identities, and final AI prose in scenarios where the expected contracts explicitly permit architecture-specific wording. The core normalizer in [`parity.ts`](../../../packages/contracts/src/parity.ts) is appropriately narrow: it removes only `runtime.diagnostic`, reassigns positions, and preserves type, visibility, and payload. Temporal workflow IDs, history positions, and advance attempts remain in `metadata.runtimeDiagnostics`/`metadata.executionOutcome`; no `runtime.diagnostic` appears in a normalized acceptance trace.

## Scope and side-effect audit

- [`notification.ts`](../../../packages/tools/src/notification.ts) uses only `node:crypto` plus local contracts. `simulateApprovedSend` computes a deterministic result and has no SMTP, HTTP, socket, or provider call.
- [`simulated-sends.ts`](../../../packages/db/src/repositories/simulated-sends.ts) reserves/completes one PostgreSQL `simulated_sends` row under exact approval binding. [`approvals.ts`](../../../packages/runtime/src/application/approvals.ts) connects those local operations. No mail transport dependency/import or external network side effect exists.
- Nine workspace manifests contain no auth/OIDC, mail transport, Next.js, retrieval/vector, memory, upload/file, sharing/export, or production-deployment dependency.
- Product-source searches found no auth/OIDC, tenancy, Next.js/RSC, AI SDK UI streaming, token-delta transport, file/upload, retrieval, memory, sharing, export, or production-deployment implementation. `message.delta` occurrences are negative assertions or explanatory UI copy.
- [`compose-control.ts`](../../../packages/runtime/src/compose-control.ts), [`compose-provider.ts`](../../../packages/runtime/src/compose-provider.ts), and [`compose-worker.ts`](../../../packages/runtime/src/compose-worker.ts) require Task 18 test-mode controls. They are not exported from the runtime package entrypoint and the comparison source-line measurement counts only `src/simple-loop` and `src/state-workflow`, so these controls are not counted as product scope or runtime complexity.

## Comparison labeling audit

[`comparison.md`](../final-runtime-evidence/comparison.md) correctly places isolated restart/adversarial delivery, schema-v2 parity, and Temporal replay under `Release gates`. It separately labels recovery duration, runtime-specific source lines, and shared parity duration as `Non-gating measurements`, explicitly gives them no pass threshold, and does not use them to select a runtime. [`comparison.json`](../final-runtime-evidence/comparison.json) independently encodes `measurements.gate: false` and `thresholds: null`.

The report honestly states that Task 17 has no per-flow wall-clock latency and therefore does not invent F01/F03 median or p95 values. Temporal replay remains a separate release gate in [`temporal-replay.json`](../final-runtime-evidence/temporal-replay.json), not a normalized parity event.

Secondary evidence limitation: [`task18-parity.mjs`](../../../packages/testkit/scripts/task18-parity.mjs) regenerates the comparison by reading existing restart and replay JSON. It does not run those two gates or validate their freshness/provenance. This does not change the accurate gate-versus-measurement labels, and F4 intentionally did not rerun the other final-wave gates, but `comparison.md` alone is not proof that all three PASS artifacts came from one fresh controlled sequence.

## Commands and observed results

```sh
corepack pnpm test:parity
```

Result: exit 0; 2 test files and all 7 tests passed. The seven are six live State Workflow canonical-order/privacy/status cases (`direct`, `skill`, `calculator`, `divisionByZero`, `missingSkill`, `disallowed`) plus the all-record schema-v2 parity comparison.

The exact independent audit command was:

```sh
node artifacts/validation/final/F4-independent-audit.mjs
```

The linked [`F4-independent-audit.mjs`](F4-independent-audit.mjs) recomputes every observation digest, verifies provenance/run-ID/privacy invariants, deeply compares full traces and outcomes with an explicit generated-identity allowlist, and asserts P05/P06 inequality. Result:

```text
SUMMARY records=22 pairs=11 cells=20 strictSemanticParity=PASS P05P06Distinct=PASS
```

Scope searches and manifest audit:

```sh
rtk rg -n --glob '!node_modules/**' --glob '!**/dist/**' --glob '!artifacts/**' --glob 'package.json' '(next-auth|openid|oidc|auth0|clerk|better-auth|nodemailer|smtp|sendgrid|resend|postmark|mailgun|pinecone|vector|retriev|memory|upload|multipart)' .
rtk rg -n --glob '!node_modules/**' --glob '!**/dist/**' --glob '!artifacts/**' --glob '*.{ts,tsx}' '(nodemailer|SMTP|smtp|sendgrid|resend|postmark|mailgun|http\.request|https\.request|net\.connect|createConnection)' packages apps
rtk rg -n --glob '!node_modules/**' --glob '!**/dist/**' --glob '!artifacts/**' --glob '*.{ts,tsx}' '(streamText|UIMessage|toUIMessageStream|useChat|message\.delta|text-delta|next/|next-auth|openid|oidc|tenantId|organizationId|FormData|embedding|vector|exportRun)' packages apps
```

The first two searches returned no matches. The third returned only five negative assertions that reject `message.delta`; no implementation match was present. A Node manifest scan covered all nine workspace manifests and returned `forbiddenDependencyHits: []`.

Cleanup checks:

```sh
lsof -nP -iTCP:52376 -sTCP:LISTEN
lsof -nP -iTCP:52384 -sTCP:LISTEN
rtk docker compose ps --all --format json
```

All three returned no entries. The parity run left no Temporal listener or Compose service. Existing Task 18 cleanup evidence also reports no remaining containers or listening ports in [`cleanup.json`](../final-runtime-evidence/cleanup.json).

## Original required correction (completed)

Replace suffix-based normalization with an explicit generated-identity allowlist that preserves semantic identifiers such as `skillId`. Expand the parity outcome comparison to include selected skill, complete normalized tool arguments/results/errors, approval actor/decision, and job results. Add fail-closed mutation cases proving each semantic dimension causes the parity gate to fail. F4 must be rerun after that evidence-only correction.

## Original verdict (preserved)

**REJECT**

## Correction and same-session rerun

The original rejection evidence above is retained unchanged as the reason this correction was required. The authoritative comparator is now split into [`acceptance-comparison.ts`](../../../packages/testkit/tests/parity/acceptance-comparison.ts), used directly by the schema-v2 record gate, and protected by [`acceptance-comparison.mutation.test.ts`](../../../packages/testkit/tests/parity/acceptance-comparison.mutation.test.ts).

### Corrected normalization policy

- There is no suffix-based `endsWith("Id")` or `endsWith("Hash")` normalization.
- Event identities are enumerated by canonical event type and exact payload path. Only generated message, call, approval, job, command, send-result message, and report identities are replaced.
- `skillId`, `toolName`, status, visibility, actor, decision, percent, error code/message, skill version/instructions/allowlist, and every other business value remain unchanged and comparable.
- `notification.send_email` call arguments normalize only the runtime-specific prepared `previewId`; preview result semantics remain compared.
- Approval `argumentsHash` is normalized only when SHA-256 of the captured send call's exact arguments equals the event hash. A tampered hash remains literal and fails parity.
- Final AI prose is normalized only for the two known architecture-specific contracts, P04 and P08. All other final responses remain exact.

### Complete semantic outcome

The corrected outcome comparison includes final status and normalized final response; the complete observed skill; the complete Admin selected-skill snapshot including instructions; every tool name/status/argument/result/error; approval actor/status/decision; job status/percent/result; and final AI-message count. The trace comparison still includes event position/order, event type, visibility, and the full payload after only the explicit identity/prose policy.

### Failing-first and mutation evidence

Before the comparator correction, the new mutation suite produced **7 failures and 5 passes**. The false accepts were exactly the rejected dimensions: skill ID/instructions, tool argument/result/error, approval actor, and job result. This reproduced the F4 defect before implementation.

After correction, **18/18 isolated semantic mutations are rejected with a labeled `trace mismatch` or `outcome mismatch` assertion and Node's structural diff**:

- Trace and selected-skill ID, selected-skill version, allowlist, and instructions.
- Tool argument, result, and error.
- Approval actor, decision, and a non-derived/tampered arguments hash.
- Job percent and result.
- Event type, order, visibility, and payload.
- Final status.

### Fresh commands and evidence

```sh
corepack pnpm exec vitest run tests/parity/acceptance-comparison.mutation.test.ts
corepack pnpm exec vitest run tests/parity
corepack pnpm test:parity
node artifacts/validation/final/F4-independent-audit.mjs
corepack pnpm --filter @agentic-chat/testkit typecheck
corepack pnpm build
corepack pnpm exec biome check packages/testkit/tests/parity/acceptance-comparison.ts packages/testkit/tests/parity/acceptance-comparison.mutation.test.ts packages/testkit/tests/parity/acceptance-records.parity.test.ts packages/testkit/scripts/task18-parity.mjs
```

Observed results:

- Failing-first mutation run: 7 failed / 5 passed before correction.
- Focused corrected record plus mutation tests: 19/19 passed after adding the expanded skill/event barriers.
- Full parity directory: 3 files / 25 tests passed, comprising 18 mutation barriers, six live State Workflow cases, and the 11-pair schema-v2 record gate.
- Root parity gate: 3 files / 25 tests passed and regenerated [`parity.json`](../final-runtime-evidence/parity.json), [`comparison.md`](../final-runtime-evidence/comparison.md), and [`comparison.json`](../final-runtime-evidence/comparison.json).
- Independent audit: `records=22 pairs=11 cells=20 strictSemanticParity=PASS P05P06Distinct=PASS`; all observation digests remain valid and no Task 17 record changed.
- Workspace lint/build, Testkit typecheck, targeted Biome check, no-excuse audit, and parity-directory LSP diagnostics passed. Comparator/mutation/record files are 177/201/66 pure LOC and retain one responsibility each. The mutation file is in the 200-250 warning band; split it before adding another mutation class.

Root-wide typecheck was also rerun after concurrent F2 changes. It is currently blocked only by non-F4 `packages/runtime/tests/compose-simple-dispatch.integration.test.ts`, whose executor stub returns `{ status: "completed" }` without the required `runId`, `text`, and `consumedSteps`. The F4 package typecheck is clean and this non-overlapping file was not modified.

Temporal test listeners shut down after each run. No F4-owned Compose service or persistent process was created. The plan checkbox remains untouched.

## Fresh verdict

The comparator is now fail-closed for every required semantic dimension, current schema-v2 evidence still matches across all 11 pairs/20 cells, and the original rejection is resolved.

## VERDICT

**APPROVE**

# CMP-OUTCOME-09: Workflow rejection renders a sent outcome

## Status

Closed on 2026-08-18. The product fix is isolated from the unchanged T06 real-Compose browser harness.

## Minimal reproduction

```sh
docker compose down --volumes --remove-orphans
docker compose up --build --wait
pnpm test:compose-browser --runtime=state_workflow
```

For a focused browser trace, run the Compose approval spec with a unique lowercase namespace and `COMPOSE_BROWSER_RUNTIME=state_workflow`.

## Expected

- Admin rejects the exact pending approval.
- The same `state_workflow` run resumes and completes.
- PostgreSQL contains one rejected approval, zero simulated sends, and one AI final message.
- User sees `The message was not sent.` once.

## Observed

- Root command: exit 1; the report scenario passes and the approval scenario fails.
- Browser: final message is `Message message_call_send_state-workflow-debug-01_approval was sent.`
- Sanitized PostgreSQL row:

```text
run_df64ef53-3315-47f9-9d29-c0f9a42c5c7e|state_workflow|completed|rejected|0|1|Message message_call_send_state-workflow-debug-01_approval was sent.
```

The row proves the side effect did not occur; only the final User-visible outcome was false.

## Root cause and fix

`createComposeDeterministicProvider()` treated the presence of any `notification.send_email` tool result as a successful send and returned sent copy without reading its `output`. Both runtimes already supplied the same canonical outcomes:

```json
{"toolName":"notification.send_email","messageId":"message_<id>","status":"sent"}
{"toolName":"notification.send_email","status":"not_sent"}
```

The provider now parses that JSON boundary with a minimal strict discriminated schema. `sent` preserves the existing deterministic sent copy; `not_sent` returns `The message was not sent.`. Report, skill-load, preview, provider live mode, and worker continuation sequencing are unchanged.

## Evidence

- User false-sent screenshot: `artifacts/validation/compose-browser/debug-workflow-01/compose-approval-real-Comp-8976a-umes-the-same-User-run-once-compose-browser/test-failed-1.png`
- Admin rejected-state screenshot: `artifacts/validation/compose-browser/debug-workflow-01/compose-approval-real-Comp-8976a-umes-the-same-User-run-once-compose-browser/test-failed-2.png`
- Trace: `artifacts/validation/compose-browser/debug-workflow-01/compose-approval-real-Comp-8976a-umes-the-same-User-run-once-compose-browser/trace.zip`
- The same run's report scenario passed through Browser, Vite, API, PostgreSQL, Temporal, workflow worker, and fixture worker.
- RED: `pnpm --filter @agentic-chat/runtime exec vitest run tests/compose-provider.test.ts` failed only the rejected case because it received `Message message_call_send_provider-outcome was sent.`.
- GREEN: provider coverage passed 5/5; runtime integration passed 59/59; focused F07/F08 acceptance passed for both runtimes.
- Real Compose Simple Loop: namespace `simple_loop-msxouzym-5c032cdb`, 2/2 browser tests passed; approved run completed with one simulated send and one AI final message.
- Real Compose State Workflow: namespace `state_workflow-msxowm7v-69c9bd48`, 2/2 browser tests passed; rejected run completed with zero simulated sends, one AI final message, and `The message was not sent.`.

# Task 07 tool denial receipt

- P05: missing skill and unknown existing-skill version both return typed `SKILL_NOT_FOUND`; no fallback is selected and no tool executes.
- P06: `calculator_assistant@1` exposes only `calculator.evaluate`; communication tools are denied before execution.
- A forged calculator snapshot containing `notification.send_email` is rejected as `INVALID_SCHEMA` rather than widening the canonical registry allowlist.
- Unknown tools, malformed argument objects, invalid email/empty text, oversized expressions, deep parentheses, identifiers, property access, exponent syntax, `NaN`, `Infinity`, and trailing tokens are rejected at validated boundaries.
- Direct email send returns `INVALID_APPROVAL` and records a denial with zero executor invocations.
- Approval capabilities are consumed and bound to the exact call ID and canonical argument hash; mismatched and reused capabilities are rejected without another send.
- Prompt-injection-shaped subject/body strings remain inert normalized data and are never interpreted.
- Validated ast-grep patterns found zero `eval(...)`, `Function(...)`, or `new Function(...)` nodes in `packages/tools/src`; a text audit also found no VM, shell, network, SMTP, or browser execution imports/calls.

## Blocking-verification revision

- The ordinary `@agentic-chat/tools` runtime namespace was probed directly and contains no `createApprovalAuthorizationIssuer` property.
- The package manifest test fixes the only issuance path at the deliberately named `@agentic-chat/tools/approval-internal` subpath and fixes the test command at fail-closed `vitest run`.
- Existing direct-AI execution denial remains covered and reports zero send executions before an internal authorization capability is supplied.
- Final ast-grep audits again found zero `eval(...)`, `Function(...)`, or `new Function(...)` nodes; VM, shell, network, SMTP, and browser execution text audits also returned zero matches.

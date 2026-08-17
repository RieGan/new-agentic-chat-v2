# Agentic Chat MVP with Vercel AI SDK - Planning Draft

## State

- intent: clear
- classification: architecture
- review_required: false
- status: plan-complete
- plan_path: `.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`
- pending-action: choose `$start-work agentic-chat-mvp-vercel-ai-sdk` or request dual high-accuracy review
- approval_scope: approval authorizes plan creation only; implementation starts separately with `$start-work`

## Request

Implement the complete architecture-validation MVP defined by `docs/agentic-chat-mvp-development-blueprint.md`, satisfying F01-F10 in `docs/agentic-chat-mvp-validation-test-plan.md` for both `simple_loop` and `state_workflow`.

## Components ledger

| ID | Component | Outcome | Status | Evidence |
| --- | --- | --- | --- | --- |
| C1 | Workspace and local infrastructure | pnpm/strict TypeScript/Node 22+ workspace and health-gated Compose topology | locked | MVP blueprint §§3, 5, 10 |
| C2 | Shared contracts and persistence | Shared Zod/tRPC contracts, fixed actors, Drizzle schema/migrations, event and idempotency ledgers | locked | MVP blueprint §§4, 8, 9 |
| C3 | Provider, skills, and tools | AI SDK 7 OpenAI Responses adapter plus versioned deterministic fixture registry | locked | MVP blueprint §7; AI SDK OpenAI provider docs |
| C4 | Simple Loop | Bounded AI SDK `ToolLoopAgent` executor with persisted pause/resume state | locked | User decision; MVP blueprint §§5, 11 |
| C5 | State Workflow | Temporal workflow with deterministic orchestration and AI/tool I/O in Activities | locked | User decision; MVP blueprint §§3, 5, 11 |
| C6 | API, UI, and validation | Thin tRPC API, tracked SSE, User/Admin SPA, and dual-runtime F01-F10 evidence | locked | MVP blueprint §§6, 8, 12; validation plan §§3-9 |

## Decisions ledger

- Use AI SDK 7 and Node.js 22+ ESM packages.
- Use `@ai-sdk/openai` and `createOpenAI(...).responses(modelId)` explicitly; do not use Chat Completions or `@ai-sdk/openai-compatible` for the live provider path.
- Read model ID, Responses-capable base URL, and API key from validated environment variables supplied later; commit placeholders only in `.env.example` and never commit secrets.
- Use non-streaming AI SDK generation and publish one persisted `message.completed`; tRPC tracked SSE remains the only client live transport.
- Use AI SDK `ToolLoopAgent` with an explicit bounded `stopWhen` for `simple_loop`.
- Keep Temporal workflow code deterministic; run OpenAI Responses calls, PostgreSQL access, and tool execution in Activities.
- Treat PostgreSQL as authoritative for product projections and application idempotency; Temporal history is authoritative for active workflow orchestration; BullMQ delivery is retryable and application handlers implement idempotency.
- All tools are deterministic local fixtures. `notification.send_email` records a simulated idempotent send only after exact Admin approval; no SMTP/vendor integration or external credentials.
- Use contract-first TDD, followed by integration, UI, parity, and restart E2E tests.
- Add deterministic barriers for restart injection, normalized event-trace parity assertions, wrong-runtime claim/mutation tests, malformed-schema tests, approval tampering/races, Admin command negative cases, duplicate async delivery, and pending-approval recovery.

## Scope

### In

- Entire MVP blueprint and F01-F10 for both runtimes.
- One web SPA, one API, one worker codebase with distinct runtime processes, one fixture worker.
- PostgreSQL/Drizzle, Redis/BullMQ, Temporal, tRPC v11 tracked SSE, Vite 8/Rolldown React, Tailwind, Biome.
- Fixed `mvp_user` and `mvp_admin` route contexts.
- Deterministic provider fixtures and an optional live OpenAI Responses configuration path.

### Must not have

- Authentication/login/OIDC, tenancy, account management, files, retrieval, memory, citations, multi-agent delegation, exports, sharing, or production deployment features.
- Real email sending or any non-fixture external side effect.
- AI SDK UI streaming, token deltas, `message.delta`, Next.js, RSC, or App Router conventions.
- LLM/network/database calls inside Temporal workflow code.
- Cross-runtime fallback or mutable runtime assignment after execution starts.

## Evidence ledger

- Repository inventory: implementation is greenfield; only docs and tooling metadata exist.
- `docs/agentic-chat-mvp-development-blueprint.md`: normative stack, boundaries, contracts, procedures, persistence, Compose topology, and definition of done.
- `docs/agentic-chat-mvp-validation-test-plan.md`: deterministic fixtures and F01-F10 acceptance flows.
- Official AI SDK 7 docs confirm `ToolLoopAgent`, `MockLanguageModelV4`, and `createOpenAI(...).responses(modelId)` with custom `baseURL` and `apiKey`.
- Official Temporal docs confirm deterministic workflows, Activity placement for external I/O, replay/restart behavior, and at-least-once Activity execution risk.
- Official BullMQ/tRPC/Drizzle docs confirm retry/redelivery considerations, tracked SSE cursor mechanics, and database-local transaction support; durable replay/outbox/idempotency remain application responsibilities.

## Approval gate

- status: awaiting-approval
- approach: build the full greenfield MVP as contract-first vertical slices, preserving one public contract while implementing AI SDK ToolLoopAgent and Temporal as separate runtime adapters; prove parity and recovery through F01-F10 plus uncovered negative cases.
- next action after explicit approval: scaffold `.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`, run mandatory Metis gap analysis, append decision-complete implementation and final-verification tasks, then present the plan for worker handoff.

## Plan completion

- plan: `.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`
- implementation todos: 18
- final verification tasks: 4
- mandatory Metis gap analysis: completed; findings incorporated for `skill.load` accounting, F09 active-run semantics, normalized parity traces, provider modes, durable boundaries, approval integrity, deterministic barriers, and scope control.
- structural check: passed; required headings are ordered, todos use `- [ ] N.`, and final verifiers use `- [ ] F<number>.`.

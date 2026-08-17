<!-- markdownlint-disable MD013 -->

# Agentic Chat MVP Development Blueprint

> **Purpose:** define the smallest implementation that can validate Simple Loop and State Workflow against one shared agentic-chat contract. This is the architecture-validation MVP; the full production target is in [Agentic Chat Development Blueprint](agentic-chat-development-blueprint.md).

## 1. MVP decision goal

Answer one question: **can both architectures support the required agentic-chat interaction without changing the product contract?**

Run the same implementation and test suite twice:

1. `runtime = simple_loop`;
2. `runtime = state_workflow`.

Persist the selected runtime when the run is created. It is immutable after execution starts, and only the matching worker service may claim or resume that run.

MVP acceptance requires F01-F10 in the [Agentic Chat MVP Validation Test Plan](agentic-chat-mvp-validation-test-plan.md) to pass for both runtimes.

## 2. Scope and actors

| MVP concern | Required behavior |
| --- | --- |
| User | Send a message and receive the complete AI response atomically in the User view. |
| AI | Respond directly, load a skill, request a sync tool, or request an async tool. |
| Admin/HITL | Send a model-only command to the AI, or approve/reject an exact side-effect tool call. |
| Identity | Use one seeded User actor and one seeded Admin actor; no login or external authentication. |
| Skill | Load a versioned definition with instructions and an allowed-tool list. |
| Sync tool | Validate arguments, execute, return a structured result/error, and continue the run. |
| Async tool | Accept a job, expose progress, wait without holding a request open, and resume the run on completion. |
| Simple Loop | Persist enough run state to pause and resume the bounded loop. |
| State Workflow | Enforce legal states/transitions and resume from a durable checkpoint or history position. |
| Views | Provide separate User and Admin views with real-time lifecycle updates and no token-by-token AI response streaming. |
| Shared boundary | Use the same tRPC procedures, Zod contracts, tool registry, approval envelope, events, and Drizzle persistence model for both runtimes. |

Only these roles participate in the MVP:

| Role | Allowed actions |
| --- | --- |
| User | Send chat messages and receive User-visible AI responses and operation status. |
| AI | Select a loaded skill, request an allowed sync/async tool, consume results, and produce the final response. |
| Admin/HITL | Send an authorized model-only command at a safe boundary; approve or reject an exact side-effect tool call. |
| Tool runtime | Validate, execute, and report sync/async tool operations using stable call and job identities. |

### MVP identity model

The MVP has no authentication flow. Seed exactly two development actors:

```text
mvp_user   role=user
mvp_admin  role=admin
```

The `/user/*` route group always creates the fixed `mvp_user` server context. The `/admin/*` route group always creates the fixed `mvp_admin` server context. Do not add login, passwords, sessions, OIDC, account management, tenant selection, invitations, or role management to the MVP.

The server still keeps capabilities separate: User procedures receive the fixed User context and Admin procedures receive the fixed Admin context. This is deterministic role separation for architecture testing, not production authentication.

## 3. Technology stack

| Layer | MVP decision |
| --- | --- |
| Package manager | pnpm workspaces |
| API | Node.js + tRPC with Zod contracts |
| Web | React SPA built with Vite 8 |
| Bundler | Rolldown through Vite 8 |
| Styling | Tailwind CSS |
| SQL | Drizzle ORM + PostgreSQL |
| Async jobs | Redis + BullMQ |
| State Workflow | Temporal TypeScript SDK and local Temporal service |
| Quality | Biome for linting and formatting |

Do not add Next.js, React Server Components, or Next.js App Router conventions. The React SPA calls the Node tRPC API and subscribes to discrete lifecycle events.

## 4. Shared runtime contract

Both execution paths must use the same:

- command and Zod schemas;
- run and event schemas;
- provider interface;
- versioned skill/tool registry;
- role context and policy checks;
- approval envelope;
- message model;
- tool-operation ledger;
- job identity and status model;
- audit/event visibility conventions.

The runtime implementation may differ internally, but the externally observable event meaning and ordering must be equivalent.

## 5. Application and service boundary

Use one shared web SPA, one shared Node API, and one shared worker codebase. Split the UI by route and split the execution architectures by process:

```text
apps/web
  /user/*                     User view
  /admin/*                    Admin view

apps/api
  tRPC server                 Shared API for both runtimes

apps/worker
  simple-loop entry point     worker-simple service
  state-workflow entry point  worker-workflow service
```

This is the minimum split that gives a fair comparison:

- User and Admin views are route groups in the same React SPA because they share fixed actor-context construction, tRPC contracts, projections, and design primitives;
- one Node tRPC API admits commands and serves projections for both runtimes;
- Simple Loop and State Workflow are separate runtime modules behind one runner interface;
- both modules are built into the same worker image and started with different commands or environment configuration;
- each worker claims only runs assigned to its runtime and never falls back to the other executor;
- restarting one worker must not restart the web SPA, API, PostgreSQL, fixture worker, or other architecture worker.

Pages/routes alone are not enough because both architectures would still share one worker failure domain, preventing independent restart and recovery evidence. Separate full web/API/database stacks are also incorrect for the MVP because duplicated infrastructure would introduce differences unrelated to orchestration.

## 6. User and Admin views

The MVP requires two fixed-actor, role-specific views:

```text
apps/web/src/routes/
  user/chat                     User conversation and operation status
  admin/index                  Run inspection and hidden AI command
  admin/approvals              Pending approval decisions
```

### User view

- submit a prompt;
- select `simple_loop` or `state_workflow` for validation;
- display the User message, run status, tool status, job progress, and complete AI response;
- render no Admin-only data, hidden command content, or partial AI text.

### Admin view

- inspect active runs and runtime assignment;
- send a model-only command to a selected run;
- see pending approvals and exact prepared arguments;
- approve or reject the exact side-effect call;
- see hidden-command and approval status that is not projected to the User view.

### Real-time updates without response streaming

- Both views receive persisted lifecycle events as run, tool, approval, and job state changes.
- Use tracked tRPC SSE subscriptions for discrete events such as `run.status_changed`, `tool.call.started`, `tool.call.completed`, `tool.call.approval_required`, `job.progress`, `job.completed`, and `message.completed`.
- Do not emit or render `message.delta` in the MVP.
- Buffer provider text inside the worker, persist one complete AI message, then publish `message.completed` so the User view renders the response atomically.
- Reconnect by refetching canonical state and then continuing from the latest event ID.

## 7. Required MVP skills and tools

Keep the registry intentionally small. Every entry is versioned and schema-validated.

### Required skills

| Skill | Tools | Purpose |
| --- | --- | --- |
| `calculator_assistant@1` | `calculator.evaluate` | Deterministic read-only calculation. |
| `communication_assistant@1` | `notification.preview`, `notification.send_email` | Preview an email, then request Admin approval before sending. |
| `report_assistant@1` | `report.generate` | Start an asynchronous report job and resume after completion. |

### Required tool set

| Tool | Mode | Approval | Risk | Purpose |
| --- | --- | --- | --- | --- |
| `skill.load` | Sync | No | Read | Resolve a skill ID/version and attach its instructions and tool allowlist to the run. |
| `calculator.evaluate` | Sync | No | Read | Return a structured calculation result or typed error. |
| `notification.preview` | Sync | No | Read | Normalize and display the exact message that would be sent. |
| `notification.send_email` | Sync | **Yes, required** | High | Perform the only MVP external side effect after exact Admin/HITL approval. |
| `report.generate` | Async | No | Low | Accept a durable job, emit progress, and produce a report result. |
| `job.get_status` | Sync | No | Read | Reconcile canonical state after delayed events or worker restart. |

### Admin-only control operations

These are not ordinary AI-selected tools:

| Operation | Approval | Purpose |
| --- | --- | --- |
| `admin.command.send_hidden` | Fixed `mvp_admin` context | Apply a model-only instruction to the targeted run at a safe boundary. |
| `approvals.approve` | Fixed `mvp_admin` context | Permit the exact prepared side-effect call. |
| `approvals.reject` | Fixed `mvp_admin` context | Reject the exact prepared side-effect call and resume with a rejection result. |

The MVP has exactly one approval-gated tool: `notification.send_email`. No other side-effect, destructive, external-integration, file, browser, code-execution, or database-mutation tools are required.

## 8. MVP tRPC procedure subset

```text
conversations.get
chat.sendMessage
runs.list
runs.get
runs.events
admin.command.sendHidden
approvals.listPending
approvals.get
approvals.approve
approvals.reject
approvals.subscribe
jobs.get
skills.get
```

All procedures use the same Zod input/output schemas for both runtimes. The route group assigns procedure context:

```text
mvpUserProcedure   → fixed mvp_user actor
mvpAdminProcedure  → fixed mvp_admin actor
```

The runtime selector must not alter the command, event, tool-call, approval, or final-message contract.

## 9. MVP persistence

The MVP needs only these logical tables:

```text
users, roles
conversations, messages
runs, run_events
skills, skill_versions
tools, tool_versions, tool_calls
approval_requests, approval_actions
jobs, job_events
idempotency_keys
```

Persist the selected runtime before enqueue/claim. A worker cannot claim a run assigned to the other runtime. Persist enough state to recover a pending approval or accepted async job after worker restart.

## 10. Docker Compose development

`compose.yaml` is the supported way to start the architecture-validation environment:

| Service | Responsibility |
| --- | --- |
| `postgres` | Drizzle-backed conversations, runs, events, skills, tool calls, approvals, and jobs. |
| `redis` | BullMQ queues and delivery for the deterministic async tool. |
| `temporal` | Local durable workflow runtime for the State Workflow implementation. |
| `web` | Vite React SPA with shared User/Admin routes and runtime selection. |
| `api` | Node.js tRPC API, fixed actor contexts, command admission, and discrete event projection. |
| `worker-simple` | Executes only `simple_loop` runs. |
| `worker-workflow` | Runs the Temporal worker and executes only `state_workflow` runs. |
| `fixture-worker` | Consumes BullMQ jobs and publishes deterministic progress/completion through durable job records. |

Requirements:

- `docker compose up --build` starts the complete MVP;
- health checks gate app and worker startup on PostgreSQL, Redis, Temporal, and migration readiness;
- both runtime workers use the same worker image, contracts, registry, dependencies, resource limits, and database;
- named volumes preserve PostgreSQL state across ordinary restarts;
- fixture tools use no production credentials or external side effects;
- logs include `run_id`, `runtime`, `call_id`, `approval_id`, and `job_id`;
- restarting one runtime worker must support F10 without restarting the other worker, web, API, PostgreSQL, or fixture worker.

```text
docker compose up --build
docker compose restart worker-simple
docker compose restart worker-workflow
docker compose down
docker compose down --volumes  # explicit destructive reset of local test data
```

## 11. MVP implementation sequence

### MVP-0: comparison foundations

- strict TypeScript project and test runner;
- pnpm workspace, Biome, Vite/Rolldown React SPA, and Tailwind;
- Docker Compose topology for PostgreSQL, Redis/BullMQ, Temporal, web, and workers;
- fixed actor contexts;
- minimal Drizzle schema and reviewed migration;
- tRPC procedure subset with Zod contracts;
- shared command, event, run, skill, tool, approval, and job types;
- deterministic fake provider, sync tools, async fixture worker, and Admin/HITL fixture;
- `SimpleLoopExecutor` and `StateWorkflowExecutor` behind one coordinator interface;
- separate User/Admin routes with real-time lifecycle updates and atomic AI messages.

### MVP-1: behavior parity

- User-to-AI direct response;
- Admin-to-AI hidden command;
- versioned skill loading and tool allowlist;
- read-only sync tool with typed failure;
- approval-gated sync side-effect tool;
- async tool with acceptance, progress, completion, and same-run resume;
- restart smoke test after async acceptance;
- all F01-F10 flows in the validation test plan.

## 12. MVP definition of done

The MVP is complete when:

- F01-F10 pass for both runtimes;
- both runtimes produce equivalent final outcomes and lifecycle event meanings;
- the fixed User/Admin contexts remain separate without adding authentication;
- approval blocks `notification.send_email` until the Admin decision;
- skill allowlists block tools outside the selected skill;
- async work resumes the original run without duplicate logical execution;
- User and Admin views update from persisted lifecycle events;
- AI text appears only as one complete `message.completed` response;
- worker restart evidence shows no cross-runtime processing or duplicate job.

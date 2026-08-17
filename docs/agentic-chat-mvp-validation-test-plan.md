<!-- markdownlint-disable MD013 -->

# Agentic Chat MVP Validation Test Plan

> **Purpose:** determine whether both the Simple Loop and State Workflow architectures can support the same minimum agentic-chat contract. This is an architecture validation plan, not the full production feature plan.

Implementation scope and technical decisions are defined in the [Agentic Chat MVP Development Blueprint](agentic-chat-mvp-development-blueprint.md).

## 1. Validation scope

Run the same test suite twice:

1. with `runtime = simple_loop`;
2. with `runtime = state_workflow`.

Persist the selected runtime when the run is created. It is immutable after execution starts, and only the matching worker service may claim or resume that run.

The MVP validates only these actors and capabilities:

| Area | In scope |
| --- | --- |
| User | Uses the User view to send prompts and receive complete AI messages plus User-visible tool/job status. |
| AI | Responds directly or requests a skill/tool through the selected runtime. |
| Admin/HITL | Uses the Admin view to inspect runs, send an authorized model-only command, or approve/reject a specific tool call. |
| Identity | Uses one seeded User actor and one seeded Admin actor with no login or external authentication. |
| Tools | Return structured synchronous or asynchronous results. |
| Skills | Load versioned instructions and an allowlist of tools for the current run. |
| Simple Loop | Executes the shared contract through a bounded model/tool loop. |
| State Workflow | Executes the shared contract through explicit states and transitions. |
| Real-time UI | Delivers discrete run/tool/approval/job updates to both views without token-by-token AI response streaming. |

The following are intentionally deferred: files, retrieval, citations, memory, autocompaction, multi-agent delegation, parallel branches, tenant governance, advanced recovery, exports, sharing, and production deployment concerns.

## 2. Shared test fixtures

Use deterministic fake tools first. A provider-backed test can be added only after the orchestration suite passes.

### 2.1 Skills

#### `calculator_assistant@1`

```yaml
instructions: Always use calculator.evaluate for arithmetic requested by the user.
allowed_tools:
  - calculator.evaluate
```

#### `communication_assistant@1`

```yaml
instructions: Preview a message before requesting permission to send it.
allowed_tools:
  - notification.preview
  - notification.send_email
```

#### `report_assistant@1`

```yaml
instructions: Use report.generate for report requests and wait for its final result.
allowed_tools:
  - report.generate
```

### 2.2 Synchronous tools

#### `skill.load`

```yaml
input:  { skill_id: string, version: string }
output: { skill_id: string, version: string, instructions: string, allowed_tools: string[] }
risk: read
approval_required: false
```

`skill.load` is available before a skill is selected. A successful result is attached to the run and controls which AI-selected tools are exposed afterward. A missing version returns the typed error `SKILL_NOT_FOUND`.

#### `calculator.evaluate`

```yaml
input:  { expression: string }
output: { value: number }
risk: read
approval_required: false
```

Fixture behavior:

- `(125 * 8) + 40` returns `{ "value": 1040 }`;
- `10 / 0` returns the typed error `DIVISION_BY_ZERO`;
- every call records `call_id`, input, output/error, and invocation count.

#### `notification.preview`

```yaml
input:  { recipient: string, subject: string, body: string }
output: { preview_id: string, normalized_message: object }
risk: read
approval_required: false
```

#### `notification.send_email`

```yaml
input:  { preview_id: string }
output: { message_id: string, status: "sent" }
risk: high
approval_required: true
```

Fixture behavior:

- execution must not start before approval;
- approval is bound to the prepared `call_id` and arguments;
- rejection returns a structured tool result and performs no side effect;
- duplicate execution with the same `call_id` still records one sent message.

### 2.3 Asynchronous tool

#### `report.generate`

```yaml
input:  { topic: string, sections: string[] }
accepted: { job_id: string, status: "queued" }
progress: { job_id: string, percent: number, status: "running" }
output:   { job_id: string, report_id: string, status: "completed" }
risk: low
approval_required: false
```

Fixture behavior:

1. immediately returns `job_001` with `queued`;
2. emits progress at 50 percent;
3. completes with `report_001`;
4. emits each event with a stable event ID;
5. records one logical tool call even if a completion event is delivered twice.

#### `job.get_status`

```yaml
input:  { job_id: string }
output: { job_id: string, status: "queued" | "running" | "completed" | "failed", result?: object }
risk: read
approval_required: false
```

The runtime uses `job.get_status` to reconcile canonical async state after restart, a delayed event, or duplicate delivery. It does not start a new job.

### 2.4 Admin command fixture

Use `admin.command.send_hidden` for the Admin-to-AI flow:

```yaml
input:
  run_id: string
  instruction: string
  expires_at: timestamp
output:
  command_id: string
  status: "accepted"
visibility: model_only
approval_required: false
```

Fixture behavior:

- only the fixed `mvp_admin` context can submit it;
- the command is bound to the target `run_id` and applied at the next safe AI boundary;
- it is persisted in Admin/audit evidence but omitted from User-visible message and event projections;
- an expired, duplicated, or wrong-run command is not applied.

### 2.5 Approval matrix

| Tool or operation | Requires approval? | Required authority |
| --- | --- | --- |
| `skill.load` | No | Fixed `mvp_user` run context |
| `calculator.evaluate` | No | Selected skill allowlist |
| `notification.preview` | No | Selected skill allowlist |
| `notification.send_email` | **Yes** | Exact Admin/HITL approval bound to `call_id` and arguments |
| `report.generate` | No | Selected skill allowlist |
| `job.get_status` | No | Runtime-internal access to the run's job |
| `admin.command.send_hidden` | No second approval | Fixed `mvp_admin` context |
| `approvals.approve` / `approvals.reject` | No second approval | Fixed `mvp_admin` context |

The MVP has exactly one approval-gated tool: `notification.send_email`. This proves the pause/approve/reject/resume contract without adding unnecessary side-effect tools.

## 3. Required observable records

Each runtime may store state differently, but the test harness must be able to observe:

```text
run_id
runtime
actor for every input or decision
authorized Admin command metadata and application status
selected skill ID and version
AI response or tool-call request
tool name, call_id, validated arguments, and status
approval request and decision when applicable
async job_id and progress/final events when applicable
final run status
final User-visible response
User-view projection
Admin-view projection
```

Internal AI/tool messages do not need the same database shape in both implementations. They must have equivalent meaning and ordering.

### 3.1 Cross-view UI acceptance

Apply these assertions to every relevant flow:

- the User and Admin views load independent initial snapshots using the fixed `mvp_user` and `mvp_admin` contexts;
- persisted lifecycle changes appear in the appropriate view without a manual page refresh;
- the User view never renders partial AI text or a `message.delta` event;
- the AI response appears once, atomically, after `message.completed`;
- the Admin view shows active run state, hidden-command status, and pending approvals;
- hidden Admin command content and Admin-only decision metadata never appear in the User view;
- reconnecting either view refetches canonical state and does not duplicate messages or decisions.
- `worker-simple` and `worker-workflow` expose the same lifecycle contract while claiming only runs assigned to their runtime.

## 4. Prompt catalog

Execute every core prompt against both runtimes.

| ID | Capability | Actor | Prompt or action | Expected result |
| --- | --- | --- | --- | --- |
| P01 | Direct chat | User | `Reply with exactly CHAT_OK. Do not load a skill or call a tool.` | AI returns `CHAT_OK`; no skill or tool record exists. |
| P02 | Load skill | User | `Load calculator_assistant version 1. Tell me only the loaded skill ID and version. Do not calculate anything.` | `calculator_assistant@1` is recorded; no tool runs. |
| P03 | Skill plus sync tool | User | `Use calculator_assistant version 1 to calculate (125 * 8) + 40. You must use calculator.evaluate.` | Skill loads, tool returns `1040`, and AI reports `1040`. |
| P04 | Sync tool error | User | `Use calculator_assistant version 1 and calculator.evaluate to calculate 10 / 0.` | Tool returns `DIVISION_BY_ZERO`; AI explains failure without inventing a value. |
| P05 | Missing skill | User | `Load missing_skill version 1 and use it.` | Run returns a typed skill-not-found result; no tool runs. |
| P06 | Tool not allowed by skill | User | `Load calculator_assistant version 1, then send an email to qa@example.com.` | Runtime blocks the communication tools because the selected skill does not allow them. |
| P07 | Async tool | User | `Use report_assistant version 1 to generate a report about agentic chat with sections Summary and Recommendation. Use report.generate and wait for the final report.` | Job is accepted, progress is visible, completion resumes the AI, and final response references `report_001`. |
| P08 | HITL approval | User | `Use communication_assistant version 1 to email qa@example.com with subject MVP Test and body APPROVAL_OK.` | Preview succeeds; send pauses for Admin approval; approval resumes one send; AI confirms success. |
| P09 | HITL rejection | User | `Use communication_assistant version 1 to email qa@example.com with subject MVP Test and body REJECT_ME.` | Preview succeeds; send pauses; rejection causes no send; AI reports rejection. |
| P10 | Admin-to-AI command | Admin then User | Admin command: `For the next AI response in this run, reply with exactly ADMIN_GUIDANCE_OK.` User prompt: `Respond now.` | Authorized command is applied at the next safe AI boundary; AI returns `ADMIN_GUIDANCE_OK`; raw Admin content is not in the User transcript. |
| P11 | Async resume after runtime restart | User | Reuse P07, but stop the runtime after job acceptance and restart it before completion. | Run resumes from durable state, consumes the job result once, and completes without starting a second job. |

## 5. Detailed test flows

### F01: Direct User-to-AI chat

**Prompt:** P01

**Simple Loop path:**

```text
User message
→ persist input
→ invoke AI
→ persist final AI message
→ complete run
```

**State Workflow path:**

```text
RECEIVED
→ INTAKE
→ THINKING
→ RESPONDING
→ COMPLETED
```

**Pass criteria:**

- User and AI actors are attributed correctly;
- final text is `CHAT_OK`;
- the User view receives no partial AI text and renders `CHAT_OK` once after `message.completed`;
- zero skill loads and zero tool calls are recorded;
- run reaches one terminal completed state.

### F02: Load a skill without calling a tool

**Prompt:** P02

**Common flow:**

```text
User requests skill
→ runtime resolves calculator_assistant@1
→ runtime validates the skill definition
→ selected skill and allowed tools are attached to the run
→ AI confirms the selected version
```

**Pass criteria:**

- exactly `calculator_assistant@1` is loaded;
- the run records `calculator.evaluate` as the only allowed tool;
- no tool is invoked;
- the final response identifies the loaded skill and version.

### F03: Skill invokes a synchronous tool

**Prompt:** P03

**Simple Loop path:**

```text
User message
→ load calculator_assistant@1
→ AI requests calculator.evaluate
→ validate skill allowlist and tool arguments
→ execute tool synchronously
→ persist { value: 1040 }
→ return tool result to AI
→ AI responds
→ complete run
```

**State Workflow path:**

```text
RECEIVED
→ INTAKE
→ THINKING
→ PREPARING_TOOL
→ EXECUTING_SYNC_TOOL
→ THINKING
→ RESPONDING
→ COMPLETED
```

**Pass criteria:**

- one skill load and one tool call are recorded;
- tool arguments equal `{ "expression": "(125 * 8) + 40" }`;
- tool result is `1040`;
- AI uses the tool result rather than a conflicting generated value.

### F04: Synchronous tool returns a typed failure

**Prompt:** P04

**Common flow:**

```text
AI requests calculator.evaluate
→ runtime validates and executes the request
→ tool returns DIVISION_BY_ZERO
→ runtime records the failed tool result
→ AI receives the failure
→ AI explains that the calculation is undefined
```

**Pass criteria:**

- the run does not crash;
- the tool call has a failed terminal status and typed error;
- the AI does not claim a numeric result;
- the chat run finishes with a User-visible explanation.

### F05: Skill and tool authorization failures

Run P05 and P06 as separate cases.

**Pass criteria for P05:**

- missing skill produces a typed `SKILL_NOT_FOUND` result;
- no fallback skill is silently selected;
- no tool runs.

**Pass criteria for P06:**

- `calculator_assistant@1` loads successfully;
- `notification.preview` and `notification.send_email` are not exposed or executable;
- the AI tells the User the selected skill cannot perform the requested action;
- no approval request and no side effect are created.

### F06: Asynchronous tool completes and resumes the AI

**Prompt:** P07

**Simple Loop path:**

```text
User message
→ load report_assistant@1
→ AI requests report.generate
→ persist tool operation
→ start job and persist job_001
→ set run to waiting_for_tool
→ receive progress event
→ receive completion event
→ reload durable job state
→ persist tool result
→ resume the model/tool loop
→ AI references report_001
→ complete run
```

**State Workflow path:**

```text
RECEIVED
→ INTAKE
→ THINKING
→ PREPARING_TOOL
→ STARTING_ASYNC_TOOL
→ WAITING_FOR_TOOL
→ WAITING_FOR_TOOL on progress
→ THINKING on completion
→ RESPONDING
→ COMPLETED
```

**Pass criteria:**

- the initial request returns or streams a queued state without waiting for job completion;
- one `job_id` is correlated to one `call_id` and one `run_id`;
- 50 percent progress is observable;
- completion resumes the same run;
- AI final response references `report_001`;
- the job and tool each execute exactly once logically.

### F07: Admin/HITL approves a synchronous side effect

**Prompt:** P08

**Admin action:** approve the generated approval request without changing its arguments.

**Simple Loop path:**

```text
User message
→ load communication_assistant@1
→ run notification.preview
→ prepare notification.send_email
→ persist approval request
→ set run to waiting_for_admin
→ Admin approves the exact call
→ validate approval and execute once
→ persist sent result
→ resume AI
→ complete run
```

**State Workflow path:**

```text
RECEIVED
→ INTAKE
→ THINKING
→ PREPARING_TOOL
→ EXECUTING_SYNC_TOOL for preview
→ THINKING
→ PREPARING_TOOL for send
→ WAITING_FOR_ADMIN
→ EXECUTING_SYNC_TOOL on approval
→ THINKING
→ RESPONDING
→ COMPLETED
```

**Pass criteria:**

- the approval request identifies the Admin/HITL actor as the required decision maker;
- the request appears in the Admin view in real time and not as an actionable control in the User view;
- `notification.send_email` invocation count remains zero before approval;
- approval references the same `call_id` and arguments shown in the preview;
- the tool executes once after approval;
- the AI confirms the returned `message_id` and sent status.

### F08: Admin/HITL rejects a synchronous side effect

**Prompt:** P09

**Admin action:** reject the approval request with reason `MVP rejection test`.

**Common flow:**

```text
User requests email
→ AI previews email
→ runtime prepares send call
→ runtime pauses for Admin
→ Admin rejects
→ runtime records rejection as the tool result
→ AI resumes and reports that the email was not sent
```

**Pass criteria:**

- the rejection is attributed to the Admin actor and attached to the exact `call_id`;
- the Admin view updates the request to rejected and the User view receives only the resulting not-sent status;
- `notification.send_email` invocation count remains zero;
- the same run resumes after rejection;
- the User receives a clear not-sent result;
- the run completes rather than remaining stuck in an approval state.

### F09: Admin sends a model-only command to the AI

**Prompt/action:** P10

**Precondition:** create an active run and open the Admin view using the fixed `mvp_admin` context.

**Simple Loop path:**

```text
Admin submits command for the active run
→ authorize and persist model-only Admin event
→ apply command at the next safe model boundary
→ User sends "Respond now."
→ rebuild model context with authorized Admin guidance
→ AI returns ADMIN_GUIDANCE_OK
→ persist final AI message
→ complete run
```

**State Workflow path:**

```text
AdminCommand received
→ validate actor, target run, and command status
→ persist command event
→ INTAKE at the next safe boundary
→ UserMessage received
→ THINKING with authorized Admin guidance
→ RESPONDING
→ COMPLETED
```

**Pass criteria:**

- the command is attributed to `mvp_admin` and the target `run_id`;
- the command is persisted before it is applied;
- a request carrying the fixed `mvp_user` context cannot call the Admin procedure;
- the AI returns exactly `ADMIN_GUIDANCE_OK`;
- the raw Admin command is available in Admin/audit evidence but absent from the User-visible transcript and stream;
- the Admin view shows accepted/applied status while the User view shows only the resulting AI message;
- the command changes model guidance only and does not bypass skill/tool authorization.

### F10: Resume an async call after runtime restart

**Prompt:** P11

**Failure injection:** restart only `worker-simple` or `worker-workflow`, matching the selected runtime, after `job_001` is durably accepted and before its completion event is handled. Keep the web SPA, Node API, PostgreSQL, Redis, Temporal, fixture worker, and other runtime worker running.

**Common flow:**

```text
job_001 accepted
→ persist run/call/job correlation
→ stop runtime worker
→ report.generate completes
→ restart runtime worker
→ reload pending run
→ query job.get_status(job_001)
→ reconcile or consume completion
→ resume AI
→ complete the original run
```

**Pass criteria:**

- the original `run_id`, `call_id`, and `job_id` are reused;
- no second async job is created;
- the completed tool result is delivered to the AI once;
- both architectures produce a final response referencing `report_001`;
- the architecture-specific state is inspectable after restart.
- the other architecture worker remains healthy and never claims the interrupted run.

## 6. Runtime-specific assertions

### 6.1 Simple Loop

The Simple Loop passes the architecture validation when:

- every AI/tool iteration is bounded by a maximum turn count;
- waiting for Admin or an async tool releases the active worker;
- a persisted run can rebuild its selected skill, pending approval, or pending job;
- a tool result resumes the same loop rather than creating a new chat run;
- completed tool calls are not repeated during resume.

### 6.2 State Workflow

The State Workflow passes the architecture validation when:

- every observed transition is legal for the current state;
- HITL pauses in `WAITING_FOR_ADMIN` and async work pauses in `WAITING_FOR_TOOL`;
- external events correlate to the active workflow and pending operation;
- worker restart restores the checkpoint/history and continues from the correct boundary;
- completed tool nodes or activities are not repeated during replay.

## 7. Acceptance matrix

Record one result for each cell.

| Test | Simple Loop | State Workflow | Required evidence |
| --- | --- | --- | --- |
| F01 Direct chat | Pending | Pending | Actor records, atomic final message, terminal state |
| F02 Load skill | Pending | Pending | Skill ID/version, allowed-tool snapshot |
| F03 Sync success | Pending | Pending | Tool call/result and final response |
| F04 Sync failure | Pending | Pending | Typed error and final response |
| F05 Authorization | Pending | Pending | Rejection record and zero prohibited calls |
| F06 Async success | Pending | Pending | Job acceptance, progress, completion, resume |
| F07 HITL approve | Pending | Pending | Admin-view approval, one side effect, final response |
| F08 HITL reject | Pending | Pending | Admin-view rejection, zero side effects, final response |
| F09 Admin command | Pending | Pending | Admin-view command, AI response, hidden User projection |
| F10 Restart/resume | Pending | Pending | Stable IDs, one job, resumed completion |

Allowed result values are `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN`. `BLOCKED` must include the missing dependency or fixture.

## 8. Architecture validation decision

An architecture is **viable for the MVP** only when all F01-F10 tests pass for that runtime.

After both runs, compare:

| Measure | How to record it |
| --- | --- |
| Correctness | Passed flows out of ten |
| Implementation effort | Runtime-specific source lines and test-fixture complexity |
| Latency | Median and p95 for F01 and F03 |
| Async overhead | Time from job completion to AI resume in F06 |
| HITL overhead | Time from Admin decision to AI resume in F07/F08 |
| Recovery | Time to final response after restart in F10 |
| Inspectability | Whether current actor, skill, tool, approval/job, and state are visible |
| UI delivery | Whether both views update live and AI text appears only as a complete message |

Do not choose an architecture from model answer quality alone. The decision should be based on whether both runtimes satisfy the same behavioral contract and on the measured complexity, latency, and recovery tradeoffs.

## 9. Test execution record

Copy this block for every runtime/test pair:

```text
Test ID:
Runtime: simple_loop | state_workflow
Date:
Build/commit:
Model or deterministic provider:
Run ID:
Prompt ID:
Observed skill:
Observed tool calls:
Observed approval/job events:
Final response:
Result: PASS | FAIL | BLOCKED | NOT RUN
Failure details:
Evidence links:
```

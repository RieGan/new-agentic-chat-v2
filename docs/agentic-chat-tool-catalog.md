<!-- markdownlint-disable MD013 -->

# Agentic Chat Sample Tool Catalog

> Sample tools for the Simple Loop and State Workflow implementations. These are interface examples, not final implementations.

## Tool metadata

Every tool should define:

```text
tool_id
version
description
input_schema
output_schema
execution_mode: sync | async | workflow
risk_level: read | low | medium | high | destructive
approval_policy
timeout
retry_policy
idempotency_policy
required_capabilities
```

## 1. Conversation and context tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `conversation.get_context` | Sync | Read | Load relevant conversation context. |
| `conversation.search_history` | Sync | Read | Find previous messages by keyword or date. |
| `conversation.create_branch` | Sync | Low | Explore an alternative response path. |
| `conversation.summarize` | Workflow | Low | Create a durable summary for a long conversation. |
| `context.compact` | Workflow | Low | Compact old context while preserving active work. |
| `memory.search` | Sync | Read | Retrieve permitted user, project, or tenant memories. |
| `memory.save` | Sync | Medium | Save an explicit user preference or fact. Usually requires confirmation. |
| `memory.update` | Sync | Medium | Correct an existing memory. |
| `memory.delete` | Sync | Destructive | Delete a memory or disable memory persistence. |

### Example: memory

```text
User: Remember that I prefer concise explanations.
AI → memory.save({
  scope: "user",
  key: "response_style",
  value: "concise explanations"
})
```

## 2. Search and retrieval tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `search.web` | Sync | Read | Search current public web information. |
| `search.fetch_page` | Sync | Read | Fetch and extract a permitted URL. |
| `search.organization` | Sync | Read | Search tenant-approved knowledge sources. |
| `search.conversation` | Sync | Read | Search the current user’s conversations. |
| `search.files` | Sync | Read | Search uploaded files with permission filters. |
| `search.compare_sources` | Sync | Read | Compare retrieved sources and identify conflicts. |
| `search.create_citations` | Sync | Low | Attach source/page/section references to answer claims. |
| `search.refresh_index` | Async | Low | Re-index a knowledge base after file changes. |

### Example: retrieval

```text
User: Find the latest policy update and summarize the changes.
AI → search.web({
  query: "latest policy update",
  freshness_days: 30,
  max_results: 5
})
AI → search.fetch_page({ url: "https://example.com/policy" })
AI → search.create_citations({ source_ids: ["src_001"] })
```

## 3. File and document tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `file.get_metadata` | Sync | Read | Read file name, type, size, and processing status. |
| `file.extract_text` | Async | Low | Extract text from PDF, DOCX, or spreadsheet. |
| `file.ocr` | Async | Low | Extract text from scanned images or documents. |
| `file.search` | Sync | Read | Search indexed file content. |
| `file.get_page` | Sync | Read | Retrieve one permitted page or section. |
| `file.create_summary` | Workflow | Low | Create a durable document summary. |
| `file.create_table` | Workflow | Low | Extract structured rows from a document. |
| `file.export_result` | Async | Low | Generate a downloadable report or export. |
| `file.delete` | Sync | Destructive | Delete a file and its derived indexes. Requires approval/policy. |

### Example: files

```text
User: Analyze this PDF and list the top five risks.
AI → file.get_metadata({ file_id: "file_123" })
AI → file.extract_text({ file_id: "file_123" })
AI → file.search({ file_id: "file_123", query: "risk" })
AI → file.create_summary({ file_id: "file_123", format: "risk_table" })
```

## 4. Calculation and coding tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `calculator.evaluate` | Sync | Read | Evaluate a bounded mathematical expression. |
| `data.aggregate` | Sync | Read | Group, filter, and summarize permitted data. |
| `code.run_sandbox` | Async | Medium | Execute code in an isolated sandbox. |
| `code.test_patch` | Async | Medium | Run tests against a proposed code change. |
| `code.search_repository` | Sync | Read | Search an authorized repository. |
| `code.create_patch` | Sync | Medium | Produce a patch without applying it. |
| `code.apply_patch` | Sync | High | Apply a code change. Requires approval and branch protection. |
| `database.query_readonly` | Sync | Read | Run an allowlisted read-only query. |
| `database.migrate` | Workflow | Destructive | Apply a reviewed database migration. Requires Admin approval. |

### Example: calculation

```text
User: Calculate the monthly growth rate.
AI → calculator.evaluate({
  expression: "(120 - 100) / 100 * 100"
})
```

## 5. Communication tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `notification.preview` | Sync | Read | Preview an email, message, or notification. |
| `notification.send_email` | Sync | High | Send an email after approval. |
| `notification.send_slack` | Sync | High | Send a Slack message after approval. |
| `notification.create_ticket` | Sync | Medium | Create a support or engineering ticket. |
| `notification.schedule` | Async | Medium | Schedule a future notification. |
| `notification.cancel` | Sync | Medium | Cancel a scheduled notification. |

### Example: notification

```text
User: Email the report to the finance team.
AI → notification.preview({
  recipients: ["finance@example.com"],
  subject: "Monthly report",
  body_ref: "artifact_123"
})
AI → approval.requested
User/Admin → approvals.approve({ approval_id: "approval_123" })
AI → notification.send_email({
  recipients: ["finance@example.com"],
  artifact_id: "artifact_123",
  idempotency_key: "run_123-call_456"
})
```

## 6. Business and external-system tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `crm.get_customer` | Sync | Read | Read a permitted customer record. |
| `crm.update_customer` | Sync | Medium | Update a customer record after policy validation. |
| `billing.get_invoice` | Sync | Read | Read invoice details. |
| `billing.create_refund` | Sync | Destructive | Create a refund with approval and idempotency. |
| `order.get_status` | Sync | Read | Read order status. |
| `order.cancel` | Sync | High | Cancel an order after approval. |
| `calendar.find_slots` | Sync | Read | Find available calendar slots. |
| `calendar.create_event` | Sync | Medium | Create a calendar event after confirmation. |
| `calendar.cancel_event` | Sync | High | Cancel an event after confirmation. |
| `integration.webhook_status` | Sync | Read | Inspect an external operation. |
| `integration.start_import` | Async | Medium | Start a long-running import. |

### Example: business action

```text
User: Refund invoice INV-123.
AI → billing.get_invoice({ invoice_id: "INV-123" })
AI → approval.requested({
  action: "create_refund",
  target: "INV-123",
  amount: 500000,
  currency: "IDR"
})
Admin → approvals.approve({ approval_id: "approval_456" })
AI → billing.create_refund({
  invoice_id: "INV-123",
  amount: 500000,
  idempotency_key: "run_123-call_789"
})
```

## 7. Workflow and async tools

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `workflow.start` | Workflow | Low | Start a durable workflow and return a handle. |
| `workflow.get_status` | Sync | Read | Read workflow state and progress. |
| `workflow.pause` | Sync | Medium | Pause at a safe workflow boundary. |
| `workflow.resume` | Sync | Medium | Resume a paused workflow. |
| `workflow.cancel` | Sync | Medium | Request cooperative cancellation. |
| `workflow.retry_step` | Workflow | Medium | Retry a failed step under policy. |
| `workflow.submit_event` | Sync | Medium | Deliver a webhook, approval, or external response. |
| `workflow.reconcile` | Workflow | Medium | Resolve an unknown external operation. |
| `job.get_status` | Sync | Read | Read canonical job state. |
| `job.cancel` | Sync | Medium | Cancel a queued or running job. |

### Example: workflow

```text
User: Import all transactions from last year.
AI → workflow.start({
  workflow: "transaction_import",
  input: { year: 2025 }
})
AI → returns { workflow_id: "wf_123", status: "queued" }
AI → workflow.get_status({ workflow_id: "wf_123" })
```

## 8. Admin and operator tools

These tools must be available only through authorized tRPC Admin/Operator procedures. They are not ordinary User tools.

| Tool | Mode | Risk | Usage |
| --- | --- | --- | --- |
| `admin.run.inspect` | Sync | Read | Inspect run state, events, steps, and blockers. |
| `admin.run.pause` | Sync | Medium | Pause a run at a safe boundary. |
| `admin.run.resume` | Sync | Medium | Resume a paused or recovered run. |
| `admin.run.cancel` | Sync | High | Cancel a run and record reason. |
| `admin.run.retry_step` | Workflow | Medium | Retry a selected failed step. |
| `admin.run.reconcile` | Workflow | High | Resolve an unknown side effect. |
| `admin.command.send_hidden` | Sync | High | Send a signed model-only Admin instruction. |
| `admin.tool.disable` | Sync | High | Disable a tool for a tenant or globally. |
| `admin.tool.rotate_version` | Sync | High | Pin or roll out a tool version. |
| `admin.policy.update` | Sync | High | Update authorization or approval policy. |
| `admin.audit.export` | Async | Medium | Export a scoped audit package. |
| `admin.tenant.quarantine` | Sync | Destructive | Stop execution for a tenant. |
| `admin.kill_switch.enable` | Sync | Critical | Disable side effects or a provider immediately. |

## 9. Skill examples

Skills compose tools into reusable capabilities:

| Skill | Tools commonly used | Runtime |
| --- | --- | --- |
| `document_analyst` | file.extract_text, file.search, search.create_citations | Simple Loop or Workflow |
| `research_assistant` | search.web, search.fetch_page, search.compare_sources | Simple Loop |
| `report_generator` | file.search, data.aggregate, file.create_summary, file.export_result | State Workflow |
| `customer_support` | crm.get_customer, order.get_status, notification.create_ticket | Simple Loop |
| `refund_processor` | billing.get_invoice, billing.create_refund, approval.requested | State Workflow |
| `calendar_assistant` | calendar.find_slots, calendar.create_event, notification.send_email | Simple Loop |
| `data_importer` | file.get_metadata, file.extract_text, integration.start_import | State Workflow |
| `code_reviewer` | code.search_repository, code.run_sandbox, code.create_patch | Simple Loop or Workflow |
| `release_operator` | code.test_patch, code.apply_patch, workflow.start, approval.requested | State Workflow |
| `tenant_operator` | admin.run.inspect, admin.tool.disable, admin.audit.export | Admin only |

## 10. Simple Loop versus State Workflow usage

| Tool category | Simple Loop | State Workflow |
| --- | --- | --- |
| Read-only lookup | Preferred | Usually unnecessary |
| Short calculation | Preferred | Unnecessary |
| One search/fetch | Preferred | Unnecessary |
| One approval then action | Possible with durable run record | Preferred when approval may be delayed |
| File parsing/indexing | Only short bounded task | Preferred |
| Multi-step report | Possible but harder to recover | Preferred |
| External import | Not recommended | Preferred |
| Refund/purchase/delete | Only with strong ledger/reconciliation | Preferred |
| Notifications | Sync for one message; async for scheduled/bulk | Preferred for bulk/scheduled |
| Admin recovery | Possible with command ledger | Preferred for complex recovery |
| Parallel analysis | Limited | Preferred with explicit join |

## 11. Example tool schema

```json
{
  "tool_id": "billing.create_refund",
  "version": "2",
  "description": "Create a refund for an approved invoice.",
  "execution_mode": "sync",
  "risk_level": "destructive",
  "input_schema": {
    "type": "object",
    "required": ["invoice_id", "amount", "currency", "idempotency_key"],
    "properties": {
      "invoice_id": { "type": "string" },
      "amount": { "type": "integer", "minimum": 1 },
      "currency": { "type": "string", "enum": ["IDR", "USD"] },
      "idempotency_key": { "type": "string" }
    }
  },
  "approval_policy": {
    "required": true,
    "roles": ["operator", "finance_admin"],
    "expires_after_seconds": 900
  },
  "retry_policy": {
    "max_attempts": 2,
    "retryable_errors": ["timeout", "provider_503"]
  }
}
```

## 12. Implementation rules

1. Define tools with Zod input/output schemas.
2. Register tools through the shared Tool Registry.
3. Expose only tenant- and actor-authorized tools to the model.
4. Validate model-generated arguments before authorization and again before execution.
5. Store every logical call in the Drizzle/PostgreSQL tool ledger.
6. Use stable idempotency keys for side effects.
7. Require approval according to risk policy.
8. Keep async job state in PostgreSQL; use BullMQ or Temporal for execution.
9. Emit structured events for tool start, approval, progress, completion, and failure.
10. Never allow a tool result or retrieved document to change authorization policy.
11. Keep Admin tools out of the User tool catalog.
12. Version tool schemas and pin the version for active runs.

## 13. Suggested first implementation set

Build these first:

1. `search.web` — sync, read-only.
2. `file.get_metadata` — sync, read-only.
3. `file.extract_text` — async, low risk.
4. `file.search` — sync, read-only.
5. `search.create_citations` — sync, low risk.
6. `notification.preview` — sync, read-only.
7. `notification.send_email` — sync, approval required.
8. `workflow.start` — workflow, low risk.
9. `workflow.get_status` — sync, read-only.
10. `workflow.cancel` — sync, medium risk.
11. `admin.run.inspect` — Admin only.
12. `admin.command.send_hidden` — Admin only, signed and audited.

This set proves the core platform: read tools, async work, citations, side-effect approval, State Workflow, cancellation, Admin control, and shared event handling.

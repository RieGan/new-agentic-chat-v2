<!-- markdownlint-disable MD013 -->

# Agentic Chat Architecture Research

This decision package evaluates two orchestration methods for an agentic-chat product with:

- User and AI conversation;
- hidden Admin-to-LLM instructions;
- Admin/HITL approvals;
- reusable skills;
- synchronous and asynchronous tools;
- autocompaction;
- crash recovery and resumable execution.

## Documents

1. [Simple Loop Architecture](simple-loop-architecture.md)
   - bounded model/tool loop;
   - durable run envelope and ordered event log;
   - tool ledger, outbox/inbox, leases, and reconciliation;
   - async job, HITL, hidden Admin command, compaction, and restart recovery.

2. [State Workflow Architecture](state-workflow-architecture.md)
   - explicit states, events, guards, nodes, and subworkflows;
   - graph checkpoints versus durable workflow runtimes;
   - HITL, hidden Admin control, async events, parallel joins, replay, migration, and operations.

3. [Method Comparison and Recommendation](agentic-chat-method-comparison.md)
   - side-by-side tradeoffs;
   - pure Simple Loop, pure State Workflow, and Hybrid choices;
   - decision scorecard and hard selection rules;
   - benchmark scenarios, reliability gates, and product recommendation.

## Short recommendation

Use **State Workflow on a durable workflow runtime** as the evidence-supported default while the workload split is unknown.

Choose a **Hybrid architecture** if measurements show that most turns are short and only a minority cross a durable boundary:

- keep direct answers and short, low-risk tools in a bounded Simple Loop;
- move long-running, approval-heavy, multi-stage, or restart-critical work into a State Workflow on a durable workflow runtime;
- share event, command, approval, tool-operation, audit, and compaction contracts across both.

If exactly one method must be selected, use **State Workflow on a durable workflow runtime** because restart recovery is explicit and this option provides stronger structural support for asynchronous work and approvals.

Start with the [comparison document](agentic-chat-method-comparison.md), then use each method document as an implementation reference.

# Problems — agentic-chat-mvp-vercel-ai-sdk

Unresolved blockers and technical debt discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-17 - Wait transition persistence boundary

- `releaseForSimpleLoopWait` and `enterStateWorkflowWait` build `run.status_changed` rows directly rather than parsing them through `CanonicalEventSchema`. Current production callers enter waits from `running`, but a direct internal caller can persist an illegal transition; a future DB-boundary hardening task should validate these events before insert.

## 2026-08-17 - Resolved: wait transition persistence boundary

- Failing-first direct internal-call tests reproduced illegal `queued -> waiting_for_tool` and `queued -> waiting_for_admin` persistence in both helpers.
- Both helpers now call `assertRunTransition` and parse the resulting `run.status_changed` value through `CanonicalEventSchema` before updating the run or inserting the event. The transaction rolls back without state or event changes on an illegal transition.

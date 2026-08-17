# Task 04 migration gate validation

- The test override removed the migration completion sentinel while PostgreSQL, Redis, and Temporal remained healthy.
- Migration reached `unhealthy`; see `migration-health.json`.
- Starting web, API, and all workers failed with `dependency failed to start: container new-agentic-chat-v2-migration-1 is unhealthy`; see `app-start-attempt.log`.
- `blocked-services-after-app-start.json` records all five gated services in `Created`, never `Running`, and `app-logs.txt` is empty. No application process reached a schema access path.
- Restoring the normal migration entrypoint reran the idempotent migration and seed, then all nine services returned healthy.

#!/bin/sh
set -eu

service_kind="${1:?service kind is required}"

case "$service_kind" in
  web)
    [ "$#" -eq 1 ] || { echo "web accepts no role" >&2; exit 64; }
    [ "${SERVICE_KIND:-}" = "web" ] || { echo "SERVICE_KIND must be web" >&2; exit 64; }
    exec pnpm --filter @agentic-chat/web dev --host 0.0.0.0 --port 4173
    ;;
  api)
    [ "$#" -eq 1 ] || { echo "api accepts no role" >&2; exit 64; }
    [ "${SERVICE_KIND:-}" = "api" ] || { echo "SERVICE_KIND must be api" >&2; exit 64; }
    mkdir -p /run/agentic-chat/http/healthz
    printf '%s\n' '{"service":"api","status":"scaffold_ready"}' > /run/agentic-chat/http/index.html
    printf '%s\n' '{"status":"ready","scope":"infrastructure_scaffold"}' > /run/agentic-chat/http/healthz/index.html
    exec busybox httpd -f -p 3000 -h /run/agentic-chat/http
    ;;
  worker)
    worker_role="${2:?worker role is required}"
    [ "$#" -eq 2 ] || { echo "worker accepts exactly one role" >&2; exit 64; }
    [ "${WORKER_ROLE:-}" = "$worker_role" ] || { echo "WORKER_ROLE must match the command role" >&2; exit 64; }
    case "$worker_role" in
      simple_loop)
        expected_kind="worker-simple"
        ;;
      state_workflow)
        expected_kind="worker-workflow"
        ;;
      fixture_jobs)
        expected_kind="fixture-worker"
        ;;
      *)
        echo "unsupported worker role: $worker_role" >&2
        exit 64
        ;;
    esac
    [ "${SERVICE_KIND:-}" = "$expected_kind" ] || { echo "SERVICE_KIND does not match worker role" >&2; exit 64; }
    mkdir -p /run/agentic-chat
    rm -f /run/agentic-chat/worker-ready
    exec node --conditions=production --enable-source-maps /workspace/packages/runtime/dist/compose-worker.js "$worker_role"
    ;;
  *)
    echo "unsupported service kind: $service_kind" >&2
    exit 64
    ;;
esac

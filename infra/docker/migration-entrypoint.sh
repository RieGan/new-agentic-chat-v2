#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

readiness_dir=/run/agentic-chat
readiness_file="$readiness_dir/migrations-complete"
mkdir -p "$readiness_dir"
rm -f "$readiness_file"

pnpm --filter @agentic-chat/db db:migrate
pnpm --filter @agentic-chat/db db:seed
touch "$readiness_file"
echo "database migration and deterministic seed complete"

exec sleep infinity

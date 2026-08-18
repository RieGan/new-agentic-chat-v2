# Agentic Chat MVP

Agentic Chat MVP is a full-stack chat application for testing agent workflows across two runtime implementations:

- `simple_loop`: a direct agent execution loop
- `state_workflow`: a durable Temporal-backed workflow

The application includes chat, tool execution, asynchronous jobs, human approval flows, Admin controls, PostgreSQL persistence, Redis, Temporal, and browser-based acceptance coverage.

## Prerequisites

- Docker with Docker Compose v2
- Node.js 22.12 or newer
- Corepack and pnpm 11.21.0 for local checks and tests

Enable the repository's pinned pnpm version:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

## Quick start

Start the complete application stack:

```bash
docker compose up --build --wait
```

The base Compose configuration uses a deterministic mock AI provider. No API key is required.

Once all services are healthy, open:

- Web application: <http://127.0.0.1:4173>
- API health endpoint: <http://127.0.0.1:3000/healthz>
- Temporal server: `127.0.0.1:7233`

Inspect service status or logs with:

```bash
docker compose ps
docker compose logs --follow
```

## Using the application

Use the runtime selector in the application to exercise either `simple_loop` or `state_workflow`.

The deterministic Compose provider supports these example flows:

### Create an asynchronous report

Send this message in chat:

```text
TASK18 report demo-report
```

### Create an approval request

Send this message in chat:

```text
TASK18 approval demo-approval
```

Then review the request from the Admin approval page:

<http://127.0.0.1:4173/admin/approvals>

Approving the request executes the protected action once. Rejecting it records that the action was not executed.

## Services

The Compose stack starts:

| Service | Purpose |
| --- | --- |
| `web` | Browser application and API proxy |
| `api` | tRPC API and health endpoint |
| `worker-simple` | `simple_loop` runtime worker |
| `worker-workflow` | `state_workflow` Temporal worker |
| `fixture-worker` | Durable fixture-job worker |
| `postgres` | Application persistence |
| `redis` | Runtime coordination |
| `temporal` | Durable workflow engine |
| `migration` | Database migration gate |

Application services start only after their required infrastructure and database migrations are healthy.

## Live OpenAI mode

The default mock mode is recommended for local development and repeatable testing. To use an OpenAI-compatible Responses API, create a local environment file:

```bash
cp .env.example .env.local
```

Set the required values in `.env.local`:

```dotenv
AI_PROVIDER_MODE=openai_responses
OPENAI_MODEL_ID=your-model-id
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key
```

Start Compose with the live override:

```bash
docker compose \
  -f compose.yaml \
  -f compose.live.yaml \
  --env-file .env.local \
  up --build --wait
```

`.env.local` is local-only and must not be committed.

## Quality checks

Run formatting, linting, type checking, and the workspace build:

```bash
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

`format` modifies files. Use `lint` when you only want a non-mutating check.

## Tests

### Contracts and database

```bash
corepack pnpm test:contracts
corepack pnpm test:db
```

### Runtime and API integration

```bash
corepack pnpm test:integration
corepack pnpm test:temporal-replay
```

### Acceptance tests

Run the F01-F10 acceptance matrix for each runtime:

```bash
corepack pnpm test:e2e --runtime=simple_loop
corepack pnpm test:e2e --runtime=state_workflow
```

Run the supporting recovery and parity suites:

```bash
corepack pnpm test:restart
corepack pnpm test:parity
corepack pnpm test:acceptance:harness-negative
```

### Real-Compose browser tests

Start the stack first:

```bash
docker compose up --build --wait
```

Then run the browser suite against the actual Compose services:

```bash
corepack pnpm test:compose-browser --runtime=simple_loop
corepack pnpm test:compose-browser --runtime=state_workflow
```

These tests use the running web application, API, PostgreSQL, Temporal, and runtime workers rather than the UI fixture server.

## Stop and reset

Stop the stack while retaining PostgreSQL data:

```bash
docker compose down --remove-orphans
```

Stop the stack and delete its persisted database volume:

```bash
docker compose down --volumes --remove-orphans
```

## Troubleshooting

### A service does not become healthy

Check status and inspect the failing service:

```bash
docker compose ps
docker compose logs <service-name>
```

The API and workers intentionally remain unavailable if migrations or required infrastructure are unhealthy.

### Ports are already in use

The stack binds these loopback ports:

- `4173`: web application
- `3000`: API
- `7233`: Temporal

Stop the conflicting process or another copy of this stack before restarting Compose.

### Rebuild after source changes

```bash
docker compose up --build --wait
```

### Return to deterministic mode

Stop the live-provider stack and start only the base configuration:

```bash
docker compose -f compose.yaml -f compose.live.yaml down --remove-orphans
docker compose up --build --wait
```

## Additional documentation

- [`docs/compose-remediation-and-regression.md`](docs/compose-remediation-and-regression.md): Compose remediation and regression evidence
- [`docs/issues/`](docs/issues/): resolved issue records
- [`.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md`](.omo/plans/agentic-chat-mvp-vercel-ai-sdk.md): MVP requirements and verification matrix

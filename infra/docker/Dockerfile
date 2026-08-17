FROM node:22.22.0-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends busybox wget \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@11.21.0

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm --filter @agentic-chat/contracts build \
  && pnpm --filter @agentic-chat/tools build \
  && pnpm --filter @agentic-chat/db build \
  && pnpm --filter @agentic-chat/runtime build \
  && pnpm --filter @agentic-chat/web build \
  && chmod +x /workspace/infra/docker/*.sh

ENTRYPOINT ["/workspace/infra/docker/service-entrypoint.sh"]

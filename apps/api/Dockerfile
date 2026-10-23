# One image for both the API and the SLA worker (different start commands).
# Build context is the repository root, because the API depends on the
# shared workspace package.

# ---- base: Node + OpenSSL (required by Prisma's query engine) ----
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- build: install everything, compile TypeScript, then drop dev deps ----
FROM base AS build
# Manifests first, so the dependency layer is cached until they change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
# postinstall builds the shared package and generates the Prisma client.
RUN npm ci
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w @sliqdesk/api \
  && npm prune --omit=dev

# ---- runtime: production dependencies + compiled output only ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist
# Not named docker-entrypoint.sh: the node base image already uses that name
# for its ENTRYPOINT wrapper, and overwriting it would make every container
# (including the worker) ignore its command.
COPY apps/api/start-api.sh /usr/local/bin/start-api.sh
RUN chmod +x /usr/local/bin/start-api.sh

WORKDIR /app/apps/api
# Run as the unprivileged user that the node image provides.
USER node
EXPOSE 4000
# Default command = the API. The worker service overrides it in compose.
CMD ["start-api.sh"]

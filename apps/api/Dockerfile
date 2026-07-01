# NestJS API. Multi-stage pnpm-workspace build; build context is the repo root.
# In production the API runs in remote-inference mode (CREPE_INFERENCE_URL /
# BASIC_PITCH_INFERENCE_URL set), so it ships NO model files — inference lives in
# the per-model services.
FROM node:22-bookworm-slim AS build
ENV CI=1
RUN corepack enable
WORKDIR /repo

# Manifests first for layer caching. Every workspace package.json must be present
# for --frozen-lockfile, even ones we don't build. The root tsconfigs are needed
# because apps/api/tsconfig.json extends ../../tsconfig.base.json (skipLibCheck etc.).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/inference-proto/package.json packages/inference-proto/
# Install only the API's subtree (its deps incl. the linked @mushee/inference-proto).
RUN pnpm install --frozen-lockfile --filter @mushee/api...

COPY packages/inference-proto packages/inference-proto
COPY apps/api apps/api
RUN pnpm --filter @mushee/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# rclone: the storage layer shells out to it for MusicXML files. Point
# RCLONE_REMOTE at a real remote (configurable via RCLONE_CONFIG_<NAME>_* env
# vars) or at a plain directory path for volume-backed local storage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo/apps/api
# pnpm's node_modules is a symlink farm into /repo/node_modules/.pnpm; copying the
# whole tree at the same path keeps every link (incl. @mushee/inference-proto,
# whose inference.proto is resolved at runtime) valid.
COPY --from=build /repo /repo
EXPOSE 3000
CMD ["node", "dist/main"]

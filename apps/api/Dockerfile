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
# Assemble the runtime tree with `pnpm deploy`: the API's own files (dist, the
# model dirs, package.json) plus a node_modules holding ONLY its production
# dependencies — workspace packages (@mushee/inference-proto and its .proto)
# copied in, not linked. Copying /repo wholesale instead shipped the whole
# workspace's virtual store: Next.js, its SWC binaries and other web-only
# packages (~400 MB), TypeScript, vitest, the Nest CLI, plus the TypeScript
# sources — none of which the API runs. (`pnpm prune --prod` is not a fix: on a
# filtered workspace install it emptied apps/api/node_modules — 2026-09-05.)
RUN rm -rf apps/api/src \
    && pnpm --filter @mushee/api deploy --prod /deploy

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Blob storage runs in-process (GCS client or local filesystem — see
# STORAGE_DRIVER); only CA certs are needed for outbound TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Model dirs and storage default to paths relative to the working directory
# (see recordings.service.ts / storage.service.ts), so the app runs from its own root.
COPY --from=build /deploy /app
# Run as the image's unprivileged user: the API shells out to ffmpeg on
# untrusted audio, so a decoder exploit must not land as root.
USER node
EXPOSE 3000
CMD ["node", "dist/main"]

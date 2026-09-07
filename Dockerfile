# syntax=docker/dockerfile:1.7
#
# The install artifact (doc 09 target B).
#
# Shape taken from `somakwetu`'s api image, which was already right about the
# things that are easy to get wrong: strip devDeps into a self-contained tree,
# ship no package manager or source in the runtime layer, run as a non-root
# user, and copy migration SQL explicitly because it is data rather than part of
# the JS bundle.
#
#   base    node + pnpm, shared by deps and build
#   deps    install the workspace with the lockfile pinned
#   build   `kick build` → dist/index.js
#   deploy  `pnpm deploy` strips devDeps; build output copied in beside it
#   runtime what ships: node, the bundle, the migrations, nothing else

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=10.18.0

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY tsconfig.json kick.config.ts vite.config.ts ./
COPY packages packages
COPY src src
COPY scripts scripts
# `--frozen-lockfile` so an image never resolves something different from what
# was reviewed. The supply-chain settings in pnpm-workspace.yaml apply on top:
# build scripts run only for allowlisted packages, and `minimumReleaseAge`
# quarantines brand-new releases (doc 09 §1).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NODE_ENV=production
RUN pnpm exec kick build

FROM build AS deploy
RUN pnpm deploy --legacy --prod /out \
 && cp -r dist /out/dist \
 && cp -r packages/db/migrations /out/migrations

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# pg_dump for backups. The client MAJOR must match the server or it refuses to
# dump, so this tracks the Postgres version in compose.yaml — bump both together.
RUN apk add --no-cache postgresql18-client

# Alpine ships `node` as uid 1000; nothing here needs root.
USER node
COPY --from=deploy --chown=node:node /out .

# Read by `runMigrations`, which looks here first. Explicit rather than relying
# on a relative path from the bundle, because the bundle's location is a build
# detail and this is not.
ENV MIGRATIONS_DIR=/app/migrations
ENV PORT=3000
EXPOSE 3000

# Migrations and first-boot provisioning run inside the app's own lifecycle
# (`MigrateAdapter`), so there is no entrypoint script and no ordering to get
# wrong — the server does not start listening until the database is ready.
CMD ["node", "dist/index.js"]

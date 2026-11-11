# One recipe for every app: docker build --target platform|actors|web|backoffice .
# All targets share the dependency layer, so four images cost about one on disk.
FROM oven/bun:1.4.4-slim AS source
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/platform/package.json apps/platform/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/backoffice/package.json apps/backoffice/
RUN bun install --frozen-lockfile
COPY apps apps
ENV NODE_ENV=production

FROM source AS platform
WORKDIR /app/apps/platform
USER bun
ENV PLATFORM_HOST=0.0.0.0
EXPOSE 3000
# Migrations run before every start; they are idempotent.
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun src/index.ts"]

FROM source AS actors
WORKDIR /app/apps/server
# Must go up with every deploy: the engine sends new rooms to the newest actor server.
ARG RIVET_NODE_VERSION
RUN test -n "$RIVET_NODE_VERSION" || (echo "build with --build-arg RIVET_NODE_VERSION=\$(date +%s)" && exit 1)
ENV RIVET_NODE_VERSION=$RIVET_NODE_VERSION
USER bun
CMD ["bun", "src/index.ts"]

# The build checks env but reads it again at runtime, so placeholders are enough here.
FROM source AS web
WORKDIR /app/apps/web
RUN RIVET_TOKEN=build-placeholder-not-used-at-runtime bun --bun vite build
USER bun
EXPOSE 3000
CMD ["bun", "build/index.js"]

FROM source AS backoffice
WORKDIR /app/apps/backoffice
RUN DATABASE_HOST=build DATABASE_USER=build DATABASE_NAME=build bun --bun vite build
USER bun
EXPOSE 3000
CMD ["bun", "build/index.js"]

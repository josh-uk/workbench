# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build-base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM node:24-bookworm-slim AS azure-cli-base
ARG AZURE_CLI_VERSION=2.88.0
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV AZURE_CONFIG_DIR=/home/nextjs/.azure

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg wget \
  && mkdir -p /etc/apt/keyrings \
  && curl -sLS https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
  && chmod go+r /etc/apt/keyrings/microsoft.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main" \
    > /etc/apt/sources.list.d/azure-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends "azure-cli=${AZURE_CLI_VERSION}-1~bookworm" \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /home/nextjs --create-home --shell /usr/sbin/nologin nextjs \
  && mkdir -p "$AZURE_CONFIG_DIR" \
  && chown -R nextjs:nodejs /home/nextjs \
  && chmod 700 "$AZURE_CONFIG_DIR"

FROM build-base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM azure-cli-base AS development
ENV NODE_ENV=development
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs . .
RUN mkdir -p /app/.next \
  && chown nextjs:nodejs /app/.next
USER nextjs
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM build-base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Resolve target-specific native packages without running Node under QEMU.
FROM build-base AS production-dependencies
ARG TARGETARCH
COPY package.json package-lock.json ./
RUN case "$TARGETARCH" in \
    amd64) target_npm_cpu=x64 ;; \
    *) target_npm_cpu="$TARGETARCH" ;; \
  esac \
  && npm ci --omit=dev --ignore-scripts --os=linux --cpu="$target_npm_cpu" --libc=glibc \
  && test -d "node_modules/@img/sharp-linux-$target_npm_cpu" \
  && test -d "node_modules/@img/sharp-libvips-linux-$target_npm_cpu" \
  && npm cache clean --force

FROM azure-cli-base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV WORKBENCH_BACKUP_DIR=/backups

RUN mkdir -p /backups \
  && chown nextjs:nodejs /backups \
  && chmod 700 /backups

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]

# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24-alpine AS build-base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM build-base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
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
  && npm ci --omit=dev --ignore-scripts --os=linux --cpu="$target_npm_cpu" --libc=musl \
  && test -d "node_modules/@img/sharp-linuxmusl-$target_npm_cpu" \
  && test -d "node_modules/@img/sharp-libvips-linuxmusl-$target_npm_cpu" \
  && npm cache clean --force

FROM node:24-alpine AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV WORKBENCH_BACKUP_DIR=/backups

RUN apk add --no-cache libc6-compat \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /backups \
  && chown nextjs:nodejs /backups \
  && chmod 700 /backups

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]

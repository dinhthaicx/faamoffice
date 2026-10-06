# FaamOffice web — production image (Next.js + Prisma/SQLite).
#   docker compose up --build        (see docker-compose.yml)
# SITE_URL and NEXT_PUBLIC_GITHUB_REPO are baked into static pages: pass them
# as build args. Everything else is read at runtime from the environment.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies (toolchain only needed if better-sqlite3 has no prebuilt binary)
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build
FROM deps AS build
ARG SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_GITHUB_REPO=dinhthaicx/faamoffice
ENV SITE_URL=$SITE_URL \
    NEXT_PUBLIC_GITHUB_REPO=$NEXT_PUBLIC_GITHUB_REPO
COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && rm -rf .next/cache/images

# ---- runtime
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/faamoffice.db
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start -H \"$HOSTNAME\" -p \"$PORT\""]

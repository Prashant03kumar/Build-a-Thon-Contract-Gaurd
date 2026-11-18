# Contract Guard — single image serving the API and the built web UI.
# Build context is app/ (see compose.yaml), so it can build both server/ and web/.

# ---------- 1. build the web UI ----------
FROM node:20-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2. build the server ----------
FROM node:20-slim AS server-build
# Prisma engines need openssl; install it before generate so the right
# engine variant (openssl-3.x) is selected for the debian-slim base.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /server
# Value is a placeholder: prisma generate only needs the variable defined.
ENV DATABASE_URL="file:./dummy.db"
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build && npx prisma generate

# ---------- 3. runtime ----------
FROM node:20-slim AS runtime
# Prisma engines need openssl on debian-slim
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL="file:/data/guard.db"
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
# prisma CLI ships as a regular dependency so `migrate deploy` runs at startup
COPY --from=server-build /server/dist ./dist
COPY --from=server-build /server/prisma ./prisma
COPY --from=web-build /web/dist ./public
# The runtime stage's npm install fetched a fresh @prisma/client without the
# generated engine — regenerate it here against the copied schema.
RUN npx prisma generate
EXPOSE 3001
# apply migrations to /data/guard.db, then serve API + UI
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

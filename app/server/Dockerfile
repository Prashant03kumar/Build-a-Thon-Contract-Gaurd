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
WORKDIR /server
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build

# ---------- 3. runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=server-build /server/dist ./dist
COPY --from=web-build /web/dist ./public
EXPOSE 3001
CMD ["node", "dist/index.js"]

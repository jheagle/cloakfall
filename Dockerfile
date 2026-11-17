# The lobby server (server/lobbyServer.ts) for online play. Build: docker build -t cloakfall-lobby .
# Run: docker run --rm -p 3002:3002 cloakfall-lobby

# Build stage: compile the server with the dev dependencies (typescript).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY server ./server
COPY src ./src
RUN npm run build:lobby

# Runtime stage: production dependencies and the compiled server only.
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/server ./dist/server
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# node directly, not npm, so signals (docker stop) reach the server itself
CMD ["node", "dist/server/server/lobbyServer.js"]

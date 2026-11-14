# Build from the repo root:  docker build -f keeper/Dockerfile -t blindstop-keeper .
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY keeper/package.json keeper/
COPY web/package.json web/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --prod --filter @blindstop/keeper...

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared/src packages/shared/src
COPY keeper/src keeper/src
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "keeper/src/main.ts"]

# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24

# ---- base: Node + pnpm (the version comes from "packageManager" in package.json) ----
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV CI=true
RUN corepack enable
WORKDIR /app

# ---- deps: every dependency, needed to build ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY .husky/install.mjs ./.husky/install.mjs
RUN pnpm install --frozen-lockfile

# ---- build: generate the Prisma client and compile ----
FROM deps AS build
COPY . .
# prisma.config.ts reads DATABASE_URL, but generating the client never connects to it
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate
RUN pnpm build
# the generator may emit non-TypeScript files that tsc does not copy; keep them next to the compiled client
RUN cd src/generated && find . -type f ! -name '*.ts' -exec cp --parents {} ../../dist/generated/ \;

# ---- tools: one-off commands (migrations, seed). Not shipped; used by docker compose --profile tools ----
FROM build AS tools
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- prod-deps: production dependencies only ----
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY .husky/install.mjs ./.husky/install.mjs
RUN pnpm install --prod --frozen-lockfile

# ---- runtime: the image that ships ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
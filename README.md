# devhire-api

NestJS modular-monolith backend for DevHire, a web development job board.

## Run locally

```bash
pnpm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up -d        # Postgres, Redis, MailHog (UI: http://localhost:8025)
pnpm db:generate
pnpm exec prisma migrate dev
pnpm db:seed
pnpm start:dev              # http://localhost:3000/api/v1/health/live
```

API docs: http://localhost:3000/docs (JSON: http://localhost:3000/docs-json).

## Run in Docker

```bash
pnpm docker:up              # builds the image, starts postgres, redis, mailhog and the api
pnpm docker:migrate         # one-off: prisma migrate deploy
pnpm docker:seed            # one-off: admin, skills, demo companies and jobs
pnpm docker:down
```

Stop `pnpm start:dev` first: both use port 3000.

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm test:cov` · `pnpm build`

## OpenAPI

`pnpm openapi:export` writes `openapi.json` (commit it; CI checks that it is up to date).
`devhire-web` generates its client types from it. Paths are relative to the `/api/v1` server.
When you add an endpoint, describe its response in `src/openapi/operations.ts`.

## Deploy

See the deployment phase (docker-compose.prod.yml, Nginx, GitHub Actions).

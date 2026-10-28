# devhire-api

NestJS modular-monolith backend for DevHire, a web development job board.

## Run locally

```bash
pnpm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up -d        # Postgres, Redis, MailHog (UI: http://localhost:8025)
pnpm db:generate
pnpm start:dev              # http://localhost:3000/api/v1/health/live
```

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`

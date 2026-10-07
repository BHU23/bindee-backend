# bindee-backend

## Local database, seed and tests

```bash
docker compose up -d postgres redis     # Postgres 17 + Redis
cd backend
pnpm prisma:migrate                     # apply migrations to the dev database
pnpm prisma:seed                        # idempotent mock inventory (120 days), safe to re-run
pnpm test                               # needs Postgres: creates/migrates the `bindee_test` database itself
```

`pnpm test` and `pnpm test:coverage` run real-Postgres tests (inventory seed, holds, search).
Override the test database with `TEST_DATABASE_URL`.

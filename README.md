# TimeSince

TimeSince is a personal recurring-task tracker for routines without meaningful
deadlines. The repository currently contains the full-stack project foundation;
product features are added through the milestones in `PLAN.md`.

## Requirements

- Node.js 22.13 or newer within the Node 22 release line (`.nvmrc` selects Node 22)
- npm

## Setup

```sh
nvm use
npm ci
cp .env.example .env
```

Edit `.env` and set `TIME_ZONE` to the IANA timezone used for calendar-day
task calculations. `.env` is ignored by Git; `.env.example` documents the
available settings.

### TypeScript toolchain

The two TypeScript packages are intentional. `@typescript/native` supplies the
native TypeScript 7 `tsc` used for fast project typechecking, while the package
aliased as `typescript` supplies the TypeScript 6 compatibility API and `tsc6`
required by `typescript-eslint`. Keep them side by side until the lint tooling
supports TypeScript 7's new programmatic API.

## Development

Start the React frontend and Express backend together:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to the backend at
<http://127.0.0.1:3001>.

The development and start commands load `.env` when it exists using Node's
built-in env-file support. Existing shell environment variables take
precedence. No third-party environment loader is used.

`TIME_ZONE` is required. Optional `DATABASE_PATH` defaults to
`data/timesince.sqlite`; optional `PORT` defaults to `3001` in development and
`3000` in production.

## Database migrations

Migrations are always an explicit operation; application startup does not run
them automatically.

```sh
npm run db:migrate
```

The checked-in migrations create the category, task, and completion-history
schema used by the persistence layer.

### Development fixtures

Stop the development server before resetting its database. To discard the
local development data, recreate the schema, and load representative manual-QA
fixtures in one step, run:

```sh
npm run db:fixtures:dev
```

The deterministic fixture set includes Ready, Sleeping, never-completed,
snoozed, Uncategorized, long-name, over-target, and multiple-category tasks.
The lower-level commands are also available when needed:

```sh
npm run db:reset:dev  # remove the development SQLite database
npm run db:migrate    # recreate/apply the schema
npm run db:seed:dev   # seed an empty migrated database
```

These commands are development-only. They refuse to run when
`NODE_ENV=production` or when `DATABASE_PATH` resolves outside this checkout's
`data/` directory. Reset removes only the configured SQLite file and its exact
`-shm`/`-wal` companions.

## Validation

Run all static checks, tests, and builds:

```sh
npm run check
```

Individual commands are also available:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Production build

```sh
npm run build
npm run db:migrate:prod
NODE_ENV=production npm start
```

The production Express process serves both the JSON API and the built frontend
from the same origin. It listens on `127.0.0.1:3000` by default; set `PORT` to
override the port.

Tests and production builds do not load `.env`. They pass configuration
explicitly or compile without starting the application, so a developer's local
settings cannot affect validation artifacts.

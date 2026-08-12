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
npm start
```

The production Express process serves both the JSON API and the built frontend
from the same origin. It listens on `127.0.0.1:3000` by default; set `PORT` to
override the port.

Tests and production builds do not load `.env`. They pass configuration
explicitly or compile without starting the application, so a developer's local
settings cannot affect validation artifacts.

## PWA development and QA

The normal `npm run dev` workflow does not register a service worker. This
prevents a cached production shell from interfering with source changes. Build
and start the production application to inspect PWA behaviour locally:

```sh
npm run build
npm start
```

Loopback URLs such as `http://127.0.0.1:3000` are valid for desktop service
worker and installation testing. A physical phone requires the deployed HTTPS
origin; plain HTTP over the local network is not an installable production
test.

The service worker precaches only the application shell and static build
assets. It never caches `/api` responses, task data, or mutations. An installed
app can therefore launch its shell without connectivity, but it still needs the
Express server to load or change tasks. Failed writes are rolled back and are
not queued for later.

For manual QA, use the browser's Application/PWA developer tools rather than a
deprecated aggregate PWA score. Inspect:

- manifest identity, scope, standalone display, colors, and installability
  errors;
- standard icons and maskable-icon safe areas;
- service-worker registration, scope, waiting/active lifecycle, and update
  prompt;
- Cache Storage contents, confirming only shell/static assets are present and
  `/api` is absent;
- offline launch and direct navigation to `/`, `/categories`, and
  `/categories/manage`;
- backend-unavailable and offline-hint wording, manual Retry, and recovery after
  the browser emits an `online` event;
- failed completion/save rollback with no queued mutation;
- a second production build, confirming the current session is not reloaded
  until the user accepts the update and obsolete precache entries are removed.

If a previously installed development build causes confusion, unregister its
service worker and clear its site storage in the same developer-tools panel.

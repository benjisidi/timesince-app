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
```

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

The local SQLite database defaults to `data/timesince.sqlite`. Set
`DATABASE_PATH` to use a different location.

## Database migrations

Migrations are always an explicit operation; application startup does not run
them automatically.

```sh
npm run db:migrate
```

The foundation has no schema migrations yet. The first schema is introduced in
Milestone 2.

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

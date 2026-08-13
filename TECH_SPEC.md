# TimeSince — Technical Specification

## 1. Architecture

TimeSince is a small, single-user full-stack web application.

Recommended architecture:

```text
Browser / installed PWA
        |
        | HTTPS over Tailscale
        v
Node.js application
  - Express API
  - serves production frontend
        |
        v
SQLite database
```

Primary deployment target: the user's Wyse 5070.

Remote access: private Tailscale network.

No application-level authentication is required for v1 while the service remains private to the tailnet.

Do not expose the app publicly without adding authentication first.

---

## 2. Technology choices

### Frontend

- React
- TypeScript
- Vite
- responsive CSS
- PWA manifest + service worker

Use one responsive application for mobile and desktop.

Do not create a separate mobile frontend or `m.` deployment.

### Backend

- Node.js
- TypeScript
- Express
- REST-style JSON API

The production Node process should also serve the built frontend so deployment remains a single application.

### Database

- SQLite
- Kysely for typed queries and migrations
- a mature local SQLite driver such as `better-sqlite3`

SQLite is the intended production database, not a development shortcut.

Enable:

- foreign keys;
- WAL mode.

### Testing

Recommended:

- Vitest for unit tests;
- API/integration tests against temporary SQLite databases;
- React Testing Library used sparingly for frontend interactions that genuinely benefit from component-level coverage;
- Playwright for a small number of high-value end-to-end flows.

Frontend automated testing should be deliberately light-touch because the user will manually QA each milestone.

Prioritise automated tests for:

- shared/domain logic;
- API and persistence behaviour;
- important UI interactions where regressions could alter data or task semantics;
- complex state transitions that are difficult to verify indirectly.

Do not add broad component or visual-test coverage simply for completeness. Layout, styling, responsive presentation, simple presentational components, and exact DOM structure are normally better covered by manual QA.

Do not chase high coverage percentages. Prioritise product semantics and core workflows.

---

## 3. Repository shape

Keep the project simple enough to understand without monorepo tooling.

Suggested structure:

```text
/
├── AGENTS.md
├── PRODUCT_SPEC.md
├── TECH_SPEC.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── migrations/
├── scripts/
├── src/
│   ├── client/
│   │   ├── components/
│   │   ├── features/
│   │   ├── pages/
│   │   ├── styles/
│   │   └── main.tsx
│   ├── server/
│   │   ├── api/
│   │   ├── db/
│   │   ├── services/
│   │   └── index.ts
│   └── shared/
│       ├── task-state.ts
│       ├── types.ts
│       └── validation.ts
└── tests/
```

Exact folder names may evolve, but preserve three conceptual boundaries:

- client/UI;
- server/persistence;
- shared task semantics/types.

Critical domain calculations should not be duplicated independently in several UI components.

---

## 4. Core data model

## 4.1 `categories`

```text
id            INTEGER PRIMARY KEY
name          TEXT NOT NULL
position      INTEGER NOT NULL
created_at    TEXT NOT NULL
updated_at    TEXT NOT NULL
```

Rules:

- category names should be unique case-insensitively unless a later product decision says otherwise;
- `position` controls user-defined ordering.

`Uncategorized` is a UI concept and does not need to exist as a database row.

---

## 4.2 `tasks`

```text
id                    INTEGER PRIMARY KEY
name                  TEXT NOT NULL
category_id           INTEGER NULL REFERENCES categories(id)
target_interval_days  INTEGER NOT NULL
snoozed_until         TEXT NULL
created_at            TEXT NOT NULL
updated_at            TEXT NOT NULL
archived_at           TEXT NULL
```

Rules:

- `target_interval_days >= 1`;
- deleting a category sets its tasks' `category_id` to `NULL`;
- tasks should normally be archived rather than physically deleted;
- snoozing must not mutate completion records.

If manual task ordering is later required, add a task-position field deliberately rather than overloading timestamps.

---

## 4.3 `completions`

```text
id            INTEGER PRIMARY KEY
task_id       INTEGER NOT NULL REFERENCES tasks(id)
completed_at  TEXT NOT NULL
created_at    TEXT NOT NULL
```

Index:

```text
(task_id, completed_at DESC)
```

Do not store `last_completed_at` as the source of truth in `tasks`.

It is derived from the newest completion.

A cached field may be considered later only if profiling demonstrates a real need.

---

## 5. Time storage and task-state calculations

### Persistence

Store timestamps as UTC ISO-8601 strings.

The UI renders them in the user's local timezone.

For v1, target intervals are whole days.

All elapsed/Ready calculations must be implemented in a shared domain helper and covered by unit tests.

The backend supplies an explicitly configured deployment-level IANA timezone
to that helper. The application must fail clearly at startup when the setting
is absent or invalid rather than infer the server's local timezone.

Elapsed days are calendar days, not rolling 24-hour periods. Calculate them as
the number of local calendar-date boundaries between the latest completion and
the current time in an explicitly supplied IANA timezone. The domain helper
must require that timezone as input rather than infer the server's local
timezone. A local day counts as one day across both 23-hour and 25-hour DST
transitions.

If a completion timestamp is in the future, defensively clamp its elapsed-day
result to zero. Validation of deliberately future completion input belongs at
the API boundary. Calendar-month/year recurrence and longer human-friendly
duration units remain outside the v1 whole-day interval model.

Conceptually:

```ts
lastCompletedAt = latest completion, or null
elapsedDays = local calendar days since lastCompletedAt, or null
overageDays = max(0, elapsedDays - targetIntervalDays), or null

ready =
  lastCompletedAt === null ||
  elapsedDays >= targetIntervalDays

visibleInReady =
  ready &&
  (snoozedUntil === null || snoozedUntil <= now)
```

Do not derive a "due date" or "overdue state" in the domain model.

A computed wake time/date may be used internally to sort sleeping tasks, but it is not a deadline and should not leak into product language.

### Display calculation

The core requirement is to display the actual elapsed time since completion and avoid due/overdue framing.

The current UI convention is:

```text
E <= T  -> show E
E > T   -> show E, optionally with superscript +(E - T)
```

For example, a task with a 14-day target and 17 elapsed days may display as `17⁺³ days`.

This superscript notation is a presentation choice, not a domain invariant. It may be refined without changing the task model. Never label the excess as overdue.

### Never completed

A task without completions:

- displays `Never`;
- has `null` elapsed and overage values;
- is Ready immediately.

---

## 6. API

Use conventional HTTP status codes and JSON.

Validate all write payloads at the server boundary.

A schema validation library may be used, but keep validation definitions shared where practical.

Suggested endpoints:

### Tasks

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/restore
```

`DELETE` should archive the task by default rather than physically remove it.

Task creation may include an optional past initial-completion timestamp. It is
created atomically with the task.

The task create/update endpoints also accept a `YYYY-MM-DD` calendar date for
`initialCompletedAt` and `snoozedUntil`. The server resolves it to the start of
that date in the configured application timezone before validation and UTC
storage. This supports date-only UI controls without depending on the
browser's timezone. Existing ISO-8601 instant inputs remain supported.

Useful `GET /api/tasks` query parameters may include:

```text
categoryId=
state=ready|sleeping|all
includeArchived=false
visibleInReady=true|false
```

Do not create an `overdue` state.

`state` filters semantic state only, so `state=ready` includes actively
snoozed tasks. `visibleInReady` is an independent filter for the primary Ready
list. Archived tasks are excluded by default and have `visibleInReady=false`.

Archived tasks and their completion history remain readable. They are
otherwise read-only: they cannot be edited, snoozed, completed, or have
completion records removed. Restoring a task clears `archived_at`, updates
`updated_at`, and preserves every other task field and completion record.

### Completions

```text
GET    /api/tasks/:id/completions
POST   /api/tasks/:id/completions
DELETE /api/completions/:id
```

`POST` records a completion.

It may include an optional past `completedAt` instant and otherwise records the
current time. Existing ISO-8601 instant inputs remain supported. It also accepts
a `YYYY-MM-DD` value for historical completion, resolves that date to the start
of the local calendar day in the configured application timezone, and stores
the resulting UTC instant. Date-only completion input must be strictly before
today in that timezone; today uses the normal current-time completion path and
future dates are rejected. Multiple completions on the same local calendar
date remain independent records.

Deleting the newest completion supports the Undo workflow.

Historical completion deletion can remain an internal/API capability until a history UI exists.
Completion deletion always targets the exact completion ID supplied; there is
no delete-latest shortcut.

### Snooze

Snooze may be represented as a task update:

```text
PATCH /api/tasks/:id
{
  "snoozedUntil": "..."
}
```

No separate snooze table is needed in v1.

A non-null snooze instant must be in the future when submitted. `null`
explicitly unsnoozes the task.

### Categories

```text
GET    /api/categories
POST   /api/categories
PATCH  /api/categories/:id
DELETE /api/categories/:id
```

Category reorder may be handled either through `PATCH` or a small reorder endpoint.

Prefer the simpler implementation until the UI requires otherwise.

The frontend may read the configured application timezone from:

```text
GET /api/config
```

This value is presentation/configuration metadata only; clients cannot change
the deployment timezone through the API.

---

## 7. API response shape

Task responses should include raw persisted data plus useful derived state so all clients use consistent semantics.

Example:

```json
{
  "id": 42,
  "name": "Change bedsheets",
  "category": {
    "id": 2,
    "name": "Bedroom"
  },
  "targetIntervalDays": 14,
  "lastCompletedAt": "2026-07-25T18:20:00.000Z",
  "elapsedDays": 17,
  "overageDays": 3,
  "state": "ready",
  "snoozedUntil": null
}
```

Allowed `state` values:

```text
ready
sleeping
```

Do not add `overdue`.

A snoozed Ready task is still semantically Ready; snooze is a separate presentation/filtering concern.

---

## 8. Frontend behaviour

### Data fetching

Keep server state simple.

For this single-user app, aggressive caching/state infrastructure is unnecessary.

A small query library is acceptable if it materially simplifies:

- cache invalidation;
- mutation loading/error state;
- optimistic updates.

Otherwise plain fetch wrappers are sufficient.

Do not introduce Redux or another broad global-state framework without a concrete need.

### Completion

Completion should feel immediate.

Preferred flow:

1. optimistic UI update;
2. POST completion;
3. reconcile with server response;
4. show Undo toast;
5. on failure, restore the previous UI and report the error.

Undo deletes the completion that was just created.

Historical completion is a secondary task-editor workflow. It does not apply
an optimistic derived-state update because an inserted event may be older than
the current latest completion. After creation, the frontend reconciles the
authoritative task returned by the server through the same Ready, Sleeping,
Browse, and Search collection path and offers the existing exact-ID Undo.

### Responsive layout

Use CSS breakpoints/components within the same React application.

Mobile:

- compact navigation;
- touch-first rows;
- modal/sheet task editor;
- one-column task lists.

Desktop:

- persistent navigation where useful;
- denser rows;
- more information visible without drilling in;
- modal or side-panel editing;
- keyboard-friendly forms.

Do not branch into two separately maintained applications.

---

## 9. PWA behaviour

The web app should be installable on supported phones/desktops.

Provide:

- application manifest;
- icons;
- standalone display mode;
- theme/background metadata;
- service worker sufficient for application-shell caching.

v1 does **not** promise full offline task editing or synchronisation.

If the backend cannot be reached, the UI should state that clearly rather than pretending writes were saved.

Do not build an offline mutation queue in v1.

---

## 10. Error handling

User-facing errors should be concise and actionable.

Important cases:

- backend unavailable;
- task save failed;
- completion failed;
- completion Undo failed;
- category name conflict;
- invalid interval;
- category removal failure.

Do not discard entered form data after an API error.

Server errors should be logged with enough context for local diagnosis, but do not log sensitive request contents unnecessarily.

---

## 11. Migrations

All schema changes must use checked-in migrations.

Rules:

- never rely on ad-hoc manual production schema changes;
- migrations must be deterministic;
- migration order must be committed;
- production startup should not silently perform destructive schema operations;
- the normal production workflow must take and verify a pre-migration backup
  before running the new release's migration bundle;
- migrations that rewrite significant data additionally require explicit
  review and a documented recovery decision.

A fresh database should be constructible entirely from repository migrations.

---

## 12. Deployment

### 12.1 Architecture and deployment status

The production target is the Wyse 5070 running Ubuntu Server 26.04 LTS. Use a
systemd-managed Node 22 process and Tailscale Serve. Docker, Compose, a public
reverse proxy, and application authentication are not part of this deployment.

The production request path is:

```text
Desktop/mobile browser or installed PWA
      |
      | HTTPS, private tailnet only
      |
      v
Tailscale Serve on the Wyse
      |
      | HTTP proxy to 127.0.0.1:3000
      |
      v
systemd -> Node 22 / Express
      |
      v
/var/lib/timesince/timesince.sqlite
```

Express must remain bound to `127.0.0.1`; port 3000 must not be opened on the
LAN, tailnet, router, or public internet. Tailscale Serve is the only network
entry point. It terminates TLS and applies the tailnet access boundary.

The repository contains the complete deployment implementation:

- `scripts/deploy-production.sh`: normal development-machine entry point;
- `scripts/deploy-host.sh`: privileged atomic host update implementation;
- `deploy/timesince.env.example`: production configuration template;
- `deploy/systemd/timesince.service`: application supervision;
- `deploy/systemd/timesince-backup.service`: daily backup and off-host sync;
- `deploy/systemd/timesince-backup.timer`: persistent daily schedule;
- the production build generates `dist/server/migrate.js`,
  `dist/server/backup.js`, `dist/server/sync-backups.js`, and
  `dist/server/restore.js` for explicit migrations, SQLite-consistent backups,
  off-host sync, and guarded restore;
- `docs/deployment.md`: expanded operator runbook and validation checklist.

Repository implementation is not the same as completed deployment. Milestone
18 remains incomplete until the real host, off-host destination, Tailscale
origin, restore proof, restart/reboot behaviour, repeated update, exposure
boundary, and PWA behaviour have all been validated.

### 12.2 Required deployment inputs

Before touching the host, obtain or confirm all of the following rather than
inventing values:

- SSH destination for a host account that may run the deployment helper with
  `sudo`, for example `deployer@timesince-host`;
- stable Tailscale machine name and intended tailnet access policy;
- production timezone, currently `Europe/London`;
- configured rclone Google Drive remote name and relative backup path, for
  example `gdrive` and `TimeSince/backups`;
- Node and npm host paths if they are not discoverable through the root/systemd
  `PATH`.

Deployments are made from the exact committed `HEAD`. The worktree must be
clean, and all reviewed Milestone 18 implementation must therefore be committed
before the first deployment. Do not deploy uncommitted files or build output.

### 12.3 Host prerequisites

The host needs:

- Node.js 22.13 or newer within the Node 22 line, with its matching npm;
- `curl`, `rclone`, `tar`, OpenSSH, and systemd;
- Tailscale and its `tailscaled` system service.

The repository deliberately does not hardcode a Node installer. Use a
maintained package source or verified official binary suitable for the host,
then verify `node --version` and `npm --version`. The deployment scripts reject
Node versions outside the supported Node 22 range. If Node is outside the
default service path, set `PATH` in the production environment file and pass
`TIMESINCE_NODE_BINARY` and `TIMESINCE_NPM_BINARY` when deploying.

### 12.4 Production filesystem and ownership

Use this fixed separation:

```text
/opt/timesince/
  releases/<full-git-sha>/       immutable, root-owned release
  current -> releases/<sha>      atomically replaced active symlink

/var/lib/timesince/
  timesince.sqlite               persistent production database
  rclone/rclone.conf             service-owned Google Drive configuration
  deployment-in-progress         present only during unsafe/incomplete cutover

/etc/timesince/
  timesince.env                  root:timesince, mode 0640

/var/backups/timesince/
  daily/
  pre-migration/
  manual/
```

SQLite may create `timesince.sqlite-wal` and `timesince.sqlite-shm` beside the
database. They are persistent-data companions, never release artifacts.

Prepare an empty host idempotently:

```sh
if ! id timesince >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/timesince --shell /usr/sbin/nologin timesince
fi
sudo install -d -o root -g root -m 0755 /opt/timesince /opt/timesince/releases
sudo install -d -o timesince -g timesince -m 0750 /var/lib/timesince
sudo install -d -o timesince -g timesince -m 0750 /var/backups/timesince
sudo install -d -o root -g timesince -m 0750 /etc/timesince
```

Never put the production database, configuration, or backups in a release or
Git working tree. Removing an old release must never remove
`/var/lib/timesince` or `/var/backups/timesince`.

### 12.5 Production configuration and safety guards

Install `deploy/timesince.env.example` as
`/etc/timesince/timesince.env`, owned by `root:timesince` with mode `0640`.
The required baseline is:

```text
NODE_ENV=production
TIME_ZONE=Europe/London
DATABASE_PATH=/var/lib/timesince/timesince.sqlite
PORT=3000
BACKUP_DIRECTORY=/var/backups/timesince
BACKUP_RETENTION_COUNT=30
RCLONE_REMOTE=gdrive
RCLONE_BACKUP_PATH=TimeSince/backups
RCLONE_CONFIG=/var/lib/timesince/rclone/rclone.conf
```

`RCLONE_CONFIG` is optional when rclone can find the service user's configured
remote, but an explicit service-owned path under `/var/lib/timesince` is
preferred for systemd and permits rclone to persist refreshed Google Drive
credentials. Optionally set an absolute `RCLONE_BINARY` and a service `PATH`
when host tools are not in their usual locations. Never commit the rclone
configuration or Google Drive credentials.

Production startup, migrations, backups, and restores all require
`NODE_ENV=production` and an explicit absolute `DATABASE_PATH` outside the
current release. Backup paths must also be absolute, outside the release, and
separate from the live database directory. Development migration and fixture
commands retain their existing checkout-local guards. Never bypass these
checks to make a command convenient.

### 12.6 systemd installation and supervision

Transfer the environment template and units from the reviewed checkout:

```sh
scp deploy/timesince.env.example deploy/systemd/timesince* deployer@timesince-host:/tmp/
```

On the host:

```sh
if ! sudo test -e /etc/timesince/timesince.env; then
  sudo install -o root -g timesince -m 0640 /tmp/timesince.env.example /etc/timesince/timesince.env
fi
sudoedit /etc/timesince/timesince.env
sudo install -o root -g root -m 0644 /tmp/timesince.service /etc/systemd/system/timesince.service
sudo install -o root -g root -m 0644 /tmp/timesince-backup.service /etc/systemd/system/timesince-backup.service
sudo install -o root -g root -m 0644 /tmp/timesince-backup.timer /etc/systemd/system/timesince-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable timesince.service
```

Do not start the application before the first release migration succeeds.

The application unit runs as the non-login `timesince` user from
`/opt/timesince/current`, restarts only on failure after five seconds, logs to
journald, allows writes only to `/var/lib/timesince`, and gives graceful
shutdown up to 20 seconds. The Node process handles `SIGINT` and `SIGTERM`,
stops accepting requests, and closes SQLite. The unit refuses to start while
`/var/lib/timesince/deployment-in-progress` exists.

Standard operations are:

```sh
sudo systemctl status timesince.service
sudo journalctl -u timesince.service --since today
sudo systemctl restart timesince.service
sudo systemctl stop timesince.service
sudo systemctl start timesince.service
curl --fail http://127.0.0.1:3000/api/health
```

The health endpoint returns `{"status":"ok"}` only when Express can read all
three core migrated tables. A listening process with a missing/incompatible
schema returns HTTP 503 and is not a successful deployment.

### 12.7 Tailscale private HTTPS

Install Tailscale using its current official Ubuntu instructions, enable
`tailscaled`, join the approved tailnet, choose the stable node name, and enable
MagicDNS plus HTTPS certificates in the Tailscale admin console. Then configure
the private reverse proxy:

```sh
sudo tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```

`--bg` persists the Serve configuration across Tailscale and host restarts.
Do not enable Tailscale Funnel. Do not add a public DNS record or another public
proxy. Tailnet ACLs/grants must allow only the intended user/devices if the
tailnet contains other principals. Enabling Tailscale HTTPS publishes the
machine and tailnet DNS names in public certificate-transparency records; it
does not make the service publicly reachable, but the operator must accept that
metadata disclosure.

Verify the access boundary:

```sh
ss -ltnp
tailscale serve status
tailscale funnel status
curl --fail http://127.0.0.1:3000/api/health
```

Node must be listening only on `127.0.0.1:3000`. Confirm the generated
`https://<machine>.<tailnet>.ts.net/` origin works from intended tailnet desktop
and mobile devices, and that the service cannot be reached from a device that
is not connected to the tailnet.

### 12.8 Normal deployment and update command

The development-to-production path is intentionally one command. From a clean,
committed checkout using Node 22:

```sh
nvm use
export TIMESINCE_DEPLOY_HOST=deployer@timesince-host
./scripts/deploy-production.sh
```

Optional overrides are:

```text
TIMESINCE_DEPLOY_ROOT=/opt/timesince
TIMESINCE_ENV_FILE=/etc/timesince/timesince.env
TIMESINCE_SERVICE_NAME=timesince
TIMESINCE_NODE_BINARY=/absolute/host/path/to/node
TIMESINCE_NPM_BINARY=/absolute/host/path/to/npm
```

The development-side script:

1. rejects a dirty worktree or unsupported local Node version;
2. selects the full Git SHA for committed `HEAD`;
3. runs `npm run check`;
4. creates a `git archive` containing that exact commit;
5. transfers the archive and host helper over SSH;
6. invokes the host helper through `sudo`.

The host helper:

1. rejects invalid paths, versions, missing units/configuration, and any
   existing deployment marker;
2. extracts into `/opt/timesince/releases/.staging-<sha>-<pid>`;
3. runs `npm ci`, `npm run build`, and `npm prune --omit=dev` on the host;
4. records `.timesince-release`, makes the release root-owned, and renames the
   staging directory to `/opt/timesince/releases/<sha>`;
5. for every existing database/release, creates and verifies a pre-migration
   backup and completes the off-host sync before stopping the app;
6. stops `timesince.service` and creates the deployment marker;
7. runs the new release's `dist/server/migrate.js --production` against the
   configured production database;
8. only after migration succeeds, atomically replaces `current` using a
   temporary symlink and GNU `mv -T`;
9. removes the marker, starts the service, and polls the database-aware local
   health endpoint for up to 20 seconds;
10. retains the previous release for recovery.

This preserves the central invariant: the active application release and
database schema must be compatible. Deployment never automatically runs a down
migration or restarts an old release against a potentially newer schema.

### 12.9 Migration and deployment failure handling

Application startup never runs migrations. Development uses
`npm run db:migrate`; production deployment runs the compiled migration bundle
with `--production` and the production environment file. Re-running the
production migration on a current schema is a safe no-op.

For deliberate host diagnosis or a documented manual migration window, stop
the service first and run the exact active-release command:

```sh
sudo systemctl stop timesince.service
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/migrate.js --production
```

Do not use this manual form as a shortcut around the normal pre-migration
backup and release cutover. If it is used during recovery, retain the
deployment marker until compatibility and health have been verified.

If the pre-migration backup or off-host sync fails, deployment aborts before
the service is stopped.

If migration fails:

- the service remains stopped;
- `current` remains on the prior release;
- the deployment marker remains present and blocks boot-time startup;
- do not start the prior release until the database is known to match it;
- inspect output/logs and restore the verified pre-migration backup if the
  migration may have changed the database.

If the symlink switch succeeds but startup or health verification fails:

- the new release remains selected;
- the service is stopped and the deployment marker is restored;
- inspect `journalctl -u timesince.service`;
- fix forward when safe, or restore the pre-migration backup and atomically
  point `current` back to the matching prior release.

After manual recovery, remove the marker only when the chosen release and
database schema are confirmed compatible:

```sh
sudo ln -s /opt/timesince/releases/PREVIOUS_FULL_GIT_SHA /opt/timesince/.current-recovery
sudo mv -Tf /opt/timesince/.current-recovery /opt/timesince/current
sudo rm -f /var/lib/timesince/deployment-in-progress
sudo systemctl start timesince.service
curl --fail http://127.0.0.1:3000/api/health
```

### 12.10 Deployment acceptance

Do not mark Milestone 18 complete after merely installing the files. On the real
host, record evidence that:

- a first deployment creates a migrated database and healthy service;
- deliberately killing Node causes systemd to restart it;
- rebooting the host restores systemd, Tailscale, Tailscale Serve, and the
  backup timer;
- a second committed deployment preserves recognisable production data;
- production migration can be invoked deliberately and safely rerun as a no-op;
- desktop and mobile devices can use the private HTTPS origin;
- the Node port is loopback-only and the HTTPS service is not publicly
  reachable;
- the backup and restore acceptance in section 13 succeeds;
- production-origin PWA validation succeeds as described in section 9 and the
  checklist below.

PWA validation on the real HTTPS origin must cover manifest/icons,
installability, standalone launch, service-worker active/waiting lifecycle,
application-shell caching, the update prompt with a genuinely changed client
build, and recovery after backend reconnection. Inspect Cache Storage and
confirm `/api` responses are absent. Stop the backend and verify the cached
shell reports backend unavailability, failed writes roll back, and no mutation
is queued or replayed later.

---

## 13. Backups

### 13.1 Backup policy and implementation

Use `better-sqlite3`'s online backup API. Never copy the live SQLite file with
`cp`, rclone, or another naive file copier while WAL mode may be active. Rclone
operates only on already published, verified backup files.

Each local backup:

- uses the explicit production database and refuses a missing source rather
  than creating an empty database;
- is created as a temporary file through SQLite's online backup API;
- passes `PRAGMA integrity_check` before publication;
- is atomically renamed to a timestamped `.sqlite` filename;
- receives a SHA-256 sidecar and mode `0600`;
- belongs to `daily`, `pre-migration`, or `manual`;
- applies `BACKUP_RETENTION_COUNT` separately within each label directory.

The default retention is 30 backups per label. The off-host transport uses
`rclone copy`, never `rclone sync`, so deletion caused by local retention is not
propagated to Google Drive. A remote copy failure does not remove the valid
local backup, but it makes the systemd backup job or deployment fail visibly.

Configure the Google Drive remote with rclone, then make the resulting
configuration readable by the `timesince` service account without placing it
in Git:

```sh
sudo install -d -o timesince -g timesince -m 0700 /var/lib/timesince/rclone
sudo install -o timesince -g timesince -m 0600 /path/to/configured/rclone.conf /var/lib/timesince/rclone/rclone.conf
sudo -u timesince rclone --config /var/lib/timesince/rclone/rclone.conf listremotes
sudo -u timesince rclone --config /var/lib/timesince/rclone/rclone.conf lsd gdrive:
```

Replace `gdrive` with `RCLONE_REMOTE`. `RCLONE_BACKUP_PATH` must be a non-empty
relative remote path without `.` or `..` segments. The runtime builds exactly
`<remote>:<path>` and passes it as one process argument. Test access as the
service user before enabling the timer.

### 13.2 Automated daily backup

The `timesince-backup.timer` runs daily at 03:15 with up to 30 minutes of
random delay and `Persistent=true`, so a missed run executes after the host
returns. Its oneshot service runs the local online backup and then the off-host
sync. Enable it only after the destination has been configured and tested:

```sh
sudo systemctl enable --now timesince-backup.timer
sudo systemctl start timesince-backup.service
sudo systemctl status timesince-backup.service
sudo journalctl -u timesince-backup.service --since today
systemctl list-timers timesince-backup.timer
sudo find /var/backups/timesince -maxdepth 2 -type f -print
```

A manual verified backup and sync can be run with:

```sh
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/backup.js --label manual
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/sync-backups.js
sudo -u timesince rclone \
  --config /var/lib/timesince/rclone/rclone.conf \
  lsf gdrive:TimeSince/backups --recursive
```

The final command must show both the timestamped `.sqlite` file and its
`.sha256` sidecar on Google Drive. Substitute the configured remote and path.

The normal deployment automatically creates a `pre-migration` backup and
successfully syncs it off-host before stopping any existing installation.

### 13.3 Guarded restore procedure

Restore is intentionally manual because it replaces production state. Retrieve
the selected backup from local or off-host storage and ensure the `timesince`
user can read it. Then:

```sh
sudo systemctl stop timesince.service
cd /opt/timesince/current
sudo -u timesince NODE_ENV=production /usr/bin/env node \
  --env-file=/etc/timesince/timesince.env \
  dist/server/restore.js \
  --backup /absolute/path/to/timesince-daily-TIMESTAMP.sqlite \
  --confirm-database /var/lib/timesince/timesince.sqlite \
  --confirm-service-stopped
sudo systemctl start timesince.service
curl --fail http://127.0.0.1:3000/api/health
```

The restore refuses relative paths, a source equal to the production database,
a confirmation path that does not exactly match `DATABASE_PATH`, or omission of
`--confirm-service-stopped`. It verifies a checksum when present, verifies
SQLite integrity, stages the replacement on the production filesystem, moves
the prior database and WAL/SHM companions to timestamped `.pre-restore-*`
recovery files, and atomically installs the restored database. Retain recovery
files until the restored application has been inspected.

When restoring after a migration failure, also atomically select the release
whose schema matches the backup before removing the deployment marker and
starting the service. Never attempt an automatic down-migration.

### 13.4 Required restore proof

Before storing significant real-world data, prove the complete path:

1. create a recognisable temporary task through the production HTTPS origin;
2. create a manual backup and confirm its off-host copy exists;
3. modify or archive that task;
4. stop TimeSince and restore the selected backup using the guarded command;
5. restart and confirm health plus the earlier task state through the PWA;
6. perform the normal committed-release deployment again and confirm the
   restored data survives;
7. document the tested backup filename, off-host source, restore time, and
   result.

A scheduled backup file that has never been restored does not satisfy the
production backup requirement.

---

## 14. Testing priorities

Highest-value automated tests:

### Domain/unit tests

Cover:

- never-completed task is Ready;
- task before target is Sleeping;
- task at target is Ready;
- task after target is still only Ready;
- elapsed/over-target calculation;
- snooze suppresses Ready visibility without changing elapsed state;
- DST/time-boundary behaviour chosen by the implementation.

Do not treat the exact superscript notation as a core domain behaviour.

### API/integration tests

Cover:

- create/edit/archive task;
- add completion;
- fetch derived task state;
- undo completion;
- category deletion leaves tasks Uncategorized;
- persistence across DB reopen.

### Frontend/component tests

Keep component-level frontend tests selective.

Automate interactions where a regression could change user data, task semantics, or non-trivial UI state. Do not generally test layout, styling, responsive presentation, simple presentational components, or exact DOM structure.

### End-to-end

Keep the end-to-end suite small and focused on core workflows. At minimum, cover:

1. create task;
2. see task in Ready;
3. complete it;
4. see it leave Ready;
5. undo;
6. see it return.

A basic category-management flow is also useful.

Manual QA remains the primary validation method for visual and responsive behaviour at each milestone.

---

## 15. Security

v1 threat model assumes:

- one trusted user;
- private Tailscale network;
- no public internet exposure.

Still implement normal web safety:

- validate API input;
- parameterise database queries;
- avoid arbitrary file access;
- keep dependencies patched;
- do not expose stack traces to the client in production;
- bind the application appropriately for the chosen Tailscale/reverse-proxy setup.

Do not add username/password login merely for appearance while Tailscale is the access boundary.

---

## 16. Performance expectations

Performance requirements are modest.

Expected scale is on the order of:

- hundreds or low thousands of active tasks;
- tens or hundreds of thousands of completion rows over many years;
- one interactive user.

SQLite and straightforward queries are sufficient.

Prefer simple, indexed queries over caches, background workers, or distributed infrastructure.

---

## 17. Future technical expansion

The architecture should permit, but not pre-build:

- tags;
- more completion analytics;
- native clients using the same API;
- notifications;
- multi-user auth;
- offline synchronisation;
- Postgres migration if the product ever becomes genuinely multi-user.

Do not introduce infrastructure for these in v1 without a product requirement.

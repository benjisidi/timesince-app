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
current time. Future completion instants are rejected at the API boundary.

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
- make a backup before migrations that could rewrite significant data.

A fresh database should be constructible entirely from repository migrations.

---

## 12. Deployment

Primary target: Wyse 5070 running Linux.

Recommended production shape:

```text
Tailscale HTTPS
      |
      v
Node app on localhost/internal port
      |
      v
SQLite file on local SSD
```

Either of these operational styles is acceptable:

- systemd-managed Node process; or
- a small Docker Compose deployment.

Prefer whichever keeps deployment, logs, restart behaviour, and backups simplest on the host.

If Docker is used:

- keep the SQLite database on a persistent bind mount/volume;
- do not store it inside an ephemeral container filesystem.

### Tailscale

Expose the app only to the tailnet.

Use HTTPS for the installed PWA.

Do not enable public Tailscale Funnel or public reverse-proxy access as part of v1.

Application authentication becomes mandatory before public exposure.

---

## 13. Backups

The SQLite database is small, so backups should be simple and frequent.

Minimum production policy:

- automated daily SQLite-consistent backup;
- retain multiple recent versions;
- maintain at least one off-host copy;
- document restoration.

Do not back up by blindly copying a live SQLite database file in a way that can produce an inconsistent snapshot.

Use SQLite's backup mechanism or another SQLite-aware backup process.

Before risky migrations, take an additional backup.

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

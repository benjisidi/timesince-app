# TimeSince — Implementation Plan

This file is the working implementation roadmap for TimeSince.

Before starting work, agents should read:

1. `AGENTS.md`
2. `PRODUCT_SPEC.md`
3. `TECH_SPEC.md`
4. this file

Work through the milestones in order unless there is a clear reason not to. Keep each milestone small enough to review and verify independently.

The goal is for the repository to remain in a coherent, working state after every milestone.

---

## Working method

For each milestone:

1. Inspect the current repository before changing anything.
2. Propose an implementation plan for the milestone.
3. Confirm the plan matches the product and technical specs.
4. Implement only the current milestone.
5. Add or update automated tests.
6. Run the relevant validation commands.
7. Review the resulting diff.
8. Commit only when the milestone is coherent and working.
9. Update this file's status/progress notes where useful.

Avoid implementing future milestones speculatively.

## Testing and manual QA

Automated testing should be strongest around domain logic, persistence, API behaviour, and important state-changing workflows.

Frontend tests should be deliberately light-touch. The user will manually QA the UI after each milestone, so do not build broad component or visual test suites merely for completeness.

Prefer:

- unit tests for task semantics;
- integration tests for persistence and API behaviour;
- a small number of high-value component/end-to-end tests for important interactions.

Generally leave layout, styling, responsive presentation, and simple presentational components to manual QA unless a specific regression risk justifies automation.

---

# Milestone 1 — Project foundation

**Status:** Complete

Completed 2026-08-11. Validation passed for clean installation, development and
production frontend/backend integration, explicit migrations, typechecking,
linting, formatting, tests, and production builds.

## Goal

Create a clean, runnable full-stack skeleton using the agreed technology stack.

## Deliverables

- React + TypeScript frontend using Vite.
- Node + TypeScript backend using Express.
- Shared TypeScript configuration where sensible.
- SQLite connection layer.
- Kysely configured for database access and migrations.
- Basic project scripts for development and production.
- Test tooling configured.
- Linting and formatting configured.
- Basic production build.
- Minimal health endpoint.
- Minimal frontend page proving frontend/backend integration.
- Initial README or setup instructions if needed.
- Update `AGENTS.md` with actual repository commands once they exist.

## Acceptance criteria

- A fresh checkout can install dependencies successfully.
- The development environment starts with a documented command.
- The frontend renders successfully.
- The frontend can call the backend health endpoint.
- A production build succeeds.
- Typecheck succeeds.
- Lint succeeds.
- Test suite runs successfully.
- No product features are implemented yet beyond what is needed to prove the stack works.

---

# Milestone 2 — Database schema and persistence

**Status:** Complete

Completed 2026-08-11. The migrated SQLite schema, typed Kysely repositories,
constraints, archive/category-removal behaviour, completion-history queries,
and file-reopen persistence are covered by integration tests.

## Goal

Implement the core persistent data model for categories, tasks, and completion history.

## Deliverables

Database migrations for:

- `categories`
- `tasks`
- `completions`

Persistence/repository code for:

- creating, reading, updating, and removing categories;
- creating, reading, updating, and archiving tasks;
- creating and reading completion records;
- undoing/removing a completion.

Required constraints and indexes should match `TECH_SPEC.md`.

## Acceptance criteria

Automated integration tests demonstrate that:

- a category can be created and read;
- a task can be created with or without a category;
- a task can be edited;
- a task can be archived;
- a completion can be added;
- completion history is preserved;
- the latest completion can be retrieved correctly;
- deleting a category leaves its tasks Uncategorized;
- a fresh database can be created entirely from migrations;
- persistence survives closing and reopening the database.

No UI work beyond what is necessary for development/testing.

---

# Milestone 3 — Core task semantics

**Status:** Complete

Completed 2026-08-11. Shared pure domain logic now derives latest completion,
local calendar-day elapsed time in an explicitly supplied IANA timezone,
Ready/Sleeping state, snooze visibility, never-completed metadata, and
over-target days. Unit tests cover state thresholds, completion reset, snooze
expiry, invalid inputs, future timestamps, calendar boundaries, and DST.

## Goal

Implement and thoroughly test the domain logic that determines task state and elapsed-time display.

This is a critical milestone because later UI and API behaviour should depend on these shared rules rather than reimplementing them independently.

## Deliverables

Shared task-state logic covering:

- latest completion;
- elapsed days;
- target interval;
- Ready vs Sleeping state;
- snooze visibility rules;
- never-completed tasks;
- over-target calculation;
- elapsed-time display metadata where useful to the UI.

The implementation must preserve the product principle that TimeSince has no due/overdue state.

## Acceptance criteria

Unit tests cover at minimum:

```text
target 14, elapsed 13 -> Sleeping
target 14, elapsed 14 -> Ready
target 14, elapsed 17 -> Ready
```

The UI may later present the 17-day example as `17⁺³ days`, but the exact notation is not a core domain invariant and does not need dedicated domain-test coverage.

Also verify:

- a never-completed task is Ready immediately;
- a snoozed Ready task remains semantically Ready but is suppressed from the Ready list;
- snoozing does not alter completion history;
- completing a task resets its elapsed-time calculation;
- relevant day/timezone boundary behaviour is explicit and tested.

No "overdue", "late", or equivalent domain state should exist.

---

# Milestone 4 — Core task API

**Status:** Complete

Completed 2026-08-11. The backend now exposes validated task and completion
routes with shared derived state, semantic and visibility filters, explicit
timezone configuration, exact-ID completion undo, snooze handling, archival,
and read-only archived-task restoration. API integration tests cover the core
state-changing workflows and error cases.

## Goal

Expose the core task model through the backend API.

## Deliverables

Implement the agreed API for:

- listing tasks;
- getting a task;
- creating a task;
- editing a task;
- archiving a task;
- restoring an archived task;
- recording a completion;
- retrieving completion history;
- undoing/removing a completion;
- snoozing/unsnoozing a task.

Task responses should include the derived state needed by the frontend.

Validate write payloads at the API boundary.

## Acceptance criteria

API/integration tests demonstrate that:

- tasks can be created and retrieved;
- task edits persist;
- completion changes derived state correctly;
- undo restores the previous state;
- snooze suppresses Ready visibility without changing elapsed time;
- invalid target intervals are rejected;
- archived tasks are excluded by default;
- archived tasks are read-only until restored, while their history remains readable;
- restoring preserves task fields and completion history;
- no API response introduces due/overdue semantics.

---

# Milestone 5 — Basic mobile Task view

**Status:** Complete

Completed 2026-08-11. The mobile-first Task view now loads canonically ordered
Ready and Upcoming lists from the API, presents calm elapsed and target context,
handles loading/error/empty states, and supports server-confirmed completion in
both sections. A focused frontend interaction test covers the Ready-to-Upcoming
workflow; visual and responsive details remain part of manual QA.

## Goal

Create the first genuinely usable version of TimeSince: a mobile-first Task view connected to the real API.

Visual polish is secondary to getting the complete interaction loop working correctly.

## Deliverables

Task view containing:

- Ready section;
- Upcoming section;
- section counts;
- task rows;
- task name;
- category where appropriate;
- elapsed-time display;
- completion control;
- basic loading state;
- basic error state;
- empty states.

Ready tasks should be ordered according to the product spec.

Upcoming tasks should be ordered according to the product spec.

## Acceptance criteria

A user can:

1. open TimeSince;
2. see existing tasks;
3. distinguish Ready and Upcoming tasks;
4. see elapsed time correctly;
5. complete a task;
6. see it immediately leave Ready;
7. see it appear in Upcoming when appropriate.

The UI should clearly show the actual elapsed time. The current visual direction may render a 17-day task with a 14-day target as `17⁺³ days`, but the exact notation can be refined during manual UI QA.

The interface must not use overdue/late language or warning styling.

Manual QA should verify the mobile layout, spacing, touch interactions, and overall visual direction against `mockup.png` where available.

---

# Milestone 6 — Create/edit task flow

**Status:** Complete

Completed 2026-08-11. The mobile Task view now supports creating and editing
tasks through an accessible sheet/dialog, including ordered category
selection, date-only previous completion and snooze controls interpreted in
the configured timezone, list reconciliation, and confirmed archival. Focused
frontend tests cover creation and error-preserving edits; restoration remains
API-only until a later view makes archived tasks discoverable.

## Goal

Allow tasks to be created and edited entirely from the application.

## Deliverables

Create/edit task UI supporting:

- name;
- target interval in whole days;
- category;
- optional previous/initial completion date;
- snooze/ignore-until when editing;
- archive action when editing.

Use a mobile-appropriate modal, sheet, or equivalent interaction.

## Acceptance criteria

A user can:

- create a new task;
- create a task with no category;
- create a task with a category;
- provide an initial previous completion date;
- edit an existing task;
- change target interval;
- change category;
- snooze and unsnooze a task;
- archive a task.

Validation errors should preserve entered form data and be clearly explained.

---

# Milestone 7 — Completion undo

**Status:** Complete

Completed 2026-08-11. Task completion now reconciles optimistically in both
Ready and Upcoming, retains each server-created completion ID for an
independent five-second Undo action, rolls back failed creation, and keeps
failed Undo available for retry. Focused frontend tests cover the critical
state transitions and exact-ID requests.

## Goal

Make the highest-frequency action fast and forgiving.

## Deliverables

When completing a task:

- update the UI immediately;
- persist the completion;
- show a short-lived Undo action;
- allow the exact completion just created to be removed.

Handle completion or undo failures safely.

## Acceptance criteria

- Completing a task requires one deliberate tap/click.
- No confirmation dialog appears for normal completion.
- Undo restores the previous task state.
- API failure restores/reconciles the UI correctly.
- Rapid completion interactions cannot accidentally remove an unrelated historical completion.

---

# Milestone 8 — Category view

**Status:** Complete

Completed 2026-08-11. The app now provides declarative history-based Task and
Category routes, ordered expandable category groups with retained collapse
state, active Ready/Sleeping/snoozed task discovery, Uncategorized handling,
and the existing optimistic completion, exact Undo, editing, and archival
flows within Category view. Production SPA fallback and focused frontend
interactions are covered by automated tests.

## Goal

Implement the category-oriented browsing mode shown in the product design.

## Deliverables

Category view with:

- tasks grouped by category;
- expandable/collapsible category sections;
- Uncategorized section when required;
- direct completion controls;
- elapsed-time display;
- category ordering.

All relevant tasks should be discoverable here, including sleeping and snoozed tasks.

## Acceptance criteria

A user can:

- browse tasks by category;
- expand and collapse categories;
- complete a task without leaving the category view;
- find Uncategorized tasks;
- find snoozed tasks;
- see task state change correctly after completion.

---

# Milestone 9 — Category management

**Status:** Complete

Completed 2026-08-11. Category management now provides validated create,
rename, exact-list reorder, and removal APIs; active-task counts; optional
atomic reassignment including archived tasks; a responsive, accessible
management route; and immediate reconciliation across category browsing, task
labels, and task-editor options. Focused API and frontend tests cover the core
mutation and error-preservation workflows.

## Goal

Allow categories to be managed without editing the database manually.

## Deliverables

Manage Categories UI supporting:

- create;
- rename;
- reorder;
- remove;
- active-task count.

Removing a category must not delete its tasks.

## Acceptance criteria

A user can:

- create a category;
- rename it;
- reorder categories;
- remove a category;
- see its tasks become Uncategorized;
- see category ordering reflected in Category view.

Category-name conflicts should be handled clearly.

---

# Milestone 10 — Desktop layout

**Status:** Not started

## Goal

Turn the same application into an efficient desktop tool rather than merely stretching the mobile layout.

## Deliverables

At suitable desktop breakpoints, improve:

- navigation;
- information density;
- task scanning;
- task editing;
- category management;
- keyboard usability.

Potential patterns include:

- persistent sidebar/header navigation;
- wider task rows;
- side-panel or modal editing;
- denser management views.

Do not create a second frontend or separate desktop codebase.

## Acceptance criteria

On a typical desktop viewport:

- navigation does not unnecessarily rely on a hamburger menu;
- task lists use horizontal space effectively;
- create/edit flows are efficient with mouse and keyboard;
- category management is practical for many tasks/categories;
- the same API and domain logic are shared with mobile.

---

# Milestone 11 — Search and filtering

**Status:** Not started

## Goal

Make larger task collections easy to navigate.

## Deliverables

Add lightweight search/filter controls appropriate to both Task and Category views.

Initial useful filters may include:

- text search by task name;
- category;
- Ready/Sleeping where appropriate.

Avoid adding complexity without demonstrated value.

## Acceptance criteria

- Search updates task lists predictably.
- Clearing search restores the full list.
- Filters compose sensibly.
- Filtering does not introduce new task-state concepts.
- Controls remain usable on mobile.

---

# Milestone 12 — PWA support

**Status:** Not started

## Goal

Make TimeSince installable and pleasant to launch as an app on mobile/desktop.

## Deliverables

- web app manifest;
- application icons;
- standalone display mode;
- appropriate theme/background metadata;
- basic service worker/application-shell caching.

Do not implement full offline mutation synchronisation.

## Acceptance criteria

- the production app is installable on supported devices;
- it launches in standalone mode when installed;
- application-shell behaviour is sensible when connectivity is interrupted;
- writes fail clearly when the backend is unavailable;
- no offline mutation queue exists.

---

# Milestone 13 — Accessibility and interaction polish

**Status:** Not started

## Goal

Perform a deliberate usability/accessibility pass once core behaviour is stable.

## Deliverables

Review and improve:

- semantic markup;
- keyboard navigation;
- focus management;
- focus visibility;
- touch target sizes;
- dialog behaviour;
- screen-reader labels;
- contrast;
- reduced-motion behaviour;
- empty states;
- loading/error presentation;
- accidental-completion resistance.

## Acceptance criteria

Core workflows can be completed using keyboard alone on desktop.

Interactive controls have accessible names and visible focus states.

No important state relies on colour alone.

Mobile touch targets are appropriately sized.

---

# Milestone 14 — Production deployment

**Status:** Not started

## Goal

Deploy TimeSince to the Wyse 5070 and make it privately available through Tailscale.

## Deliverables

- production build process;
- service/process management;
- SQLite production location;
- migration procedure;
- Tailscale HTTPS/private access;
- deployment documentation;
- restart/recovery procedure.

Choose either systemd or Docker Compose based on whichever produces the simpler operational setup.

## Acceptance criteria

- TimeSince survives host/application restarts;
- only intended tailnet users can reach it;
- the SQLite database persists across deployments;
- migrations can be applied repeatably;
- logs are available for diagnosis;
- the app works from both phone and desktop over Tailscale.

Do not expose the application publicly.

---

# Milestone 15 — Backups and restore

**Status:** Not started

## Goal

Ensure the application can be recovered without losing task history.

## Deliverables

- automated SQLite-consistent backups;
- retention policy;
- off-host copy;
- documented restore procedure;
- pre-migration backup procedure for risky migrations.

## Acceptance criteria

- backups run automatically;
- several historical backups are retained;
- at least one copy exists off the Wyse;
- a backup can be restored into a clean instance successfully;
- the restore process is documented and tested.

---

# Milestone 16 — v1 release review

**Status:** Not started

## Goal

Review TimeSince as a complete product before treating v1 as finished.

## Review areas

### Product

Confirm that the app:

- feels centred on "time since last done";
- contains no due/overdue framing;
- makes completion quick;
- does not punish tasks that exceed their target;
- works comfortably on mobile;
- is efficient for bulk editing on desktop.

### Functional

Verify:

- task creation/editing;
- completion;
- undo;
- snooze;
- categories;
- category management;
- Ready/Upcoming behaviour;
- search/filtering;
- completion history persistence.

### Technical

Verify:

- tests;
- typecheck;
- lint;
- production build;
- migrations;
- deployment;
- backups;
- restore.

### Documentation

Update:

- `PRODUCT_SPEC.md` if product decisions changed;
- `TECH_SPEC.md` if architecture changed;
- `AGENTS.md` with final development commands/conventions;
- this file with completed statuses.

---

# Future work

Do not pull these into v1 unless explicitly requested.

Possible later milestones:

- tags;
- notes;
- completion-history UI;
- statistics/cadence analysis;
- notifications;
- widgets;
- richer sorting;
- offline mutation support;
- native clients;
- multi-user/shared household features.

When future work is selected, add it here as a new milestone rather than quietly expanding an existing one.

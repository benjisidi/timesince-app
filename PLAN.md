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

**Status:** Complete

Completed 2026-08-11. The responsive application now uses persistent sidebar
navigation at desktop widths, wider and optionally two-column task/category
layouts, horizontally structured task rows, a right-side task editor, and a
denser category-management view. Desktop category cards compact independently
when collapsed, and task creation can keep the editor open for efficient bulk
entry while preserving the selected category. The existing mobile header,
touch targets, shared components, routes, state, and task semantics remain
intact.

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

**Status:** Complete

Completed 2026-08-11. Search is now a global responsive command-palette
interface available from every route through a visible control or Cmd/Ctrl-K.
It fuzzy-ranks one flat list of active tasks across task and category names,
opens results in the existing editor, and reuses the optimistic completion,
exact-ID Undo, error, and reconciliation workflows. Per-view filters were
intentionally left out.

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

**Status:** Complete

Completed 2026-08-11. TimeSince now builds an installable standalone PWA with
standard and maskable branding, a generated Workbox service worker limited to
the versioned application shell/static assets, explicit API cache exclusion,
clear offline/backend-unavailable behaviour, and a user-controlled update
prompt. Browser connectivity remains a wording/retry hint; failed API requests
authoritatively drive backend-unavailable state and no task data or mutations
are cached or queued offline.

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

# Milestone 13 — Information architecture and flow cleanup

**Status:** Complete

Implemented 2026-08-12. The application now uses Ready and Browse as its two
primary destinations, with persistent mobile navigation and contextual category
management. Ready remains the dominant action surface while Sleeping is a
collapsed, retained secondary section. Browse now shows visible-Ready/total
category summaries, ordered Ready/Sleeping/snoozed groups, a conditional Later
divider, and neutral snooze context. Task-editor wording and Last done/Snooze
presentation were updated without changing API contracts or task semantics.
Focused frontend coverage and the full repository validation suite pass. Manual
mobile and desktop QA was completed successfully before commit.

## Goal

Implement the agreed information-architecture changes so TimeSince better reflects its core product model:

> Tasks should surface when they are useful to think about again, without becoming overdue obligations.

This milestone is primarily about **what the app prioritises and how users move through it**, not visual polish.

---

## 1. Rename the primary views

Replace the current user-facing concepts:

- `Task view` → **Ready**
- `Category view` → **Browse**

Use these names consistently in:

- mobile navigation;
- desktop/sidebar navigation;
- page headings;
- route labels;
- empty states;
- documentation where appropriate.

The underlying routes may remain unchanged unless there is a clear reason to rename them.

Search remains a global utility rather than a primary view.

---

## 2. Rework the Ready view

The Ready view should become the clear default action surface.

### Ready tasks

- Keep Ready tasks at the top.
- Preserve the current oldest-first ordering.
- Keep one-tap completion, optimistic movement, and Undo unchanged.
- Preserve direct task editing from the row.

### Sleeping tasks

Sleeping tasks should no longer receive equal prominence.

Replace the current equally weighted Ready/Upcoming presentation with a secondary Sleeping section.

Recommended behaviour:

- label the section **Sleeping** rather than Upcoming;
- show its task count;
- collapse it by default;
- allow the user to expand it when they want to inspect sleeping tasks;
- preserve the expanded/collapsed state for the session or locally if straightforward;
- do not show countdown or urgency language;
- continue showing elapsed time and target context using the existing task-row presentation.

On wide desktop layouts, do not show Ready and Sleeping as equal side-by-side columns. Keep Ready as the dominant surface and Sleeping secondary.

### Empty Ready state

When no tasks are Ready, use positive/calm copy such as:

> Nothing is ready right now.

The UI should communicate that this is a desirable state, not an empty todo list that needs filling.

Sleeping tasks should remain accessible beneath it.

---

## 3. Rework the Browse view

Browse remains the complete active-task reference view, grouped by category.

### Category sections

Keep the existing category cards/sections and collapse behaviour.

Enhance each category heading with useful summary information, for example:

    Kitchen
    2 ready · 6 total

Use active tasks only.

### Task ordering within categories

Order tasks within each category as:

1. non-snoozed Ready tasks;
2. non-snoozed Sleeping tasks;
3. snoozed tasks.

Within the relevant groups, retain existing deterministic ordering.

### Ready vs Sleeping presentation

Do not add `Ready` or `Sleeping` labels to every task row.

Instead, where both types exist in a category, visually separate sleeping tasks with a subtle group divider such as:

> Later

The category should therefore read naturally as:

    Kitchen
    2 ready · 6 total

    [Ready task]
    [Ready task]

    Later

    [Sleeping task]
    [Sleeping task]

If a category contains only one state, omit unnecessary dividers.

### Snoozed tasks

Keep snoozed tasks visible in Browse.

Continue showing neutral `Snoozed until …` context.

Do not treat snoozed tasks as overdue, warnings, or errors.

### Uncategorized

Keep Uncategorized last and show it only when needed.

---

## 4. Simplify primary navigation

`Manage categories` should no longer be a primary navigation destination.

Primary navigation should contain only:

- Ready
- Browse

Search remains globally available.

Category management should instead be reachable from Browse through the existing contextual Manage action.

### Mobile navigation

Replace the hamburger-based primary navigation with a simpler persistent two-destination navigation pattern if it works cleanly with the existing layout.

Preferred direction:

- bottom navigation with **Ready** and **Browse**;
- Search remains available in the header;
- floating New Task action remains available.

If bottom navigation introduces substantial layout or PWA-safe-area complexity, a similarly direct two-destination alternative is acceptable, but do not retain a hamburger solely because it already exists.

### Desktop navigation

Keep the persistent sidebar, but reduce its primary navigation to:

- Ready
- Browse
- Search action

Keep category management contextual to Browse rather than primary.

---

## 5. Improve task creation terminology and flow

Keep the existing sheet/panel and `Create another task` workflow.

### Target interval

Replace technical wording such as:

> Target interval

with more user-facing wording such as:

> Show again after

Example:

    Show again after
    [ 14 ] days

The stored data model remains unchanged.

### Previous completion

Keep previous completion optional and visually secondary.

Prefer wording such as:

> Last done

or:

> Previously completed

rather than terminology that resembles scheduling.

Do not make this field more prominent than the normal create flow.

### Category creation

Inline category creation is deferred until real-world usage demonstrates that it
is needed. Keep the existing category selector and contextual Manage Categories
page; do not add category-management behaviour to the task editor in this
milestone.

---

## 6. Improve task editing

Keep the existing mobile sheet / desktop side-panel editor.

### Last completed

Show the latest completion date as normal read-only context when editing a completed task.

Do not hide it inside a snooze/advanced section.

Use calm wording such as:

> Last done: 8 August

Never display `due`, `late`, or `overdue` language.

### Snooze

Make Snooze easier to discover than it currently is.

It should remain secondary to normal editing, but it should not feel like obscure advanced metadata.

Preferred structure:

    Snooze
    [ Snooze until… ]

    Last done
    8 August

Keep:

- date-only semantics;
- `Clear snooze`;
- existing timezone behaviour.

### Archive

Keep Archive separated from normal fields in a secondary/destructive area.

Retain confirmation.

Archive restoration remains Milestone 16 and should not be added here.

---

## 7. Preserve the completion workflow

Do not redesign completion.

Keep:

- separate completion control;
- one-tap completion;
- optimistic movement;
- exact-ID Undo;
- five-second Undo lifetime;
- same behaviour from Ready, Browse, and Search.

Only make structural changes required by the new Ready/Sleeping presentation.

---

## 8. Search

Do not redesign global search.

Keep:

- Cmd/Ctrl-K;
- visible mobile/desktop Search action;
- flat fuzzy-ranked results;
- direct completion;
- result-body editing.

Update user-facing terminology only where Search references old Task/Category view names.

---

## 9. Remove obsolete or temporary UI

During implementation, remove:

- temporary QA/test copy;
- duplicated `Task view` / `Tasks` hierarchy;
- obsolete navigation code caused by the new Ready/Browse structure;
- now-unused responsive styles related to the old equal Ready/Upcoming desktop layout.

Do not perform broader architectural refactoring in this milestone; that belongs to Milestone 14.

---

## 10. Testing

Keep automated frontend testing light-touch.

Update/add focused tests for:

- Ready/Sleeping presentation;
- Sleeping collapsed by default;
- expanding Sleeping;
- Ready empty state;
- Browse Ready/Later grouping;
- category Ready/total summaries;
- navigation changes;
- task editor Last done / Snooze changes.

Do not add visual snapshots or exhaustive responsive-layout tests.

Run the full repository validation suite.

---

## 11. Manual QA

Verify at representative mobile and desktop widths.

### Ready

- Ready tasks dominate the page.
- Sleeping starts collapsed.
- Expanding/collapsing Sleeping feels natural.
- No Ready tasks produces a positive/neutral empty state.
- Completing a Ready task moves it correctly.
- Undo restores it.

### Browse

- Ready tasks appear before Later tasks.
- Category summaries are accurate.
- Snoozed tasks remain discoverable.
- Uncategorized behaves correctly.
- Collapsed category state still works.

### Navigation

- Ready/Browse are obvious primary destinations.
- Manage Categories is still easy to find from Browse.
- Search remains easy to access.
- Mobile navigation does not conflict with the floating New Task button or PWA safe areas.

### Create/edit

- Repeated creation remains fast.
- Target wording is clear.
- Last done is visible when editing.
- Snooze is easy to find.
- Archive remains clearly secondary.

---

## Acceptance criteria

- Ready is clearly the app's primary action surface.
- Sleeping tasks are accessible but visually secondary.
- Browse works as the complete active-task reference view.
- Category headers communicate Ready/total counts.
- Ready/Sleeping distinction is understandable without status labels on every row.
- Primary navigation is centred on Ready and Browse.
- Manage Categories is contextual rather than primary.
- Task creation/editing terminology is less technical.
- Completion and Search behaviour remain unchanged.
- No due/overdue framing is introduced.
- No broad code refactor is performed beyond what is necessary for these product changes.
- Full validation passes and manual QA confirms the revised flows feel coherent.


---

# Milestone 14 — Code refactor

**Status:** Complete

Completed 2026-08-12. The client now has explicit page, shared-component,
feature, API, and orchestration boundaries. `App.tsx` retains routing and
top-level coordination while Ready, Browse, category management, task editing,
Search, completion feedback, and API resources live in focused modules. A
small reducer centralises reconciliation across the independently loaded Ready,
Sleeping, Browse, and Search collections, and completion/exact-ID Undo is
encapsulated in its own workflow hook. Category/configuration ownership is no
longer duplicated, client-only ordering and Search presentation logic have
focused tests, and frontend workflow tests are organised by feature. Routes,
API contracts, database schema, shared task semantics, optimistic behaviour,
Undo timing and identity, editor/Search behaviour, and PWA behaviour remain
unchanged. The full validation suite passes with 77 tests.

## Goal

Improve maintainability after the information-architecture changes have stabilised.

Refactor only where the existing structure materially increases complexity, duplication, or risk. Do not perform broad stylistic rewrites merely to make the code look cleaner.

## Review areas

- size and responsibilities of `App.tsx`;
- route/view component boundaries;
- shared task-row and task-editor behaviour;
- task mutation/reconciliation logic;
- search state and task-cache synchronisation;
- category data loading and reconciliation;
- duplicated state or derived presentation logic;
- shared page/navigation components;
- boundaries between client API helpers, view state, and reusable domain logic.

## Deliverables

Where justified:

- extract major view components;
- centralise shared task reconciliation/mutation behaviour;
- simplify cross-view state synchronisation;
- remove obsolete code left behind by earlier milestones;
- improve naming and module boundaries;
- update tests only where behaviour-preserving refactors need protection.

Do not:

- change product behaviour intentionally;
- replace working libraries/frameworks without a concrete benefit;
- introduce a global state-management framework solely for architectural neatness;
- increase frontend test coverage for its own sake.

## Acceptance criteria

- Observable product behaviour remains unchanged.
- Existing validation suite passes.
- Major components/modules have clearer responsibilities than before.
- Cross-view mutation/reconciliation behaviour is easier to understand and extend.
- No speculative abstractions are added for unplanned future features.
- The resulting diff is explainable in terms of concrete maintainability gains.

---

# Milestone 15 — Visual polish

**Status:** Complete

Completed 2026-08-12. Page-level surtitles were removed, elapsed-time rows now
show the actual elapsed value without redundant over-target superscripts, and
target context is more legible. Desktop Ready/Sleeping category columns now
align consistently, Browse uses a compact labelled Later separator, and
pressed states provide clearer interaction feedback while preserving existing
focus, touch-target, safe-area, dialog, reduced-motion, and responsive
behaviour. Focused workflow coverage and the full validation suite pass with
77 tests; representative phone and desktop layouts were reviewed manually.

## Goal

Improve the visual quality and interaction feel of TimeSince once the information architecture and code structure are stable.

The target is calm, crisp, lightweight, and intentional rather than decorative.

## Review areas

### Typography and hierarchy

Review:

- page titles and secondary labels;
- elapsed-time prominence;
- target-interval context;
- category headers;
- small-text legibility;
- consistency between mobile and desktop.

### Spacing and layout

Review:

- task-row density;
- whitespace;
- toolbar alignment;
- card/group spacing;
- modal/sheet/panel padding;
- wide-screen balance.

### Colour and surface treatment

Review:

- green/neutral palette;
- contrast and legibility where visually weak;
- borders, shadows, and card backgrounds;
- focus/hover/pressed states;
- selected/active navigation treatment.

This is not a formal accessibility milestone, but obvious readability or interaction-quality problems should still be corrected when encountered.

### Motion and feedback

Add restrained motion only where it improves comprehension, for example:

- task completion/removal;
- Undo feedback;
- accordion expansion/collapse;
- drawer/panel transitions;
- toast appearance/removal;
- hover/pressed states.

Respect existing reduced-motion handling.

### Empty/loading/error states

Ensure these feel intentional and consistent across:

- Ready;
- Browse;
- Search;
- Category management;
- editor workflows.

### Branding

Review:

- TimeSince wordmark/mark;
- PWA icon consistency;
- header/sidebar presentation.

Avoid a broad redesign unless manual QA exposes a structural visual problem.

## Acceptance criteria

- Mobile and desktop feel like the same product.
- Visual hierarchy makes the most important information immediately scannable.
- Motion is restrained and informative.
- No interaction becomes slower or more cumbersome for aesthetic reasons.
- Empty/loading/error states are consistent and calm.
- No temporary QA/debug presentation remains.
- Full validation suite passes and manual QA covers representative phone, tablet, and desktop widths.

---

# Milestone 16 — Archived task management

**Status:** Not started

## Goal

Complete the existing archive lifecycle by making archived tasks discoverable and recoverable through the UI.

Archiving should mean "remove from normal use while preserving history", not irreversible deletion.

## Deliverables

Add a secondary archived-task management surface reachable from an appropriate management/browse location.

Support:

- listing archived tasks;
- useful identifying context such as category and last completion;
- opening archived task details in a read-only form where appropriate;
- restoring an archived task;
- preserving category, target interval, snooze data, and completion history when restored.

Archived tasks must remain excluded from normal Ready, Browse, and global Search results unless explicitly being managed.

Do not add permanent deletion unless separately specified.

## Acceptance criteria

- Archived tasks can be found without appearing in normal task workflows.
- An archived task can be restored through the UI.
- Restored tasks re-enter the appropriate active view according to their current derived state.
- Completion history is preserved.
- Restore requires no destructive confirmation.
- Existing archive behaviour remains deliberate and recoverable.
- Automated frontend coverage remains light-touch and focused on restore/reconciliation behaviour.

---

# Milestone 17 — Historical completion ("Done earlier")

**Status:** Not started

## Goal

Allow the user to record that a task was completed on an earlier local calendar date when they forgot to mark it done at the time.

This is a correction/convenience feature, not a scheduling feature.

## Product behaviour

Provide a lightweight way to choose a previous completion date for an existing task.

Potential entry points may include:

- a secondary action near Complete;
- the task editor;
- another compact action chosen during planning.

The implementation should preserve the normal one-tap "Done now" path as the dominant completion workflow.

## Deliverables

Support:

- choosing a previous local calendar date;
- creating a completion at the correct instant/date according to the configured application timezone;
- recalculating task state from the resulting completion history;
- reconciling Ready/Browse/Search views;
- Undo or correction behaviour where appropriate;
- clear wording that distinguishes historical completion from snoozing or editing the target interval.

Do not:

- introduce due dates;
- turn the task editor into a completion-history editor;
- add complex arbitrary timestamp input unless required.

## Acceptance criteria

- The user can record a task as completed on an earlier calendar day.
- Future dates are rejected.
- Existing completion history remains intact.
- Derived elapsed time reflects the historical completion correctly.
- "Done now" remains a one-tap action.
- The UI does not confuse historical completion with lateness, deadlines, or snoozing.

---

# Milestone 18 — Alpha deployment

## Goal

Deploy TimeSince as a private personal application so it can be used with real tasks and real workflows.

This is an alpha deployment intended to enable product feedback, not a final release.

## Deliverables

### Host deployment

Deploy to the Wyse 5070:

- production Node application;
- persistent SQLite database;
- migration procedure;
- process supervision/restart behaviour;
- environment configuration;
- update procedure.

Choose systemd or Docker Compose based on whichever produces the simplest reliable setup.

### Tailscale access

Configure:

- private tailnet access;
- HTTPS suitable for browser/PWA use;
- access from desktop and mobile devices;
- no public exposure.

### Basic operational safety

Implement:

- automated database backups;
- sensible backup retention;
- documented restore process;
- pre-migration backups where appropriate.

### PWA validation

Verify on the production origin:

- app installation where supported;
- standalone launch;
- manifest/icons;
- service worker lifecycle;
- app-shell behaviour;
- update behaviour.

## Acceptance criteria

- TimeSince survives application and host restarts.
- SQLite data persists across updates.
- Migrations can be applied deliberately.
- The app is accessible from intended devices.
- The app is not publicly exposed.
- Backups run automatically.
- A backup can be restored successfully.
- Updates can be deployed without losing data.
- The app is ready for regular personal use.

---

# Post-deployment iteration

After using TimeSince regularly, create future milestones based on observed friction rather than speculation.

Focus on:

- workflows that feel awkward;
- missing features that repeatedly cause problems;
- whether Ready/Browse separation works;
- whether task intervals feel natural;
- whether categories remain useful;
- whether completion history needs improvement.

Avoid adding features without evidence from actual usage.

---

# Future work

Do not pull these into the current roadmap unless real usage demonstrates a need.

Possible later work includes:

- tags;
- notes;
- richer completion-history UI;
- statistics/cadence analysis;
- notifications;
- widgets;
- richer sorting/filtering;
- true calendar-month/year recurrence;
- offline mutation support;
- native clients;
- multi-user/shared household features.

When future work is selected, add it as a new milestone rather than quietly expanding an existing one.

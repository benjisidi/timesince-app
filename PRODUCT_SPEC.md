# TimeSince — Product Specification

## 1. Product summary

**TimeSince** is a personal recurring-task tracker for tasks that do not have meaningful deadlines.

Instead of assigning due dates, each task records:

- when it was last completed;
- how long it should then **sleep** before being surfaced again;
- a single category.

The core question the app answers is:

> **How long has it been since I last did this?**

The product should deliberately avoid the language and emotional model of conventional todo apps. A household task done one day later than its preferred cadence is not "late", "overdue", or a failure.

TimeSince should feel calm, lightweight, and easy to check.

---

## 2. Product principles

### 2.1 No due dates

TimeSince has no task due dates and no overdue state.

Do not introduce:

- due dates;
- overdue/late labels;
- missed-deadline language;
- escalating warning colours;
- negative streaks or failure metrics;
- notifications framed as lateness.

A task has a **target interval**, not a deadline.

### 2.2 Completion resets the clock

Completing a task records a completion event at the current time.

The task then sleeps for its configured target interval before returning to the main "Ready" list.

Completion history is retained.

### 2.3 Surface elapsed time, not urgency

Task rows should primarily communicate **time since last completion**.

Example for a task with a 14-day target:

| Elapsed | Suggested display |
|---|---|
| 3 days | `3 days` |
| 13 days | `13 days` |
| 14 days | `14 days` |
| 17 days | `17⁺³ days` |

The current UI direction is to keep showing the **actual elapsed time** and, once the target has been passed, optionally add the amount beyond the target as a small superscript `+X`.

Thus `17⁺³ days` is one intended presentation for:

- total time since completion: 17 days;
- target interval: 14 days;
- 3 additional days beyond the target.

This notation is a visual convention rather than a core product rule. It may be refined during UI work provided the interface still prioritises elapsed time and does not frame the task as late or overdue.

A secondary label such as `Target: 14 days` may be shown where useful, especially before the target is reached.

### 2.4 Mobile first, desktop capable

The primary interaction surface is a phone.

The same application must also provide an efficient desktop layout for:

- creating many tasks;
- editing several tasks quickly;
- managing categories;
- scanning larger task lists.

Use one responsive application. Do not create separate mobile and desktop products or an `m.` subdomain.

### 2.5 Fast completion

Marking a task complete is the highest-frequency action and should require one deliberate tap/click.

Do not show a confirmation dialog for ordinary completion.

Instead, show a short-lived **Undo** action after completion.

### 2.6 Calm visual language

The interface should not try to make the user feel behind.

Prefer neutral presentation. Do not use red, warning icons, exclamation marks, or urgency gradients merely because a task has passed its target interval.

Over-target information should remain visible but visually secondary.

---

## 3. Terminology

Use these terms consistently.

### Task
A recurring activity the user wants to track.

### Category
A single grouping assigned to a task, e.g. `Kitchen`, `Bedroom`, `Admin`, or `Garden`.

A task may have no category and then appears under **Uncategorized**.

### Target interval
The preferred amount of time between completions.

For v1, target intervals are expressed in whole days.

### Sleeping
A task whose target interval has not yet elapsed since its latest completion.

### Ready
A task whose target interval has elapsed and which may be surfaced for completion.

"Ready" does **not** mean overdue.

### Completion
A timestamped record that the task was done.

### Snoozed / ignored
A temporary instruction not to surface a task until a specified time/date.

Snoozing does not create a completion and does not alter completion history.

---

## 4. Core task behaviour

For each task derive:

- `lastCompletedAt`: most recent completion, if any;
- `elapsedDays`: days since the latest completion;
- `targetDays`: configured target interval;
- `overageDays = max(0, elapsedDays - targetDays)`.

A task is **Ready** when:

- it has never been completed; or
- its target interval has elapsed;

and it is not currently snoozed.

A task is **Sleeping** when its target interval has not elapsed.

A task that has passed its target by one day and one that has passed it by fifty days are both simply **Ready**.

There is no additional overdue state.

### Never-completed tasks

A task with no completion history should show `Never` as its elapsed-time value and should be Ready immediately.

When creating a task, the user may optionally provide a previous completion date. This lets an existing real-world routine be entered without falsely marking it complete at creation time.

Previous-completion and snooze controls use local calendar dates in the
application's configured timezone. A selected date represents the start of
that calendar day in that timezone.

---

## 5. Primary views

## 5.1 Task view

This is the default day-to-day view.

It contains:

### Ready
Tasks whose sleep interval has elapsed.

Display a count in the section heading.

### Upcoming
Sleeping tasks.

This section may be collapsible because it is secondary to the Ready list.

"Upcoming" means only that the task is still sleeping. Do not display a countdown such as "3 days remaining" by default.

Suggested ordering:

- Ready: longest time since completion first;
- Upcoming: longest time since completion first;
- never-completed tasks: at the top of Ready.

Each row should show at minimum:

- completion control;
- task name;
- category, if useful in this cross-category view;
- elapsed-time display;
- target interval as secondary context where needed.

Completing a Ready task should cause it to leave Ready immediately and enter Upcoming.

---

## 5.2 Category view

Shows tasks grouped by category.

This is useful for situations such as walking into a room and asking "what can I do here?"

Requirements:

- categories are expandable/collapsible;
- show an `Uncategorized` group when required;
- category sections show all relevant tasks rather than only Ready tasks;
- each task remains completable directly from the list;
- filters/search may be added without changing the underlying task model.

On desktop, category groups may use a denser layout than mobile.

---

## 5.3 Create/edit task

A task editor should support:

- name;
- target interval in days;
- category;
- optional previous/initial completion date;
- optional snooze/ignore-until value when editing;
- archive/delete action when editing an existing task.

Archived tasks retain their fields and completion history. They are read-only
until explicitly restored to active status.

Keep the common path short. Advanced controls should not dominate the editor.

---

## 5.4 Manage categories

The user can:

- create a category;
- rename a category;
- reorder categories;
- remove a category;
- see how many active tasks belong to it.

Removing a category must not delete its tasks.

Tasks in a removed category become Uncategorized unless the user explicitly chooses another category.

---

## 5.5 Menu/navigation

Mobile navigation should remain compact.

The mockup's menu model is suitable for v1:

- Task view;
- Category view;
- Manage categories;
- Settings when settings actually exist.

Desktop navigation may move these options into a persistent sidebar/header where space allows.

Do not preserve a hamburger menu on desktop merely for visual consistency if a clearer desktop control is available.

---

## 6. Task row interaction

### Complete

The checkbox/control means **I did this now**.

On activation:

1. create a completion event;
2. update the row immediately;
3. move the task to the appropriate section;
4. show an Undo action.

### Open/edit

Tapping/clicking the task name or row body should open task details/editing without marking it complete.

### Snooze

The user may temporarily hide a Ready task until a chosen date.

Snoozing:

- does not change "time since last done";
- does not affect completion history;
- suppresses the task from Ready until the snooze expires.

The task should still be discoverable in category/all-task views.

---

## 7. Desktop experience

The desktop experience is not simply a stretched phone layout.

Use additional width to improve efficiency, for example:

- persistent navigation;
- wider task rows;
- category and task information visible simultaneously;
- modal or side-panel editing;
- keyboard-friendly forms;
- denser management views.

The mobile and desktop layouts should share the same product concepts, state, API, and components wherever sensible.

Do not maintain separate codebases.

---

## 8. Accessibility and interaction quality

The app should:

- use semantic buttons, inputs, headings, and dialogs;
- support keyboard navigation on desktop;
- provide clearly visible focus states;
- use touch targets appropriate for a phone;
- never rely on colour alone to communicate state;
- preserve readable contrast;
- respect reduced-motion preferences;
- avoid accidental completion through tiny or ambiguous controls.

Animations should be brief and functional.

---

## 9. v1 scope

v1 includes:

- responsive mobile/desktop web UI;
- installable PWA;
- Task view;
- Category view;
- task creation/editing;
- single category per task;
- category management;
- completion history;
- mark complete + undo;
- target interval in whole days;
- elapsed/over-target display;
- snooze/ignore-until;
- task archiving;
- task restoration;
- SQLite persistence;
- private deployment through Tailscale;
- basic backup/restore procedure.

---

## 10. Explicit non-goals for v1

Do not implement unless the product spec is intentionally changed:

- user accounts;
- public access;
- multiple users;
- shared household task assignment;
- tags;
- multiple categories per task;
- complex recurrence rules;
- calendar integration;
- conventional due dates;
- overdue state;
- penalties/streak failures;
- native mobile applications;
- push notifications;
- full offline mutation/synchronisation;
- gamification;
- AI task suggestions.

The data/API design should not intentionally block reasonable future additions, but do not build speculative infrastructure for them.

---

## 11. Future possibilities

Possible later additions include:

- tags;
- task notes;
- completion-history view;
- cadence statistics;
- configurable sorting;
- widgets;
- reminders framed neutrally;
- native clients;
- offline support;
- shared households.

These are not current requirements.

---

## 12. Product decision rule for agents

When a design choice is ambiguous, favour the option that:

1. keeps completion fast;
2. emphasises elapsed time rather than lateness;
3. reduces cognitive load;
4. works well on a phone;
5. preserves useful history;
6. avoids adding concepts that are not needed.

If a proposed feature starts to resemble a conventional deadline-driven todo app, stop and check the product direction before implementing it.

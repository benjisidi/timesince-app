# AGENTS.md

This repository contains **TimeSince**, a small personal recurring-task tracker.

Before making product or architecture decisions, read:

1. `PRODUCT_SPEC.md`
2. `TECH_SPEC.md`

Those files are authoritative for product direction and agreed technical constraints.

## Repository commands

Use Node.js 22 (`.nvmrc`) and npm.

```text
npm ci                  install dependencies from the lockfile
npm run dev             start the frontend and backend in development
npm run db:migrate      apply database migrations explicitly
npm run check           run typecheck, lint, format check, tests, and build
npm run build           create the production frontend and server bundles
NODE_ENV=production npm start
                        run the production build
```

Application startup does not apply database migrations automatically.

---

## Git workflow

### Before changing code

- Inspect the current working tree with `git status`.
- Do not overwrite or revert existing user changes.
- Read relevant existing code and tests before editing.
- Keep the scope of the requested change narrow.

### Branches

When working on a branch, use a short descriptive name such as:

```text
feat/task-completion
feat/category-management
fix/completion-undo
refactor/task-state
```

Do not create or switch branches unless appropriate for the current environment/request.

Do not merge to the default branch unless explicitly asked.

### Commits

Prefer small, coherent commits.

A commit should represent one understandable change.

Suggested commit style:

```text
feat: add task completion endpoint
fix: preserve elapsed state when snoozing
refactor: centralize task state calculation
test: cover never-completed tasks
docs: clarify category deletion behaviour
```

Do not mix unrelated formatting, refactors, dependency upgrades, and feature work in the same commit.

Do not create commits unless the user/request expects repository changes to be committed.

### History safety

Never:

- force-push;
- rewrite published history;
- use `git reset --hard` on user work;
- discard uncommitted changes;
- amend a user's existing commit;

unless explicitly instructed to do so.

If the worktree already contains unrelated changes, preserve them.

---

## Working style

- Prefer the simplest implementation satisfying the specs.
- Do not add speculative abstractions for future features.
- Do not add conventional due/overdue semantics; this is a core product constraint.
- Keep task-state calculations centralised rather than reimplementing them in components.
- Add or update tests when behaviour changes, prioritising domain, persistence, API, and important state-changing workflows.
- Keep frontend tests deliberately light-touch; the user will manually QA each milestone.
- Do not add broad tests for layout, styling, responsive presentation, simple presentational components, or exact DOM structure unless there is a specific regression risk.
- Prefer a small number of high-value interaction/end-to-end tests over exhaustive component coverage.
- Run the relevant tests/typecheck/lint before considering work complete.
- Fix errors caused by your changes; do not opportunistically rewrite unrelated code.
- Preserve mobile-first usability while ensuring desktop workflows remain efficient.
- Keep accessibility in mind for all interactive UI work.

---

## Documentation changes

Update the specs when a change intentionally alters product or architectural behaviour.

Do not silently implement behaviour that contradicts `PRODUCT_SPEC.md` or `TECH_SPEC.md`.

If a requested change conflicts with a spec:

1. call out the conflict;
2. update the relevant spec as part of the change if the new direction is intentional;
3. then update the implementation.

---

## Dependencies

Before adding a dependency:

- confirm the problem cannot reasonably be solved with existing dependencies/platform APIs;
- prefer mature, well-maintained packages;
- avoid large frameworks for small local problems;
- keep production dependencies minimal.

Do not upgrade unrelated dependencies as part of feature work.

---

## Database changes

- Use migrations for every schema change.
- Never manually mutate the production schema as the implementation path.
- Preserve existing data.
- Add a migration test or otherwise verify a fresh database can be created from migrations.
- Treat destructive migrations as exceptional and document backup requirements.

---

## Completion checklist

Before finishing a code change, check:

- requested behaviour is implemented;
- any required manual UI QA points are called out to the user;
- product semantics still match `PRODUCT_SPEC.md`;
- types pass;
- relevant tests pass;
- lint/format checks pass if configured;
- no unrelated files were changed;
- migrations are included when required;
- documentation reflects intentional behaviour changes;
- `git diff` contains only expected changes.

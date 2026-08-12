import { fuzzy } from "fast-fuzzy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import type { CategoryResponse, TaskResponse } from "../shared/api";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  renameCategory,
  reorderCategories,
} from "./api/categories";
import {
  BACKEND_STATUS_EVENT,
  TaskApiError,
  type BackendStatus,
} from "./api/client";
import {
  fetchCategoryView,
  fetchEditorDependencies,
  fetchTaskView,
} from "./api/loaders";
import {
  archiveTask,
  completeTask,
  createTask,
  fetchAllActiveTasks,
  fetchTask,
  undoCompletion,
  updateTask,
} from "./api/tasks";
import { AppNavigation } from "./components/AppNavigation";
import { AddTaskButton, TaskRow } from "./components/TaskList";
import { BrowsePage } from "./pages/BrowsePage";
import { ReadyPage } from "./pages/ReadyPage";
import { PwaStatus } from "./PwaStatus";

type LoadState = "loading" | "ready" | "error";
type DependencyState = "idle" | LoadState;
type EditorState = { mode: "create" } | { mode: "edit"; task: TaskResponse };

interface EditorDependencies {
  categories: CategoryResponse[];
  timeZone: string;
}

interface TaskDraft {
  name: string;
  targetIntervalDays: string;
  categoryId: string;
  initialCompletedAt: string;
  snoozedUntil: string | null;
}

type FormErrors = Partial<Record<keyof TaskDraft, string>>;
type UndoStatus = "available" | "undoing" | "failed";

interface UndoItem {
  id: number;
  completionId: number;
  taskId: number;
  taskName: string;
  status: UndoStatus;
  shouldFocus: boolean;
}

const UNDO_LIFETIME_MS = 5_000;
const SLEEPING_EXPANDED_KEY = "timesince.sleeping-expanded.v1";
const SEARCH_MATCH_THRESHOLD = 0.6;

function rankSearchResults(tasks: TaskResponse[], query: string) {
  const term = query.trim();
  if (!term) return [];

  return tasks
    .map((task) => {
      const nameScore = fuzzy(term, task.name);
      const categoryScore = fuzzy(term, task.category?.name ?? "Uncategorized");
      return {
        task,
        score: nameScore * 2 + categoryScore,
        isRelevant:
          Math.max(nameScore, categoryScore) >= SEARCH_MATCH_THRESHOLD,
      };
    })
    .filter(({ isRelevant }) => isRelevant)
    .sort((first, second) => second.score - first.score)
    .map(({ task }) => task);
}

function compareByNameAndId(first: TaskResponse, second: TaskResponse) {
  return first.name.localeCompare(second.name) || first.id - second.id;
}

function compareReady(first: TaskResponse, second: TaskResponse) {
  if (first.elapsedDays === null && second.elapsedDays !== null) return -1;
  if (first.elapsedDays !== null && second.elapsedDays === null) return 1;
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

function compareSleeping(first: TaskResponse, second: TaskResponse) {
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

function dateInTimeZone(timestamp: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatTaskDate(timestamp: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(timestamp));
}

interface TaskEditorProps {
  editor: EditorState;
  dependencies: EditorDependencies | null;
  dependencyState: DependencyState;
  onRetryDependencies: () => void;
  onClose: () => void;
  onSaved: (
    task: TaskResponse,
    action: "created" | "updated",
    keepOpen?: boolean,
  ) => void;
  onArchived: (task: TaskResponse) => void;
}

function TaskEditor({
  editor,
  dependencies,
  dependencyState,
  onRetryDependencies,
  onClose,
  onSaved,
  onArchived,
}: TaskEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const task = editor.mode === "edit" ? editor.task : null;
  const [draft, setDraft] = useState<TaskDraft>({
    name: task?.name ?? "",
    targetIntervalDays: task ? String(task.targetIntervalDays) : "",
    categoryId: task?.category ? String(task.category.id) : "",
    initialCompletedAt: "",
    snoozedUntil: task?.snoozedUntil ? null : "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  const [openedAt] = useState(() => new Date());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, []);

  function setField(field: keyof TaskDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  function validate(): { errors: FormErrors; targetIntervalDays?: number } {
    const nextErrors: FormErrors = {};
    if (!draft.name.trim()) nextErrors.name = "Enter a task name.";

    const targetIntervalDays = Number(draft.targetIntervalDays);
    if (
      !/^[1-9]\d*$/.test(draft.targetIntervalDays) ||
      !Number.isSafeInteger(targetIntervalDays)
    ) {
      nextErrors.targetIntervalDays = "Enter a whole number of at least 1.";
    }

    if (dependencies) {
      const today = dateInTimeZone(openedAt, dependencies.timeZone);
      if (draft.initialCompletedAt && draft.initialCompletedAt > today) {
        nextErrors.initialCompletedAt = "Choose today or an earlier date.";
      }
      if (snoozedUntil && snoozedUntil <= today) {
        nextErrors.snoozedUntil = "Choose a future date.";
      }
    }
    return { errors: nextErrors, targetIntervalDays };
  }

  function applyApiError(error: unknown) {
    if (error instanceof TaskApiError) {
      const nextErrors: FormErrors = {};
      const fieldMap: Record<string, keyof TaskDraft> = {
        name: "name",
        targetIntervalDays: "targetIntervalDays",
        categoryId: "categoryId",
        initialCompletedAt: "initialCompletedAt",
        snoozedUntil: "snoozedUntil",
      };
      for (const [field, message] of Object.entries(error.fields)) {
        const draftField = fieldMap[field];
        if (draftField) nextErrors[draftField] = message;
      }
      setErrors(nextErrors);
      setFormError(error.message);
    } else {
      setFormError(
        "Couldn’t save the task. Check your connection and try again.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dependencies || dependencyState !== "ready") return;

    const validation = validate();
    setErrors(validation.errors);
    setFormError(null);
    if (Object.values(validation.errors).some(Boolean)) return;

    setIsSaving(true);
    try {
      const common = {
        name: draft.name.trim(),
        categoryId: draft.categoryId ? Number(draft.categoryId) : null,
        targetIntervalDays: validation.targetIntervalDays as number,
      };
      if (editor.mode === "create") {
        const saved = await createTask({
          ...common,
          initialCompletedAt: draft.initialCompletedAt || null,
        });
        onSaved(saved, "created", createAnother);
        if (createAnother) {
          setDraft((current) => ({
            ...current,
            name: "",
            targetIntervalDays: "",
            initialCompletedAt: "",
          }));
          setErrors({});
          window.setTimeout(() => nameInputRef.current?.focus(), 0);
        }
      } else {
        const saved = await updateTask(editor.task.id, {
          ...common,
          snoozedUntil: snoozedUntil || null,
        });
        onSaved(saved, "updated");
      }
    } catch (error) {
      applyApiError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchive() {
    if (!task) return;
    setIsArchiving(true);
    setFormError(null);
    try {
      await archiveTask(task.id);
      onArchived(task);
    } catch (error) {
      setFormError(
        error instanceof TaskApiError
          ? error.message
          : "Couldn’t archive the task. Check your connection and try again.",
      );
      setConfirmArchive(false);
    } finally {
      setIsArchiving(false);
    }
  }

  const isBusy = isSaving || isArchiving;
  const heading = editor.mode === "create" ? "Create task" : "Edit task";
  const lastCompleted =
    task && dependencies
      ? task.lastCompletedAt
        ? formatTaskDate(task.lastCompletedAt, dependencies.timeZone)
        : "Never"
      : null;
  const today = dependencies
    ? dateInTimeZone(openedAt, dependencies.timeZone)
    : null;
  const snoozedUntil =
    draft.snoozedUntil ??
    (task?.snoozedUntil && dependencies
      ? dateInTimeZone(new Date(task.snoozedUntil), dependencies.timeZone)
      : "");

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog"
      aria-labelledby="task-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!isBusy) onClose();
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Task details</p>
            <h2
              id="task-editor-heading"
              tabIndex={-1}
              data-initial-focus={editor.mode === "edit" ? "" : undefined}
            >
              {heading}
            </h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            disabled={isBusy}
            aria-label={`Close ${heading.toLowerCase()}`}
          >
            ×
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <label className="form-field">
            <span>Name</span>
            <input
              ref={nameInputRef}
              data-initial-focus={editor.mode === "create" ? "" : undefined}
              value={draft.name}
              onChange={(event) => setField("name", event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "name-error" : undefined}
              disabled={isBusy}
              required
            />
            {errors.name ? <small id="name-error">{errors.name}</small> : null}
          </label>

          <label className="form-field">
            <span>
              Show again after <small>days</small>
            </span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={draft.targetIntervalDays}
              onChange={(event) =>
                setField("targetIntervalDays", event.target.value)
              }
              aria-invalid={Boolean(errors.targetIntervalDays)}
              aria-describedby={
                errors.targetIntervalDays ? "target-error" : undefined
              }
              disabled={isBusy}
              required
            />
            {errors.targetIntervalDays ? (
              <small id="target-error">{errors.targetIntervalDays}</small>
            ) : null}
          </label>

          <label className="form-field">
            <span>Category</span>
            <select
              value={draft.categoryId}
              onChange={(event) => setField("categoryId", event.target.value)}
              disabled={isBusy || dependencyState !== "ready"}
              aria-describedby={
                errors.categoryId ? "category-error" : undefined
              }
            >
              <option value="">Uncategorized</option>
              {dependencies?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {dependencyState === "loading" ? (
              <small>Loading categories…</small>
            ) : null}
            {dependencyState === "error" ? (
              <span className="dependency-error">
                <small>Couldn’t load categories.</small>
                <button type="button" onClick={onRetryDependencies}>
                  Retry
                </button>
              </span>
            ) : null}
            {errors.categoryId ? (
              <small id="category-error">{errors.categoryId}</small>
            ) : null}
          </label>

          {editor.mode === "create" ? (
            <details className="advanced-fields">
              <summary>Previously completed</summary>
              <label className="form-field">
                <span>
                  Last done <small>optional</small>
                </span>
                <input
                  type="date"
                  value={draft.initialCompletedAt}
                  onChange={(event) =>
                    setField("initialCompletedAt", event.target.value)
                  }
                  max={today ?? undefined}
                  aria-invalid={Boolean(errors.initialCompletedAt)}
                  aria-describedby={
                    errors.initialCompletedAt
                      ? "completion-date-error"
                      : "date-timezone-help"
                  }
                  disabled={isBusy || dependencyState !== "ready"}
                />
                {errors.initialCompletedAt ? (
                  <small id="completion-date-error">
                    {errors.initialCompletedAt}
                  </small>
                ) : null}
              </label>
            </details>
          ) : (
            <div className="edit-task-context">
              <div className="last-done-context">
                <span>Last done</span>
                <strong>{lastCompleted ?? "Loading…"}</strong>
              </div>
              <section
                className="snooze-fields"
                aria-labelledby="snooze-heading"
              >
                <h3 id="snooze-heading">Snooze</h3>
                <label className="form-field">
                  <span>
                    Snooze until <small>optional</small>
                  </span>
                  <input
                    type="date"
                    value={snoozedUntil}
                    onChange={(event) =>
                      setField("snoozedUntil", event.target.value)
                    }
                    min={today ? addCalendarDays(today, 1) : undefined}
                    aria-invalid={Boolean(errors.snoozedUntil)}
                    aria-describedby={
                      errors.snoozedUntil
                        ? "snooze-date-error"
                        : "date-timezone-help"
                    }
                    disabled={isBusy || dependencyState !== "ready"}
                  />
                  {errors.snoozedUntil ? (
                    <small id="snooze-date-error">{errors.snoozedUntil}</small>
                  ) : null}
                </label>
                {snoozedUntil ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setField("snoozedUntil", "")}
                    disabled={isBusy}
                  >
                    Clear snooze
                  </button>
                ) : null}
              </section>
            </div>
          )}

          {dependencies ? (
            <p className="timezone-help" id="date-timezone-help">
              Dates use {dependencies.timeZone}.
            </p>
          ) : null}

          {editor.mode === "create" ? (
            <label className="create-another-option">
              <input
                type="checkbox"
                checked={createAnother}
                onChange={(event) => setCreateAnother(event.target.checked)}
                disabled={isBusy}
              />
              <span>
                Create another task
                <small>Keep this panel open and reuse the category.</small>
              </span>
            </label>
          ) : null}

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={isBusy || dependencyState !== "ready"}
            >
              {isSaving
                ? "Saving…"
                : editor.mode === "create"
                  ? "Create task"
                  : "Save changes"}
            </button>
          </div>
        </form>

        {task ? (
          <div className="archive-area">
            {confirmArchive ? (
              <div role="alert">
                <p>
                  Archive “{task.name}”? It will leave Ready and Browse, but its
                  completion history will be kept.
                </p>
                <div className="archive-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirmArchive(false)}
                    disabled={isBusy}
                  >
                    Keep task
                  </button>
                  <button
                    type="button"
                    className="archive-button"
                    onClick={() => void handleArchive()}
                    disabled={isBusy}
                  >
                    {isArchiving ? "Archiving…" : "Archive task"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-button archive-trigger"
                onClick={() => setConfirmArchive(true)}
                disabled={isBusy}
              >
                Archive task
              </button>
            )}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

function optimisticallyCompleteTask(task: TaskResponse): TaskResponse {
  return {
    ...task,
    lastCompletedAt: new Date().toISOString(),
    elapsedDays: 0,
    overageDays: 0,
    state: "sleeping",
    visibleInReady: false,
  };
}

interface UndoToastProps {
  item: UndoItem;
  onExpire: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

function UndoToast({ item, onExpire, onUndo }: UndoToastProps) {
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const remainingMsRef = useRef(UNDO_LIFETIME_MS);
  const hasFocusedRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);

  useEffect(() => {
    if (
      !item.shouldFocus ||
      item.status !== "available" ||
      hasFocusedRef.current
    ) {
      return;
    }
    hasFocusedRef.current = true;
    undoButtonRef.current?.focus();
  }, [item.shouldFocus, item.status]);

  useEffect(() => {
    if (item.status !== "available" || isHovered || hasFocusWithin) return;

    const startedAt = Date.now();
    const timer = window.setTimeout(
      () => onExpire(item.id),
      remainingMsRef.current,
    );
    return () => {
      window.clearTimeout(timer);
      remainingMsRef.current = Math.max(
        0,
        remainingMsRef.current - (Date.now() - startedAt),
      );
    };
  }, [hasFocusWithin, isHovered, item.id, item.status, onExpire]);

  return (
    <section
      className={`undo-toast${item.status === "failed" ? " undo-toast-error" : ""}`}
      aria-label={`Completion feedback for ${item.taskName}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setHasFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHasFocusWithin(false);
        }
      }}
    >
      <div>
        <p>{item.status === "failed" ? "Undo failed" : "Completed"}</p>
        <span>{item.taskName}</span>
        {item.status === "failed" ? (
          <small role="alert">Check your connection and try again.</small>
        ) : null}
      </div>
      <button
        ref={undoButtonRef}
        type="button"
        disabled={item.status === "undoing"}
        aria-label={`${item.status === "failed" ? "Retry undo for" : "Undo completion of"} ${item.taskName}`}
        onClick={() => onUndo(item)}
      >
        {item.status === "undoing"
          ? "Undoing…"
          : item.status === "failed"
            ? "Retry"
            : "Undo"}
      </button>
    </section>
  );
}

interface UndoStackProps {
  items: UndoItem[];
  onExpire: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

function UndoStack({ items, onExpire, onUndo }: UndoStackProps) {
  if (items.length === 0) return null;

  return (
    <aside className="undo-stack" aria-label="Completion actions">
      {items.map((item) => (
        <UndoToast
          key={item.id}
          item={item}
          onExpire={onExpire}
          onUndo={onUndo}
        />
      ))}
    </aside>
  );
}

interface TaskSearchDialogProps {
  loadState: DependencyState;
  tasks: TaskResponse[];
  query: string;
  completionError: string | null;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  undoItems: UndoItem[];
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onClose: () => void;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onSelect: (task: TaskResponse) => void;
  onExpireUndo: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

function TaskSearchDialog({
  loadState,
  tasks,
  query,
  completionError,
  completingTaskIds,
  completionDisabledTaskIds,
  undoItems,
  onQueryChange,
  onRetry,
  onClose,
  onComplete,
  onSelect,
  onExpireUndo,
  onUndo,
}: TaskSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = rankSearchResults(tasks, query);
  const hasQuery = Boolean(query.trim());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleBackdropClick = (event: globalThis.MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="task-search-dialog"
      aria-labelledby="task-search-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="task-search-panel">
        <div className="task-search-heading">
          <h2 id="task-search-heading">Search tasks</h2>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="Close search"
          >
            ×
          </button>
        </div>

        <label className="task-search-input">
          <span className="visually-hidden">Search active tasks</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by task or category"
            autoComplete="off"
          />
        </label>

        {loadState === "idle" || loadState === "loading" ? (
          <p className="search-status" role="status">
            Loading tasks…
          </p>
        ) : null}
        {loadState === "error" ? (
          <div className="search-status error-state" role="alert">
            <p>Couldn’t load tasks. Check your connection and try again.</p>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}
        {loadState === "ready" && tasks.length === 0 ? (
          <p className="search-status">No active tasks to search.</p>
        ) : null}
        {loadState === "ready" && tasks.length > 0 && !hasQuery ? (
          <p className="search-status">Start typing to search active tasks.</p>
        ) : null}
        {loadState === "ready" && hasQuery && results.length === 0 ? (
          <p className="search-status">No tasks match that search.</p>
        ) : null}
        {completionError ? (
          <p className="completion-error search-completion-error" role="alert">
            {completionError}
          </p>
        ) : null}
        {loadState === "ready" && hasQuery && results.length > 0 ? (
          <ul className="task-list search-results" aria-label="Search results">
            {results.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isCompleting={completingTaskIds.has(task.id)}
                isCompletionDisabled={completionDisabledTaskIds.has(task.id)}
                onComplete={onComplete}
                onEdit={onSelect}
              />
            ))}
          </ul>
        ) : null}
      </div>
      <UndoStack items={undoItems} onExpire={onExpireUndo} onUndo={onUndo} />
    </dialog>
  );
}

function readSleepingExpanded() {
  try {
    return window.localStorage.getItem(SLEEPING_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

interface CategoryDeleteDialogProps {
  category: CategoryResponse;
  categories: CategoryResponse[];
  onCancel: () => void;
  onDelete: (replacementCategoryId: number | null) => Promise<void>;
}

function CategoryDeleteDialog({
  category,
  categories,
  onCancel,
  onDelete,
}: CategoryDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const taskLabel = category.activeTaskCount === 1 ? "task" : "tasks";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, []);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onDelete(replacementId ? Number(replacementId) : null);
    } catch (deleteError) {
      setError(
        deleteError instanceof TaskApiError
          ? deleteError.message
          : "Couldn’t remove the category. Check your connection and try again.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog delete-category-dialog"
      aria-labelledby="delete-category-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!isDeleting) onCancel();
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Remove category</p>
            <h2 id="delete-category-heading" tabIndex={-1} data-initial-focus>
              Remove {category.name}?
            </h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Close category removal"
          >
            ×
          </button>
        </div>
        <p className="delete-category-summary">
          {category.activeTaskCount} active {taskLabel} will be reassigned. No
          tasks or completion history will be deleted. Any archived tasks in
          this category will be reassigned too.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="form-field">
          <span>Move tasks to</span>
          <select
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
            disabled={isDeleting}
          >
            <option value="">Uncategorized</option>
            {categories
              .filter((candidate) => candidate.id !== category.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="archive-button"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? "Removing…" : "Remove category"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface ManageCategoriesProps {
  loadState: LoadState;
  categories: CategoryResponse[];
  onRetry: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (categoryId: number, name: string) => Promise<void>;
  onReorder: (categoryIds: number[]) => Promise<void>;
  onDelete: (
    categoryId: number,
    replacementCategoryId: number | null,
  ) => Promise<void>;
}

function ManageCategories({
  loadState,
  categories,
  onRetry,
  onCreate,
  onRename,
  onReorder,
  onDelete,
}: ManageCategoriesProps) {
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] =
    useState<CategoryResponse | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null) renameInputRef.current?.focus();
  }, [editingId]);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof TaskApiError
      ? (error.fields.name ?? error.message)
      : fallback;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    setCreateError(null);
    if (!name) {
      setCreateError("Enter a category name.");
      return;
    }
    setBusyAction("create");
    try {
      await onCreate(name);
      setCreateName("");
      setAnnouncement(`Created ${name}.`);
    } catch (error) {
      setCreateError(
        errorMessage(error, "Couldn’t create the category. Try again."),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRename(
    event: FormEvent<HTMLFormElement>,
    category: CategoryResponse,
  ) {
    event.preventDefault();
    const name = renameValue.trim();
    setActionError(null);
    if (!name) {
      setActionError("Enter a category name.");
      return;
    }
    setBusyAction(`rename-${category.id}`);
    try {
      await onRename(category.id, name);
      setEditingId(null);
      setAnnouncement(`Renamed ${category.name} to ${name}.`);
    } catch (error) {
      setActionError(
        errorMessage(error, "Couldn’t rename the category. Try again."),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= categories.length) return;
    const reordered = categories.map(({ id }) => id);
    [reordered[index], reordered[destination]] = [
      reordered[destination]!,
      reordered[index]!,
    ];
    setActionError(null);
    setBusyAction("reorder");
    try {
      await onReorder(reordered);
      setAnnouncement(`Moved ${categories[index]!.name}.`);
    } catch (error) {
      setActionError(
        error instanceof TaskApiError
          ? error.message
          : "Couldn’t reorder categories. Try again.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const isBusy = busyAction !== null;

  return (
    <main
      className="task-page manage-categories-page"
      aria-labelledby="manage-categories-title"
    >
      <div className="page-intro">
        <div>
          <p className="eyebrow">Organise where tasks belong</p>
          <h1 id="manage-categories-title">Manage categories</h1>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className="page-status" role="status">
          Loading categories…
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className="page-status error-state" role="alert">
          <p>Couldn’t load categories. Check your connection and try again.</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {loadState === "ready" ? (
        <>
          <form
            className="create-category-form"
            onSubmit={(event) => void handleCreate(event)}
            noValidate
          >
            <label className="form-field">
              <span>New category</span>
              <span className="category-create-controls">
                <input
                  value={createName}
                  onChange={(event) => {
                    setCreateName(event.target.value);
                    setCreateError(null);
                  }}
                  aria-invalid={Boolean(createError)}
                  aria-describedby={
                    createError ? "create-category-error" : undefined
                  }
                  disabled={isBusy}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isBusy}
                >
                  {busyAction === "create" ? "Adding…" : "Add"}
                </button>
              </span>
              {createError ? (
                <small id="create-category-error" role="alert">
                  {createError}
                </small>
              ) : null}
            </label>
          </form>

          {categories.length === 0 ? (
            <p className="all-tasks-empty">
              No categories yet. Add one to start organising tasks.
            </p>
          ) : (
            <section className="category-management" aria-label="Categories">
              {actionError ? (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              ) : null}
              <ol className="category-management-list">
                {categories.map((category, index) => {
                  const countLabel = `${category.activeTaskCount} ${category.activeTaskCount === 1 ? "active task" : "active tasks"}`;
                  const isEditing = editingId === category.id;
                  return (
                    <li key={category.id}>
                      {isEditing ? (
                        <form
                          className="category-rename-form"
                          onSubmit={(event) =>
                            void handleRename(event, category)
                          }
                        >
                          <label>
                            <span className="visually-hidden">
                              Category name
                            </span>
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(event) => {
                                setRenameValue(event.target.value);
                                setActionError(null);
                              }}
                              aria-invalid={Boolean(actionError)}
                              disabled={isBusy}
                            />
                          </label>
                          <button
                            className="primary-button"
                            type="submit"
                            disabled={isBusy}
                          >
                            {busyAction === `rename-${category.id}`
                              ? "Saving…"
                              : "Save"}
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setEditingId(null);
                              setActionError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="category-management-identity">
                            <h2>{category.name}</h2>
                            <span>{countLabel}</span>
                          </div>
                          <div className="category-management-actions">
                            <button
                              type="button"
                              onClick={() => void moveCategory(index, -1)}
                              disabled={isBusy || index === 0}
                              aria-label={`Move ${category.name} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => void moveCategory(index, 1)}
                              disabled={
                                isBusy || index === categories.length - 1
                              }
                              aria-label={`Move ${category.name} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setEditingId(category.id);
                                setRenameValue(category.name);
                                setActionError(null);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="remove-category-button"
                              disabled={isBusy}
                              onClick={() => setDeletingCategory(category)}
                            >
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {deletingCategory ? (
        <CategoryDeleteDialog
          category={deletingCategory}
          categories={categories}
          onCancel={() => setDeletingCategory(null)}
          onDelete={async (replacementCategoryId) => {
            await onDelete(deletingCategory.id, replacementCategoryId);
            setAnnouncement(`Removed ${deletingCategory.name}.`);
            setDeletingCategory(null);
          }}
        />
      ) : null}
    </main>
  );
}

export function App() {
  const location = useLocation();
  const isCategoryView = location.pathname === "/categories";
  const isManageCategories = location.pathname === "/categories/manage";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [readyTasks, setReadyTasks] = useState<TaskResponse[]>([]);
  const [sleepingTasks, setSleepingTasks] = useState<TaskResponse[]>([]);
  const [sleepingExpanded, setSleepingExpanded] =
    useState(readSleepingExpanded);
  const [categoryLoadState, setCategoryLoadState] =
    useState<DependencyState>("idle");
  const [categoryLoadAttempt, setCategoryLoadAttempt] = useState(0);
  const [categoryTasks, setCategoryTasks] = useState<TaskResponse[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryResponse[]>([]);
  const [categoryTimeZone, setCategoryTimeZone] = useState<string | null>(null);
  const [managementLoadState, setManagementLoadState] =
    useState<LoadState>("loading");
  const [managementLoadAttempt, setManagementLoadAttempt] = useState(0);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [undoItems, setUndoItems] = useState<UndoItem[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoadState, setSearchLoadState] =
    useState<DependencyState>("idle");
  const [searchLoadAttempt, setSearchLoadAttempt] = useState(0);
  const [searchTasks, setSearchTasks] = useState<TaskResponse[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorDependencies, setEditorDependencies] =
    useState<EditorDependencies | null>(null);
  const [dependencyState, setDependencyState] =
    useState<DependencyState>("idle");
  const [appearsOffline, setAppearsOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const nextUndoIdRef = useRef(1);

  const completionDisabledTaskIds = new Set(completingTaskIds);
  for (const item of undoItems) completionDisabledTaskIds.add(item.taskId);

  useEffect(() => {
    function handleBackendStatus(event: Event) {
      const status = (event as CustomEvent<BackendStatus>).detail;
      setBackendUnavailable(status === "unreachable");
    }

    window.addEventListener(BACKEND_STATUS_EVENT, handleBackendStatus);
    return () =>
      window.removeEventListener(BACKEND_STATUS_EVENT, handleBackendStatus);
  }, []);

  useEffect(() => {
    function handleOffline() {
      setAppearsOffline(true);
    }

    function handleOnline() {
      setAppearsOffline(false);
      if (loadState === "error") setLoadAttempt((attempt) => attempt + 1);
      if (isCategoryView && categoryLoadState === "error") {
        setCategoryLoadAttempt((attempt) => attempt + 1);
      }
      if (isManageCategories && managementLoadState === "error") {
        setManagementLoadState("loading");
        setManagementLoadAttempt((attempt) => attempt + 1);
      }
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [
    categoryLoadState,
    isCategoryView,
    isManageCategories,
    loadState,
    managementLoadState,
  ]);

  useEffect(() => {
    const abortController = new AbortController();
    async function loadTasks() {
      setLoadState("loading");
      setCompletionError(null);
      try {
        const taskView = await fetchTaskView(abortController.signal);
        setReadyTasks(taskView.ready);
        setSleepingTasks(taskView.sleeping);
        setLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setLoadState("error");
      }
    }
    void loadTasks();
    return () => abortController.abort();
  }, [loadAttempt]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      if (document.querySelector("dialog[open]")) return;
      searchReturnFocusRef.current =
        document.activeElement as HTMLElement | null;
      setCompletionError(null);
      setSearchLoadState((current) => (current === "error" ? "idle" : current));
      setIsSearchOpen(true);
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    if (!isSearchOpen || searchTasks !== null) return;

    const abortController = new AbortController();
    fetchAllActiveTasks(abortController.signal)
      .then((tasks) => {
        setSearchTasks(tasks);
        setSearchLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setSearchLoadState("idle");
        } else {
          setSearchLoadState("error");
        }
      });

    return () => abortController.abort();
  }, [isSearchOpen, searchLoadAttempt, searchTasks]);

  useEffect(() => {
    if (!isCategoryView) return;

    const abortController = new AbortController();
    async function loadCategories() {
      setCategoryLoadState("loading");
      setCompletionError(null);
      try {
        const categoryView = await fetchCategoryView(abortController.signal);
        setCategoryTasks(categoryView.tasks);
        setCategoryList(categoryView.categories);
        setCategoryTimeZone(categoryView.timeZone);
        setEditorDependencies({
          categories: categoryView.categories,
          timeZone: categoryView.timeZone,
        });
        setDependencyState("ready");
        setCategoryLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setCategoryLoadState("error");
      }
    }
    void loadCategories();
    return () => abortController.abort();
  }, [categoryLoadAttempt, isCategoryView]);

  useEffect(() => {
    if (!isManageCategories) return;
    const abortController = new AbortController();
    fetchCategories(abortController.signal)
      .then((categories) => {
        setCategoryList(categories);
        setEditorDependencies((current) =>
          current ? { ...current, categories } : current,
        );
        setManagementLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setManagementLoadState("error");
        }
      });
    return () => abortController.abort();
  }, [isManageCategories, managementLoadAttempt]);

  async function loadDependencies() {
    setDependencyState("loading");
    try {
      setEditorDependencies(await fetchEditorDependencies());
      setDependencyState("ready");
    } catch {
      setDependencyState("error");
    }
  }

  function openEditor(
    nextEditor: EditorState,
    returnFocus = document.activeElement as HTMLElement | null,
  ) {
    returnFocusRef.current = returnFocus;
    setEditor(nextEditor);
    if (!editorDependencies && dependencyState !== "loading")
      void loadDependencies();
  }

  function closeEditor() {
    setEditor(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  function openSearch(trigger: HTMLElement | null) {
    if (document.querySelector("dialog[open]")) return;
    searchReturnFocusRef.current = trigger;
    setCompletionError(null);
    setSearchLoadState((current) => (current === "error" ? "idle" : current));
    setIsSearchOpen(true);
  }

  function closeSearch() {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    setCompletionError(null);
    window.setTimeout(() => returnFocus?.focus(), 0);
  }

  function selectSearchResult(task: TaskResponse) {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    setCompletionError(null);
    openEditor({ mode: "edit", task }, returnFocus);
  }

  function reconcileTask(task: TaskResponse) {
    setReadyTasks((current) => {
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null &&
        task.state === "ready" &&
        task.visibleInReady
        ? [...remaining, task].sort(compareReady)
        : remaining;
    });
    setSleepingTasks((current) => {
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null && task.state === "sleeping"
        ? [...remaining, task].sort(compareSleeping)
        : remaining;
    });
    if (categoryLoadState === "ready") {
      setCategoryTasks((current) => {
        const remaining = current.filter((item) => item.id !== task.id);
        return task.archivedAt === null ? [...remaining, task] : remaining;
      });
    }
    setSearchTasks((current) => {
      if (current === null) return current;
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null ? [...remaining, task] : remaining;
    });
  }

  function storeCategories(categories: CategoryResponse[]) {
    setCategoryList(categories);
    setEditorDependencies((current) =>
      current ? { ...current, categories } : current,
    );
  }

  function reconcileCategoryReference(
    categoryId: number,
    replacement: { id: number; name: string } | null,
  ) {
    const update = (tasks: TaskResponse[]) =>
      tasks.map((task) =>
        task.category?.id === categoryId
          ? { ...task, category: replacement }
          : task,
      );
    setReadyTasks(update);
    setSleepingTasks(update);
    setCategoryTasks(update);
    setSearchTasks((current) => (current === null ? current : update(current)));
  }

  function focusCompletionControl(taskId: number) {
    window.setTimeout(() => {
      const controls = document.querySelectorAll<HTMLButtonElement>(
        `[data-completion-task-id="${taskId}"]`,
      );
      controls.item(controls.length - 1)?.focus();
    }, 0);
  }

  async function handleComplete(task: TaskResponse, shouldFocusUndo: boolean) {
    if (completionDisabledTaskIds.has(task.id)) return;
    setCompletionError(null);
    setAnnouncement("");
    setCompletingTaskIds((current) => new Set(current).add(task.id));
    reconcileTask(optimisticallyCompleteTask(task));
    try {
      const result = await completeTask(task.id);
      reconcileTask(result.task);
      const undoItem: UndoItem = {
        id: nextUndoIdRef.current++,
        completionId: result.completion.id,
        taskId: task.id,
        taskName: task.name,
        status: "available",
        shouldFocus: shouldFocusUndo,
      };
      setUndoItems((current) => [...current, undoItem]);
      setAnnouncement(
        `Completed ${task.name}. Undo is available for five seconds.`,
      );
    } catch {
      reconcileTask(task);
      setCompletionError(
        `Couldn’t complete ${task.name}. Check your connection and try again.`,
      );
      if (shouldFocusUndo) focusCompletionControl(task.id);
    } finally {
      setCompletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function expireUndo(itemId: number) {
    setUndoItems((current) => current.filter((item) => item.id !== itemId));
  }

  function setUndoStatus(itemId: number, status: UndoStatus) {
    setUndoItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, status } : item)),
    );
  }

  async function handleUndo(item: UndoItem) {
    setAnnouncement("");
    setUndoStatus(item.id, "undoing");
    try {
      let task: TaskResponse;
      try {
        task = (await undoCompletion(item.completionId)).task;
      } catch (error) {
        if (!(error instanceof TaskApiError && error.status === 404)) {
          throw error;
        }
        task = await fetchTask(item.taskId);
      }
      reconcileTask(task);
      setUndoItems((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      setAnnouncement(`Undid completion of ${item.taskName}.`);
      focusCompletionControl(item.taskId);
    } catch {
      setUndoStatus(item.id, "failed");
      setAnnouncement(`Couldn’t undo completion of ${item.taskName}.`);
    }
  }

  function toggleSleeping() {
    setSleepingExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SLEEPING_EXPANDED_KEY, String(next));
      } catch {
        // The in-memory state still works when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      <AppNavigation onSearch={openSearch} />
      <div className="app-content">
        <PwaStatus
          appearsOffline={appearsOffline}
          backendUnavailable={backendUnavailable}
        />
        <Routes>
          <Route
            path="/"
            element={
              <ReadyPage
                loadState={loadState}
                readyTasks={readyTasks}
                sleepingTasks={sleepingTasks}
                sleepingExpanded={sleepingExpanded}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
                onToggleSleeping={toggleSleeping}
                onComplete={(task, shouldFocusUndo) =>
                  void handleComplete(task, shouldFocusUndo)
                }
                onEdit={(task) => openEditor({ mode: "edit", task })}
                onCreate={() => openEditor({ mode: "create" })}
              />
            }
          />
          <Route
            path="/categories"
            element={
              <BrowsePage
                loadState={categoryLoadState}
                tasks={categoryTasks}
                categories={categoryList}
                timeZone={categoryTimeZone}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setCategoryLoadAttempt((attempt) => attempt + 1)}
                onComplete={(task, shouldFocusUndo) =>
                  void handleComplete(task, shouldFocusUndo)
                }
                onEdit={(task) => openEditor({ mode: "edit", task })}
                onCreate={() => openEditor({ mode: "create" })}
              />
            }
          />
          <Route
            path="/categories/manage"
            element={
              <ManageCategories
                loadState={managementLoadState}
                categories={categoryList}
                onRetry={() => {
                  setManagementLoadState("loading");
                  setManagementLoadAttempt((attempt) => attempt + 1);
                }}
                onCreate={async (name) => {
                  const created = await createCategory({ name });
                  storeCategories(
                    [...categoryList, created].sort(
                      (first, second) =>
                        first.position - second.position ||
                        first.id - second.id,
                    ),
                  );
                }}
                onRename={async (categoryId, name) => {
                  const renamed = await renameCategory(categoryId, { name });
                  reconcileCategoryReference(categoryId, {
                    id: renamed.id,
                    name: renamed.name,
                  });
                  storeCategories(
                    categoryList.map((category) =>
                      category.id === categoryId ? renamed : category,
                    ),
                  );
                }}
                onReorder={async (categoryIds) => {
                  storeCategories(await reorderCategories({ categoryIds }));
                }}
                onDelete={async (categoryId, replacementCategoryId) => {
                  const replacement =
                    categoryList.find(
                      ({ id }) => id === replacementCategoryId,
                    ) ?? null;
                  const remainingCategories = await deleteCategory(
                    categoryId,
                    replacementCategoryId,
                  );
                  reconcileCategoryReference(
                    categoryId,
                    replacement
                      ? { id: replacement.id, name: replacement.name }
                      : null,
                  );
                  storeCategories(remainingCategories);
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {!isSearchOpen ? (
        <UndoStack
          items={undoItems}
          onExpire={expireUndo}
          onUndo={(selectedItem) => void handleUndo(selectedItem)}
        />
      ) : null}

      {!isManageCategories ? (
        <AddTaskButton
          accessibleName="Add task"
          className="add-task-button"
          onClick={() => openEditor({ mode: "create" })}
        />
      ) : null}

      {isSearchOpen ? (
        <TaskSearchDialog
          loadState={searchLoadState}
          tasks={searchTasks ?? []}
          query={searchQuery}
          completionError={completionError}
          completingTaskIds={completingTaskIds}
          completionDisabledTaskIds={completionDisabledTaskIds}
          undoItems={undoItems}
          onQueryChange={setSearchQuery}
          onRetry={() => {
            setSearchTasks(null);
            setSearchLoadState("idle");
            setSearchLoadAttempt((attempt) => attempt + 1);
          }}
          onClose={closeSearch}
          onComplete={(task, shouldFocusUndo) =>
            void handleComplete(task, shouldFocusUndo)
          }
          onSelect={selectSearchResult}
          onExpireUndo={expireUndo}
          onUndo={(item) => void handleUndo(item)}
        />
      ) : null}

      {editor ? (
        <TaskEditor
          key={editor.mode === "edit" ? `edit-${editor.task.id}` : "create"}
          editor={editor}
          dependencies={editorDependencies}
          dependencyState={dependencyState}
          onRetryDependencies={() => void loadDependencies()}
          onClose={closeEditor}
          onSaved={(task, action, keepOpen = false) => {
            reconcileTask(task);
            setAnnouncement(
              `${action === "created" ? "Created" : "Updated"} ${task.name}.${keepOpen ? " Ready for another task." : ""}`,
            );
            if (!keepOpen) closeEditor();
          }}
          onArchived={(task) => {
            setReadyTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setSleepingTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setCategoryTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setSearchTasks(
              (current) =>
                current?.filter((item) => item.id !== task.id) ?? null,
            );
            setAnnouncement(`Archived ${task.name}.`);
            closeEditor();
          }}
        />
      ) : null}
    </div>
  );
}

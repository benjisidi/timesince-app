import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";

import type { CategoryResponse, TaskResponse } from "../shared/api";
import {
  archiveTask,
  completeTask,
  createTask,
  fetchEditorDependencies,
  fetchTask,
  fetchTaskView,
  TaskApiError,
  undoCompletion,
  updateTask,
} from "./task-api";

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

function compareUpcoming(first: TaskResponse, second: TaskResponse) {
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

function TaskElapsedTime({ task }: { task: TaskResponse }) {
  if (task.elapsedDays === null) {
    return <span className="elapsed-primary">Never</span>;
  }

  const dayLabel = task.elapsedDays === 1 ? "day" : "days";
  const overageDayLabel = task.overageDays === 1 ? "day" : "days";
  const accessibleLabel =
    task.overageDays && task.overageDays > 0
      ? `${task.elapsedDays} ${dayLabel}, ${task.overageDays} ${overageDayLabel} beyond the target`
      : `${task.elapsedDays} ${dayLabel}`;

  return (
    <span className="elapsed-primary" aria-label={accessibleLabel}>
      <span aria-hidden="true">
        {task.elapsedDays}
        {task.overageDays !== null && task.overageDays > 0 ? (
          <sup>+{task.overageDays}</sup>
        ) : null}{" "}
        {dayLabel}
      </span>
    </span>
  );
}

interface TaskRowProps {
  task: TaskResponse;
  isCompleting: boolean;
  isCompletionDisabled: boolean;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
}

function TaskRow({
  task,
  isCompleting,
  isCompletionDisabled,
  onComplete,
  onEdit,
}: TaskRowProps) {
  const targetDayLabel = task.targetIntervalDays === 1 ? "day" : "days";

  return (
    <li className="task-row">
      <button
        className="completion-control"
        type="button"
        aria-label={`${isCompleting ? "Completing" : "Complete"} ${task.name}`}
        data-completion-task-id={task.id}
        data-pending={isCompleting}
        disabled={isCompletionDisabled}
        onClick={(event: MouseEvent<HTMLButtonElement>) =>
          onComplete(task, event.detail === 0)
        }
      >
        <span aria-hidden="true" />
      </button>
      <button
        className="task-edit-control"
        type="button"
        aria-label={`Edit ${task.name}`}
        onClick={() => onEdit(task)}
      >
        <span className="task-identity">
          <span className="task-name">{task.name}</span>
          <span className="task-category">
            {task.category?.name ?? "Uncategorized"}
          </span>
        </span>
        <span className="task-timing">
          <TaskElapsedTime task={task} />
          <span className="task-target">
            Target: {task.targetIntervalDays} {targetDayLabel}
          </span>
        </span>
      </button>
    </li>
  );
}

interface TaskSectionProps {
  title: string;
  tasks: TaskResponse[];
  emptyMessage: string;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
}

function TaskSection({
  title,
  tasks,
  emptyMessage,
  completingTaskIds,
  completionDisabledTaskIds,
  onComplete,
  onEdit,
}: TaskSectionProps) {
  const headingId = `${title.toLowerCase()}-heading`;
  const countLabel = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  return (
    <section className="task-section" aria-labelledby={headingId}>
      <h2 id={headingId}>
        {title} <span aria-label={countLabel}>{tasks.length}</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="section-empty">{emptyMessage}</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isCompleting={completingTaskIds.has(task.id)}
              isCompletionDisabled={completionDisabledTaskIds.has(task.id)}
              onComplete={onComplete}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface TaskEditorProps {
  editor: EditorState;
  dependencies: EditorDependencies | null;
  dependencyState: DependencyState;
  onRetryDependencies: () => void;
  onClose: () => void;
  onSaved: (task: TaskResponse, action: "created" | "updated") => void;
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
        onSaved(saved, "created");
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
        ? dateInTimeZone(new Date(task.lastCompletedAt), dependencies.timeZone)
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
              Target interval <small>days</small>
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
              <summary>Previous completion</summary>
              <label className="form-field">
                <span>
                  Last completed <small>optional</small>
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
            <details
              className="advanced-fields"
              open={Boolean(task?.snoozedUntil)}
            >
              <summary>Snooze</summary>
              <p className="completion-context">
                Last completed: {lastCompleted ?? "Loading…"}
              </p>
              <label className="form-field">
                <span>
                  Hide from Ready until <small>optional</small>
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
            </details>
          )}

          {dependencies ? (
            <p className="timezone-help" id="date-timezone-help">
              Dates use {dependencies.timeZone}.
            </p>
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
                  Archive “{task.name}”? It will leave the Task view, but its
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

export function App() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [readyTasks, setReadyTasks] = useState<TaskResponse[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<TaskResponse[]>([]);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [undoItems, setUndoItems] = useState<UndoItem[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorDependencies, setEditorDependencies] =
    useState<EditorDependencies | null>(null);
  const [dependencyState, setDependencyState] =
    useState<DependencyState>("idle");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nextUndoIdRef = useRef(1);

  const completionDisabledTaskIds = new Set(completingTaskIds);
  for (const item of undoItems) completionDisabledTaskIds.add(item.taskId);

  useEffect(() => {
    const abortController = new AbortController();
    async function loadTasks() {
      setLoadState("loading");
      setCompletionError(null);
      try {
        const taskView = await fetchTaskView(abortController.signal);
        setReadyTasks(taskView.ready);
        setUpcomingTasks(taskView.upcoming);
        setLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setLoadState("error");
      }
    }
    void loadTasks();
    return () => abortController.abort();
  }, [loadAttempt]);

  async function loadDependencies() {
    setDependencyState("loading");
    try {
      setEditorDependencies(await fetchEditorDependencies());
      setDependencyState("ready");
    } catch {
      setDependencyState("error");
    }
  }

  function openEditor(nextEditor: EditorState) {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setEditor(nextEditor);
    if (!editorDependencies && dependencyState !== "loading")
      void loadDependencies();
  }

  function closeEditor() {
    setEditor(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
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
    setUpcomingTasks((current) => {
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null && task.state === "sleeping"
        ? [...remaining, task].sort(compareUpcoming)
        : remaining;
    });
  }

  function focusCompletionControl(taskId: number) {
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-completion-task-id="${taskId}"]`,
        )
        ?.focus();
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

  const hasNoTasks = readyTasks.length === 0 && upcomingTasks.length === 0;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p>TimeSince</p>
          <span>Task view</span>
        </div>
      </header>
      <main className="task-page" aria-labelledby="task-view-title">
        <div className="page-intro">
          <p className="eyebrow">Recurring tasks, without deadlines</p>
          <h1 id="task-view-title">Tasks</h1>
        </div>

        {loadState === "loading" ? (
          <p className="page-status" role="status">
            Loading tasks…
          </p>
        ) : null}
        {loadState === "error" ? (
          <div className="page-status error-state" role="alert">
            <p>Couldn’t load tasks. Check your connection and try again.</p>
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : null}
        {loadState === "ready" ? (
          <>
            {hasNoTasks ? (
              <p className="all-tasks-empty">
                No tasks yet. Add one to start tracking time since it was last
                done.
              </p>
            ) : null}
            {completionError ? (
              <p className="completion-error" role="alert">
                {completionError}
              </p>
            ) : null}
            <TaskSection
              title="Ready"
              tasks={readyTasks}
              emptyMessage="Nothing is ready."
              completingTaskIds={completingTaskIds}
              completionDisabledTaskIds={completionDisabledTaskIds}
              onComplete={(task, shouldFocusUndo) =>
                void handleComplete(task, shouldFocusUndo)
              }
              onEdit={(task) => openEditor({ mode: "edit", task })}
            />
            <TaskSection
              title="Upcoming"
              tasks={upcomingTasks}
              emptyMessage="No upcoming tasks."
              completingTaskIds={completingTaskIds}
              completionDisabledTaskIds={completionDisabledTaskIds}
              onComplete={(task, shouldFocusUndo) =>
                void handleComplete(task, shouldFocusUndo)
              }
              onEdit={(task) => openEditor({ mode: "edit", task })}
            />
          </>
        ) : null}
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>
      </main>

      {undoItems.length > 0 ? (
        <aside className="undo-stack" aria-label="Completion actions">
          {undoItems.map((item) => (
            <UndoToast
              key={item.id}
              item={item}
              onExpire={expireUndo}
              onUndo={(selectedItem) => void handleUndo(selectedItem)}
            />
          ))}
        </aside>
      ) : null}

      <button
        type="button"
        className="add-task-button"
        onClick={() => openEditor({ mode: "create" })}
        aria-label="Add task"
      >
        <span aria-hidden="true">+</span>
      </button>

      {editor ? (
        <TaskEditor
          key={editor.mode === "edit" ? `edit-${editor.task.id}` : "create"}
          editor={editor}
          dependencies={editorDependencies}
          dependencyState={dependencyState}
          onRetryDependencies={() => void loadDependencies()}
          onClose={closeEditor}
          onSaved={(task, action) => {
            reconcileTask(task);
            setAnnouncement(
              `${action === "created" ? "Created" : "Updated"} ${task.name}.`,
            );
            closeEditor();
          }}
          onArchived={(task) => {
            setReadyTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setUpcomingTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setAnnouncement(`Archived ${task.name}.`);
            closeEditor();
          }}
        />
      ) : null}
    </div>
  );
}

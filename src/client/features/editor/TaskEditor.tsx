import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CategoryResponse, TaskResponse } from "../../../shared/api";
import { TaskApiError } from "../../api/client";
import { archiveTask, createTask, updateTask } from "../../api/tasks";
import { UndoStack, type UndoItem } from "../completion/UndoStack";

export type EditorState =
  { mode: "create" } | { mode: "edit"; task: TaskResponse };

export interface EditorDependencies {
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

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year as number, (month as number) - 1, day)));
}

interface TaskEditorProps {
  editor: EditorState;
  dependencies: EditorDependencies | null;
  dependencyState: "idle" | "loading" | "ready" | "error";
  onRetryDependencies: () => void;
  onClose: () => void;
  onSaved: (
    task: TaskResponse,
    action: "created" | "updated",
    keepOpen?: boolean,
  ) => void;
  onArchived: (task: TaskResponse) => void;
  historicalCompletionDisabled: boolean;
  undoItems: UndoItem[];
  onCompletedEarlier: (
    task: TaskResponse,
    completedAt: string,
    formattedDate: string,
    shouldFocusUndo: boolean,
  ) => Promise<TaskResponse>;
  onExpireUndo: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

export function TaskEditor({
  editor,
  dependencies,
  dependencyState,
  onRetryDependencies,
  onClose,
  onSaved,
  onArchived,
  historicalCompletionDisabled,
  undoItems,
  onCompletedEarlier,
  onExpireUndo,
  onUndo,
}: TaskEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const historicalShouldFocusUndoRef = useRef(false);
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
  const [showHistoricalCompletion, setShowHistoricalCompletion] =
    useState(false);
  const [historicalCompletedAt, setHistoricalCompletedAt] = useState("");
  const [historicalCompletionError, setHistoricalCompletionError] = useState<
    string | null
  >(null);
  const [isRecordingEarlier, setIsRecordingEarlier] = useState(false);
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

  async function handleHistoricalCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || !dependencies || historicalCompletionDisabled) return;

    const localToday = dateInTimeZone(new Date(), dependencies.timeZone);
    if (!historicalCompletedAt) {
      setHistoricalCompletionError("Choose an earlier date.");
      return;
    }
    if (historicalCompletedAt === localToday) {
      setHistoricalCompletionError(
        "Choose a date before today, or use Done now.",
      );
      return;
    }
    if (historicalCompletedAt > localToday) {
      setHistoricalCompletionError("Choose a date before today.");
      return;
    }

    const shouldFocusUndo = historicalShouldFocusUndoRef.current;
    historicalShouldFocusUndoRef.current = false;
    setHistoricalCompletionError(null);
    setIsRecordingEarlier(true);
    try {
      await onCompletedEarlier(
        task,
        historicalCompletedAt,
        formatDateOnly(historicalCompletedAt),
        shouldFocusUndo,
      );
      setHistoricalCompletedAt("");
      setShowHistoricalCompletion(false);
    } catch (error) {
      setHistoricalCompletionError(
        error instanceof TaskApiError
          ? (error.fields.completedAt ?? error.message)
          : "Couldn’t record that completion. Check your connection and try again.",
      );
    } finally {
      setIsRecordingEarlier(false);
    }
  }

  const isBusy = isSaving || isArchiving || isRecordingEarlier;
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
  const latestHistoricalDate = today ? addCalendarDays(today, -1) : null;
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

        {task ? (
          <section
            className="last-done-context"
            aria-labelledby="last-done-heading"
          >
            <div className="last-done-summary">
              <span id="last-done-heading">Last done</span>
              <strong>{lastCompleted ?? "Loading…"}</strong>
            </div>
            <button
              type="button"
              className="text-button done-earlier-trigger"
              aria-expanded={showHistoricalCompletion}
              aria-controls="historical-completion-fields"
              onClick={() => {
                setShowHistoricalCompletion((current) => !current);
                setHistoricalCompletionError(null);
              }}
              disabled={
                isBusy ||
                historicalCompletionDisabled ||
                dependencyState !== "ready"
              }
            >
              Done earlier
            </button>
            {showHistoricalCompletion ? (
              <form
                id="historical-completion-fields"
                className="historical-completion-fields"
                onSubmit={(event) => void handleHistoricalCompletion(event)}
                noValidate
              >
                <label className="form-field">
                  <span>Done on</span>
                  <input
                    type="date"
                    value={historicalCompletedAt}
                    max={latestHistoricalDate ?? undefined}
                    onChange={(event) => {
                      setHistoricalCompletedAt(event.target.value);
                      setHistoricalCompletionError(null);
                    }}
                    aria-invalid={Boolean(historicalCompletionError)}
                    aria-describedby={
                      historicalCompletionError
                        ? "historical-completion-error"
                        : "date-timezone-help"
                    }
                    disabled={
                      isBusy ||
                      historicalCompletionDisabled ||
                      dependencyState !== "ready"
                    }
                    required
                  />
                  {historicalCompletionError ? (
                    <small id="historical-completion-error" role="alert">
                      {historicalCompletionError}
                    </small>
                  ) : null}
                </label>
                <div className="historical-completion-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setShowHistoricalCompletion(false);
                      setHistoricalCompletionError(null);
                    }}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="secondary-button"
                    disabled={
                      isBusy ||
                      historicalCompletionDisabled ||
                      dependencyState !== "ready"
                    }
                    onClick={(event) => {
                      historicalShouldFocusUndoRef.current = event.detail === 0;
                    }}
                  >
                    {isRecordingEarlier ? "Recording…" : "Record completion"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ) : null}

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
      <UndoStack items={undoItems} onExpire={onExpireUndo} onUndo={onUndo} />
    </dialog>
  );
}

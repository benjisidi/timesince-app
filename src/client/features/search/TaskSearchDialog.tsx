import { useEffect, useRef } from "react";

import type { TaskResponse } from "../../../shared/api";
import { TaskRow } from "../../components/TaskList";
import { UndoStack, type UndoItem } from "../completion/UndoStack";
import { rankSearchResults } from "./task-search";

interface TaskSearchDialogProps {
  loadState: "idle" | "loading" | "ready" | "error";
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

export function TaskSearchDialog({
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

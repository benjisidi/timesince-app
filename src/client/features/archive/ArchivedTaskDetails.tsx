import { useEffect, useRef, useState } from "react";

import type { TaskResponse } from "../../../shared/api";
import { TaskApiError } from "../../api/client";
import { restoreTask } from "../../api/tasks";

function formatDate(timestamp: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(timestamp));
}

interface ArchivedTaskDetailsProps {
  task: TaskResponse;
  timeZone: string;
  onClose: () => void;
  onRestored: (task: TaskResponse) => void;
}

export function ArchivedTaskDetails({
  task,
  timeZone,
  onClose,
  onRestored,
}: ArchivedTaskDetailsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetLabel = task.targetIntervalDays === 1 ? "day" : "days";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, []);

  async function handleRestore() {
    setIsRestoring(true);
    setError(null);
    try {
      onRestored(await restoreTask(task.id));
    } catch (restoreError) {
      setError(
        restoreError instanceof TaskApiError
          ? restoreError.message
          : "Couldn’t restore the task. Check your connection and try again.",
      );
      setIsRestoring(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog"
      aria-labelledby="archived-task-details-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!isRestoring) onClose();
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Archived task</p>
            <h2
              id="archived-task-details-heading"
              tabIndex={-1}
              data-initial-focus
            >
              {task.name}
            </h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            disabled={isRestoring}
            aria-label="Close archived task details"
          >
            ×
          </button>
        </div>

        <p className="archived-task-summary">
          This task is outside normal use. Restore it to make it active again.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="archived-task-details">
          <div>
            <dt>Category</dt>
            <dd>{task.category?.name ?? "Uncategorized"}</dd>
          </div>
          <div>
            <dt>Show again after</dt>
            <dd>
              {task.targetIntervalDays} {targetLabel}
            </dd>
          </div>
          <div>
            <dt>Last done</dt>
            <dd>
              {task.lastCompletedAt
                ? formatDate(task.lastCompletedAt, timeZone)
                : "Never"}
            </dd>
          </div>
          <div>
            <dt>Archived</dt>
            <dd>{formatDate(task.archivedAt as string, timeZone)}</dd>
          </div>
        </dl>

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isRestoring}
          >
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleRestore()}
            disabled={isRestoring}
          >
            {isRestoring ? "Restoring…" : "Restore task"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

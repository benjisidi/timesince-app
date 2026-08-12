import type { TaskResponse } from "../../shared/api";

function formatDate(timestamp: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(timestamp));
}

interface ArchivedTasksPageProps {
  loadState: "idle" | "loading" | "ready" | "error";
  tasks: TaskResponse[];
  timeZone: string | null;
  onRetry: () => void;
  onSelect: (task: TaskResponse) => void;
}

export function ArchivedTasksPage({
  loadState,
  tasks,
  timeZone,
  onRetry,
  onSelect,
}: ArchivedTasksPageProps) {
  return (
    <main
      className="task-page archived-tasks-page"
      aria-labelledby="archived-tasks-title"
    >
      <div className="page-intro">
        <div>
          <h1 id="archived-tasks-title">Archived tasks</h1>
        </div>
      </div>

      {loadState === "idle" || loadState === "loading" ? (
        <p className="page-status" role="status">
          Loading archived tasks…
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className="page-status error-state" role="alert">
          <p>
            Couldn’t load archived tasks. Check your connection and try again.
          </p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {loadState === "ready" && tasks.length === 0 ? (
        <p className="all-tasks-empty">No archived tasks.</p>
      ) : null}
      {loadState === "ready" && tasks.length > 0 && timeZone ? (
        <section
          className="archived-task-management"
          aria-label="Archived tasks"
        >
          <ul className="archived-task-list">
            {tasks.map((task) => {
              const targetLabel =
                task.targetIntervalDays === 1 ? "day" : "days";
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    aria-label={`View archived task ${task.name}`}
                    onClick={() => onSelect(task)}
                  >
                    <span className="archived-task-identity">
                      <strong>{task.name}</strong>
                      <span>{task.category?.name ?? "Uncategorized"}</span>
                    </span>
                    <span className="archived-task-context">
                      <span>
                        Last done:{" "}
                        {task.lastCompletedAt
                          ? formatDate(task.lastCompletedAt, timeZone)
                          : "Never"}
                      </span>
                      <span>
                        Show again after {task.targetIntervalDays} {targetLabel}
                      </span>
                      <span>
                        Archived{" "}
                        {formatDate(task.archivedAt as string, timeZone)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

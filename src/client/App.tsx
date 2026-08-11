import { useEffect, useState } from "react";

import type { TaskResponse } from "../shared/api";
import { completeTask, fetchTaskView } from "./task-api";

type LoadState = "loading" | "ready" | "error";

function compareByNameAndId(first: TaskResponse, second: TaskResponse) {
  return first.name.localeCompare(second.name) || first.id - second.id;
}

function compareReady(first: TaskResponse, second: TaskResponse) {
  if (first.elapsedDays === null && second.elapsedDays !== null) {
    return -1;
  }
  if (first.elapsedDays !== null && second.elapsedDays === null) {
    return 1;
  }

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
  onComplete: (task: TaskResponse) => void;
}

function TaskRow({ task, isCompleting, onComplete }: TaskRowProps) {
  const targetDayLabel = task.targetIntervalDays === 1 ? "day" : "days";

  return (
    <li className="task-row">
      <button
        className="completion-control"
        type="button"
        aria-label={`${isCompleting ? "Completing" : "Complete"} ${task.name}`}
        disabled={isCompleting}
        onClick={() => onComplete(task)}
      >
        <span aria-hidden="true" />
      </button>
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
    </li>
  );
}

interface TaskSectionProps {
  title: string;
  tasks: TaskResponse[];
  emptyMessage: string;
  completingTaskIds: ReadonlySet<number>;
  onComplete: (task: TaskResponse) => void;
}

function TaskSection({
  title,
  tasks,
  emptyMessage,
  completingTaskIds,
  onComplete,
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
              onComplete={onComplete}
            />
          ))}
        </ul>
      )}
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
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadState("error");
        }
      }
    }

    void loadTasks();
    return () => abortController.abort();
  }, [loadAttempt]);

  async function handleComplete(task: TaskResponse) {
    if (completingTaskIds.has(task.id)) {
      return;
    }

    setCompletionError(null);
    setAnnouncement("");
    setCompletingTaskIds((current) => new Set(current).add(task.id));

    try {
      const completedTask = await completeTask(task.id);
      setReadyTasks((current) => {
        const withoutCompletedTask = current.filter(
          (item) => item.id !== completedTask.id,
        );
        return completedTask.state === "ready" && completedTask.visibleInReady
          ? [...withoutCompletedTask, completedTask].sort(compareReady)
          : withoutCompletedTask;
      });
      setUpcomingTasks((current) => {
        const withoutCompletedTask = current.filter(
          (item) => item.id !== completedTask.id,
        );
        return completedTask.state === "sleeping"
          ? [...withoutCompletedTask, completedTask].sort(compareUpcoming)
          : withoutCompletedTask;
      });
      setAnnouncement(`Completed ${task.name}.`);
    } catch {
      setCompletionError(
        `Couldn’t complete ${task.name}. Check your connection and try again.`,
      );
    } finally {
      setCompletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
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
                No tasks yet. Tasks will appear here once they’ve been added.
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
              onComplete={(task) => void handleComplete(task)}
            />
            <TaskSection
              title="Upcoming"
              tasks={upcomingTasks}
              emptyMessage="No upcoming tasks."
              completingTaskIds={completingTaskIds}
              onComplete={(task) => void handleComplete(task)}
            />
          </>
        ) : null}

        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>
      </main>
    </div>
  );
}

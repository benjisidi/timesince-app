import type { MouseEvent } from "react";

import type { TaskResponse } from "../../shared/api";

export interface TaskRowProps {
  task: TaskResponse;
  isCompleting: boolean;
  isCompletionDisabled: boolean;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
  showCategory?: boolean;
  timeZone?: string;
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

export function TaskRow({
  task,
  isCompleting,
  isCompletionDisabled,
  onComplete,
  onEdit,
  showCategory = true,
  timeZone,
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
        className={`task-edit-control${showCategory ? " task-edit-control-with-category" : ""}`}
        type="button"
        aria-label={`Edit ${task.name}`}
        onClick={() => onEdit(task)}
      >
        <span className="task-identity">
          <span className="task-name">{task.name}</span>
          {showCategory ? (
            <span className="task-category">
              {task.category?.name ?? "Uncategorized"}
            </span>
          ) : task.isSnoozed && task.snoozedUntil && timeZone ? (
            <span className="task-snooze">
              Snoozed until{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeZone,
              }).format(new Date(task.snoozedUntil))}
            </span>
          ) : null}
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

export interface TaskSectionProps {
  title: string;
  tasks: TaskResponse[];
  emptyMessage: string;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
}

export function TaskSection({
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

interface SleepingSectionProps extends Omit<TaskSectionProps, "title"> {
  expanded: boolean;
  onToggle: () => void;
}

export function SleepingSection({
  tasks,
  emptyMessage,
  expanded,
  onToggle,
  completingTaskIds,
  completionDisabledTaskIds,
  onComplete,
  onEdit,
}: SleepingSectionProps) {
  const countLabel = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  return (
    <section
      className="task-section sleeping-section"
      aria-labelledby="sleeping-heading"
    >
      <h2 id="sleeping-heading">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="sleeping-tasks"
          onClick={onToggle}
        >
          <span>Sleeping</span>
          <span className="section-count" aria-label={countLabel}>
            {tasks.length}
          </span>
          <span className="section-chevron" aria-hidden="true" />
        </button>
      </h2>
      {expanded ? (
        <div id="sleeping-tasks">
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
        </div>
      ) : null}
    </section>
  );
}

export function AddTaskButton({
  accessibleName,
  className,
  onClick,
}: {
  accessibleName: string;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={accessibleName}
    >
      <span aria-hidden="true">+</span>
      <span className="add-task-label">New task</span>
    </button>
  );
}

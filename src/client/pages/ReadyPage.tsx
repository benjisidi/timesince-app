import type { TaskResponse } from "../../shared/api";
import {
  AddTaskButton,
  SleepingSection,
  TaskSection,
} from "../components/TaskList";

interface ReadyPageProps {
  loadState: "loading" | "ready" | "error";
  readyTasks: TaskResponse[];
  sleepingTasks: TaskResponse[];
  sleepingExpanded: boolean;
  completionError: string | null;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  onRetry: () => void;
  onToggleSleeping: () => void;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
  onCreate: () => void;
}

export function ReadyPage({
  loadState,
  readyTasks,
  sleepingTasks,
  sleepingExpanded,
  completionError,
  completingTaskIds,
  completionDisabledTaskIds,
  onRetry,
  onToggleSleeping,
  onComplete,
  onEdit,
  onCreate,
}: ReadyPageProps) {
  const hasNoTasks = readyTasks.length === 0 && sleepingTasks.length === 0;

  return (
    <main className="task-page ready-page" aria-labelledby="ready-view-title">
      <div className="page-intro">
        <div>
          <h1 id="ready-view-title">Ready</h1>
        </div>
        <AddTaskButton
          accessibleName="New task"
          className="desktop-add-task-button"
          onClick={onCreate}
        />
      </div>

      {loadState === "loading" ? (
        <p className="page-status" role="status">
          Loading tasks…
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className="page-status error-state" role="alert">
          <p>Couldn’t load tasks. Check your connection and try again.</p>
          <button type="button" onClick={onRetry}>
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
          <div className="task-sections">
            <TaskSection
              title="Ready"
              tasks={readyTasks}
              emptyMessage="Nothing is ready right now."
              completingTaskIds={completingTaskIds}
              completionDisabledTaskIds={completionDisabledTaskIds}
              onComplete={onComplete}
              onEdit={onEdit}
            />
            <SleepingSection
              tasks={sleepingTasks}
              emptyMessage="No tasks are sleeping."
              expanded={sleepingExpanded}
              onToggle={onToggleSleeping}
              completingTaskIds={completingTaskIds}
              completionDisabledTaskIds={completionDisabledTaskIds}
              onComplete={onComplete}
              onEdit={onEdit}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}

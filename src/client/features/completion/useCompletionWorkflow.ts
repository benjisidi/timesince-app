import { useCallback, useMemo, useRef, useState } from "react";

import type { TaskResponse } from "../../../shared/api";
import { TaskApiError } from "../../api/client";
import { completeTask, fetchTask, undoCompletion } from "../../api/tasks";
import type { UndoItem, UndoStatus } from "./UndoStack";

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

function focusCompletionControl(taskId: number) {
  window.setTimeout(() => {
    const controls = document.querySelectorAll<HTMLButtonElement>(
      `[data-completion-task-id="${taskId}"]`,
    );
    controls.item(controls.length - 1)?.focus();
  }, 0);
}

interface CompletionWorkflowOptions {
  reconcileTask: (task: TaskResponse) => void;
  announce: (message: string) => void;
}

export function useCompletionWorkflow({
  reconcileTask,
  announce,
}: CompletionWorkflowOptions) {
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [undoItems, setUndoItems] = useState<UndoItem[]>([]);
  const nextUndoIdRef = useRef(1);

  const completionDisabledTaskIds = useMemo(() => {
    const disabledTaskIds = new Set(completingTaskIds);
    for (const item of undoItems) disabledTaskIds.add(item.taskId);
    return disabledTaskIds;
  }, [completingTaskIds, undoItems]);

  const clearCompletionError = useCallback(() => {
    setCompletionError(null);
  }, []);

  const handleComplete = useCallback(
    async (task: TaskResponse, shouldFocusUndo: boolean) => {
      if (completionDisabledTaskIds.has(task.id)) return;
      setCompletionError(null);
      announce("");
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
          feedback: "Completed",
          status: "available",
          shouldFocus: shouldFocusUndo,
        };
        setUndoItems((current) => [...current, undoItem]);
        announce(`Completed ${task.name}. Undo is available for five seconds.`);
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
    },
    [announce, completionDisabledTaskIds, reconcileTask],
  );

  const expireUndo = useCallback((itemId: number) => {
    setUndoItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const handleCompleteEarlier = useCallback(
    async (
      task: TaskResponse,
      completedAt: string,
      formattedDate: string,
      shouldFocusUndo: boolean,
    ) => {
      if (completionDisabledTaskIds.has(task.id)) {
        throw new Error("A completion action is already pending for this task");
      }

      setCompletionError(null);
      announce("");
      setCompletingTaskIds((current) => new Set(current).add(task.id));
      try {
        const result = await completeTask(task.id, { completedAt });
        reconcileTask(result.task);
        const undoItem: UndoItem = {
          id: nextUndoIdRef.current++,
          completionId: result.completion.id,
          taskId: task.id,
          taskName: task.name,
          feedback: `Recorded as done on ${formattedDate}`,
          status: "available",
          shouldFocus: shouldFocusUndo,
        };
        setUndoItems((current) => [...current, undoItem]);
        announce(
          `Recorded ${task.name} as done on ${formattedDate}. Undo is available for five seconds.`,
        );
        return result.task;
      } finally {
        setCompletingTaskIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      }
    },
    [announce, completionDisabledTaskIds, reconcileTask],
  );

  const setUndoStatus = useCallback((itemId: number, status: UndoStatus) => {
    setUndoItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, status } : item)),
    );
  }, []);

  const handleUndo = useCallback(
    async (item: UndoItem) => {
      announce("");
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
        announce(`Undid completion of ${item.taskName}.`);
        focusCompletionControl(item.taskId);
      } catch {
        setUndoStatus(item.id, "failed");
        announce(`Couldn’t undo completion of ${item.taskName}.`);
      }
    },
    [announce, reconcileTask, setUndoStatus],
  );

  return {
    completingTaskIds,
    completionDisabledTaskIds,
    completionError,
    undoItems,
    clearCompletionError,
    handleComplete,
    handleCompleteEarlier,
    expireUndo,
    handleUndo,
  };
}

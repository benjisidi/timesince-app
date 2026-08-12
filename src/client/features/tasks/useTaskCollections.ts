import { useCallback, useReducer } from "react";

import type { TaskCategoryResponse, TaskResponse } from "../../../shared/api";
import { compareReadyTasks, compareSleepingTasks } from "./task-order";

export interface TaskCollectionsState {
  readyTasks: TaskResponse[];
  sleepingTasks: TaskResponse[];
  browseTasks: TaskResponse[];
  browseLoaded: boolean;
  searchTasks: TaskResponse[] | null;
}

export const initialTaskCollectionsState: TaskCollectionsState = {
  readyTasks: [],
  sleepingTasks: [],
  browseTasks: [],
  browseLoaded: false,
  searchTasks: null,
};

export type TaskCollectionsAction =
  | {
      type: "load-ready";
      readyTasks: TaskResponse[];
      sleepingTasks: TaskResponse[];
    }
  | { type: "load-browse"; tasks: TaskResponse[] }
  | { type: "load-search"; tasks: TaskResponse[] }
  | { type: "clear-search" }
  | { type: "reconcile-task"; task: TaskResponse }
  | { type: "remove-task"; taskId: number }
  | {
      type: "replace-category-reference";
      categoryId: number;
      replacement: TaskCategoryResponse | null;
    };

function reconcileOrderedCollection(
  tasks: TaskResponse[],
  task: TaskResponse,
  belongs: boolean,
  compare: (first: TaskResponse, second: TaskResponse) => number,
) {
  const remaining = tasks.filter((item) => item.id !== task.id);
  return belongs ? [...remaining, task].sort(compare) : remaining;
}

function reconcileActiveCollection(tasks: TaskResponse[], task: TaskResponse) {
  const remaining = tasks.filter((item) => item.id !== task.id);
  return task.archivedAt === null ? [...remaining, task] : remaining;
}

function removeTask(tasks: TaskResponse[], taskId: number) {
  return tasks.filter((task) => task.id !== taskId);
}

function replaceCategoryReference(
  tasks: TaskResponse[],
  categoryId: number,
  replacement: TaskCategoryResponse | null,
) {
  return tasks.map((task) =>
    task.category?.id === categoryId
      ? { ...task, category: replacement }
      : task,
  );
}

export function taskCollectionsReducer(
  state: TaskCollectionsState,
  action: TaskCollectionsAction,
): TaskCollectionsState {
  switch (action.type) {
    case "load-ready":
      return {
        ...state,
        readyTasks: action.readyTasks,
        sleepingTasks: action.sleepingTasks,
      };
    case "load-browse":
      return { ...state, browseTasks: action.tasks, browseLoaded: true };
    case "load-search":
      return { ...state, searchTasks: action.tasks };
    case "clear-search":
      return { ...state, searchTasks: null };
    case "reconcile-task": {
      const { task } = action;
      const active = task.archivedAt === null;
      return {
        ...state,
        readyTasks: reconcileOrderedCollection(
          state.readyTasks,
          task,
          active && task.state === "ready" && task.visibleInReady,
          compareReadyTasks,
        ),
        sleepingTasks: reconcileOrderedCollection(
          state.sleepingTasks,
          task,
          active && task.state === "sleeping",
          compareSleepingTasks,
        ),
        browseTasks: state.browseLoaded
          ? reconcileActiveCollection(state.browseTasks, task)
          : state.browseTasks,
        searchTasks:
          state.searchTasks === null
            ? null
            : reconcileActiveCollection(state.searchTasks, task),
      };
    }
    case "remove-task":
      return {
        ...state,
        readyTasks: removeTask(state.readyTasks, action.taskId),
        sleepingTasks: removeTask(state.sleepingTasks, action.taskId),
        browseTasks: removeTask(state.browseTasks, action.taskId),
        searchTasks:
          state.searchTasks === null
            ? null
            : removeTask(state.searchTasks, action.taskId),
      };
    case "replace-category-reference":
      return {
        ...state,
        readyTasks: replaceCategoryReference(
          state.readyTasks,
          action.categoryId,
          action.replacement,
        ),
        sleepingTasks: replaceCategoryReference(
          state.sleepingTasks,
          action.categoryId,
          action.replacement,
        ),
        browseTasks: replaceCategoryReference(
          state.browseTasks,
          action.categoryId,
          action.replacement,
        ),
        searchTasks:
          state.searchTasks === null
            ? null
            : replaceCategoryReference(
                state.searchTasks,
                action.categoryId,
                action.replacement,
              ),
      };
  }
}

export function useTaskCollections() {
  const [state, dispatch] = useReducer(
    taskCollectionsReducer,
    initialTaskCollectionsState,
  );
  const loadReady = useCallback(
    (readyTasks: TaskResponse[], sleepingTasks: TaskResponse[]) => {
      dispatch({ type: "load-ready", readyTasks, sleepingTasks });
    },
    [],
  );
  const loadBrowse = useCallback((tasks: TaskResponse[]) => {
    dispatch({ type: "load-browse", tasks });
  }, []);
  const loadSearch = useCallback((tasks: TaskResponse[]) => {
    dispatch({ type: "load-search", tasks });
  }, []);
  const clearSearch = useCallback(() => {
    dispatch({ type: "clear-search" });
  }, []);
  const reconcileTask = useCallback((task: TaskResponse) => {
    dispatch({ type: "reconcile-task", task });
  }, []);
  const removeTask = useCallback((taskId: number) => {
    dispatch({ type: "remove-task", taskId });
  }, []);
  const replaceCategoryReference = useCallback(
    (categoryId: number, replacement: TaskCategoryResponse | null) => {
      dispatch({
        type: "replace-category-reference",
        categoryId,
        replacement,
      });
    },
    [],
  );

  return {
    ...state,
    loadReady,
    loadBrowse,
    loadSearch,
    clearSearch,
    reconcileTask,
    removeTask,
    replaceCategoryReference,
  };
}

import { describe, expect, it } from "vitest";

import type { TaskResponse } from "../../../shared/api";
import {
  initialTaskCollectionsState,
  taskCollectionsReducer,
  type TaskCollectionsState,
} from "./useTaskCollections";

function task(
  overrides: Partial<TaskResponse> & Pick<TaskResponse, "id" | "name">,
): TaskResponse {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    category: { id: 1, name: "Kitchen" },
    targetIntervalDays: 14,
    snoozedUntil: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    archivedAt: null,
    lastCompletedAt: "2026-07-01T08:00:00.000Z",
    elapsedDays: 30,
    overageDays: 16,
    state: "ready",
    isSnoozed: false,
    visibleInReady: true,
    ...rest,
  };
}

function loadedState(tasks: TaskResponse[]): TaskCollectionsState {
  return {
    readyTasks: tasks,
    sleepingTasks: [],
    browseTasks: tasks,
    browseLoaded: true,
    searchTasks: tasks,
    archivedTasks: [],
    archivedLoaded: true,
  };
}

describe("task collection reconciliation", () => {
  it("moves a completed task from Ready to Sleeping in every loaded view", () => {
    const readyTask = task({ id: 1, name: "Clean oven" });
    const completedTask = task({
      ...readyTask,
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });

    const result = taskCollectionsReducer(loadedState([readyTask]), {
      type: "reconcile-task",
      task: completedTask,
    });

    expect(result.readyTasks).toEqual([]);
    expect(result.sleepingTasks).toEqual([completedTask]);
    expect(result.browseTasks).toEqual([completedTask]);
    expect(result.searchTasks).toEqual([completedTask]);
  });

  it("reconciles an authoritative historical completion across every loaded active collection", () => {
    const readyTask = task({ id: 1, name: "Clean oven" });
    const historicalTask = task({
      ...readyTask,
      lastCompletedAt: "2026-08-05T23:00:00.000Z",
      elapsedDays: 6,
      overageDays: 0,
      state: "sleeping",
      snoozedUntil: "2026-08-20T23:00:00.000Z",
      isSnoozed: true,
      visibleInReady: false,
    });

    const result = taskCollectionsReducer(loadedState([readyTask]), {
      type: "reconcile-task",
      task: historicalTask,
    });

    expect(result.readyTasks).toEqual([]);
    expect(result.sleepingTasks).toEqual([historicalTask]);
    expect(result.browseTasks).toEqual([historicalTask]);
    expect(result.searchTasks).toEqual([historicalTask]);
  });

  it("does not populate Browse or Search before those collections load", () => {
    const readyTask = task({ id: 1, name: "Clean oven" });
    const result = taskCollectionsReducer(initialTaskCollectionsState, {
      type: "reconcile-task",
      task: readyTask,
    });

    expect(result.readyTasks).toEqual([readyTask]);
    expect(result.browseTasks).toEqual([]);
    expect(result.browseLoaded).toBe(false);
    expect(result.searchTasks).toBeNull();
  });

  it("removes archived tasks and updates category references everywhere", () => {
    const original = task({ id: 1, name: "Clean oven" });
    const reassigned = task({
      ...original,
      category: { id: 2, name: "Home" },
    });
    const replaced = taskCollectionsReducer(loadedState([original]), {
      type: "replace-category-reference",
      categoryId: 1,
      replacement: reassigned.category,
    });

    expect(replaced.readyTasks[0]?.category).toEqual(reassigned.category);
    expect(replaced.browseTasks[0]?.category).toEqual(reassigned.category);
    expect(replaced.searchTasks?.[0]?.category).toEqual(reassigned.category);

    const removed = taskCollectionsReducer(replaced, {
      type: "remove-task",
      taskId: original.id,
    });
    expect(removed.readyTasks).toEqual([]);
    expect(removed.sleepingTasks).toEqual([]);
    expect(removed.browseTasks).toEqual([]);
    expect(removed.searchTasks).toEqual([]);
  });

  it("removes a restored task from archives and returns it to its derived active collections", () => {
    const archived = task({
      id: 1,
      name: "Clean oven",
      archivedAt: "2026-08-10T08:00:00.000Z",
      visibleInReady: false,
    });
    const state: TaskCollectionsState = {
      ...initialTaskCollectionsState,
      browseLoaded: true,
      searchTasks: [],
      archivedTasks: [archived],
      archivedLoaded: true,
    };
    const restored = task({
      ...archived,
      archivedAt: null,
      visibleInReady: true,
    });

    const result = taskCollectionsReducer(state, {
      type: "reconcile-task",
      task: restored,
    });

    expect(result.archivedTasks).toEqual([]);
    expect(result.readyTasks).toEqual([restored]);
    expect(result.sleepingTasks).toEqual([]);
    expect(result.browseTasks).toEqual([restored]);
    expect(result.searchTasks).toEqual([restored]);
  });

  it("keeps restored sleeping and snoozed tasks out of the visible Ready list", () => {
    const archived = task({
      id: 1,
      name: "Clean oven",
      archivedAt: "2026-08-10T08:00:00.000Z",
      visibleInReady: false,
    });
    const state: TaskCollectionsState = {
      ...initialTaskCollectionsState,
      browseLoaded: true,
      archivedTasks: [archived],
      archivedLoaded: true,
    };
    const sleeping = task({
      ...archived,
      archivedAt: null,
      state: "sleeping",
      visibleInReady: false,
    });
    const sleepingResult = taskCollectionsReducer(state, {
      type: "reconcile-task",
      task: sleeping,
    });
    expect(sleepingResult.readyTasks).toEqual([]);
    expect(sleepingResult.sleepingTasks).toEqual([sleeping]);
    expect(sleepingResult.browseTasks).toEqual([sleeping]);

    const snoozed = task({
      ...archived,
      archivedAt: null,
      isSnoozed: true,
      snoozedUntil: "2026-08-20T23:00:00.000Z",
      visibleInReady: false,
    });
    const snoozedResult = taskCollectionsReducer(state, {
      type: "reconcile-task",
      task: snoozed,
    });
    expect(snoozedResult.readyTasks).toEqual([]);
    expect(snoozedResult.sleepingTasks).toEqual([]);
    expect(snoozedResult.browseTasks).toEqual([snoozed]);
  });
});

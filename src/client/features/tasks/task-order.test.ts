import { describe, expect, it } from "vitest";

import type { TaskResponse } from "../../../shared/api";
import {
  compareBrowseTasks,
  compareReadyTasks,
  compareSleepingTasks,
} from "./task-order";

function task(
  overrides: Partial<TaskResponse> & Pick<TaskResponse, "id" | "name">,
): TaskResponse {
  const { id, name, ...rest } = overrides;

  return {
    id,
    name,
    category: null,
    targetIntervalDays: 14,
    snoozedUntil: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    archivedAt: null,
    lastCompletedAt: "2026-08-01T08:00:00.000Z",
    elapsedDays: 10,
    overageDays: 0,
    state: "sleeping",
    isSnoozed: false,
    visibleInReady: false,
    ...rest,
  };
}

describe("client task ordering", () => {
  it("orders Ready and Sleeping lists by their established presentation rules", () => {
    const never = task({
      id: 1,
      name: "Never",
      elapsedDays: null,
      lastCompletedAt: null,
      overageDays: null,
      state: "ready",
      visibleInReady: true,
    });
    const older = task({
      id: 2,
      name: "Older",
      elapsedDays: 20,
      state: "ready",
      visibleInReady: true,
    });
    const newer = task({ id: 3, name: "Newer", elapsedDays: 4 });

    expect([newer, older, never].sort(compareReadyTasks)).toEqual([
      never,
      older,
      newer,
    ]);
    expect([newer, older].sort(compareSleepingTasks)).toEqual([older, newer]);
  });

  it("orders Browse tasks as visible Ready, Sleeping, then snoozed", () => {
    const ready = task({
      id: 1,
      name: "Ready",
      elapsedDays: 20,
      state: "ready",
      visibleInReady: true,
    });
    const sleeping = task({ id: 2, name: "Sleeping" });
    const snoozed = task({
      id: 3,
      name: "Snoozed",
      elapsedDays: 30,
      state: "ready",
      isSnoozed: true,
      visibleInReady: false,
    });

    expect([snoozed, sleeping, ready].sort(compareBrowseTasks)).toEqual([
      ready,
      sleeping,
      snoozed,
    ]);
  });
});

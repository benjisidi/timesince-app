import { describe, expect, it } from "vitest";

import type { TaskResponse } from "../../../shared/api";
import { rankSearchResults } from "./task-search";

function task(id: number, name: string, category: string): TaskResponse {
  return {
    id,
    name,
    category: { id, name: category },
    targetIntervalDays: 14,
    snoozedUntil: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    archivedAt: null,
    lastCompletedAt: null,
    elapsedDays: null,
    overageDays: null,
    state: "ready",
    isSnoozed: false,
    visibleInReady: true,
  };
}

describe("task search ranking", () => {
  it("returns relevant name and category matches with name matches first", () => {
    const categoryMatch = task(1, "Wipe worktop", "Kitchen");
    const nameMatch = task(2, "Kitchen shelves", "Bedroom");
    const irrelevant = task(3, "Replace batteries", "Bedroom");

    expect(
      rankSearchResults([categoryMatch, irrelevant, nameMatch], "kitchen"),
    ).toEqual([nameMatch, categoryMatch]);
  });

  it("returns no results for an empty query", () => {
    expect(
      rankSearchResults([task(1, "Wipe worktop", "Kitchen")], "  "),
    ).toEqual([]);
  });
});

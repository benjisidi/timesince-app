// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompletionMutationResponse, TaskResponse } from "../shared/api";
import { App } from "./App";

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
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    archivedAt: null,
    lastCompletedAt: "2026-07-25T08:00:00.000Z",
    elapsedDays: 17,
    overageDays: 3,
    state: "ready",
    isSnoozed: false,
    visibleInReady: true,
    ...rest,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Task view", () => {
  it("loads the ordered sections and moves a completed Ready task to Upcoming", async () => {
    const readyTask = task({ id: 1, name: "Hoover floor" });
    const upcomingTask = task({
      id: 2,
      name: "Wash towels",
      elapsedDays: 4,
      overageDays: 0,
      state: "sleeping",
      targetIntervalDays: 30,
      visibleInReady: false,
    });
    const completedTask = task({
      ...readyTask,
      lastCompletedAt: "2026-08-11T16:00:00.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      targetIntervalDays: 7,
      visibleInReady: false,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready")) {
          return jsonResponse({ tasks: [readyTask] });
        }
        if (url.includes("state=sleeping")) {
          return jsonResponse({ tasks: [upcomingTask] });
        }
        if (url === "/api/tasks/1/completions" && init?.method === "POST") {
          const body: CompletionMutationResponse = {
            completion: {
              id: 10,
              taskId: 1,
              completedAt: "2026-08-11T16:00:00.000Z",
              createdAt: "2026-08-11T16:00:00.000Z",
            },
            task: completedTask,
          };
          return jsonResponse(body, 201);
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    render(<App />);

    const readySection = await screen.findByRole("region", { name: /Ready/ });
    const upcomingSection = screen.getByRole("region", { name: /Upcoming/ });
    expect(within(readySection).getByText("Hoover floor")).toBeTruthy();
    expect(within(upcomingSection).getByText("Wash towels")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready 1 task" })).toBeTruthy();

    await userEvent.click(
      within(readySection).getByRole("button", {
        name: "Complete Hoover floor",
      }),
    );

    await waitFor(() => {
      expect(within(readySection).queryByText("Hoover floor")).toBeNull();
      expect(within(upcomingSection).getByText("Hoover floor")).toBeTruthy();
    });
    const upcomingRows = within(upcomingSection).getAllByRole("listitem");
    expect(within(upcomingRows[0]!).getByText("Wash towels")).toBeTruthy();
    expect(within(upcomingRows[1]!).getByText("Hoover floor")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready 0 tasks" })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/tasks/1/completions" &&
          init?.method === "POST" &&
          init.body === "{}",
      ),
    ).toBe(true);
  });
});

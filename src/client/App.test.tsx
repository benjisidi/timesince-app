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

  it("creates a categorized task with a previous completion date", async () => {
    const createdTask = task({
      id: 3,
      name: "Clean fridge",
      category: { id: 2, name: "Kitchen" },
      targetIntervalDays: 30,
      lastCompletedAt: "2026-08-05T23:00:00.000Z",
      elapsedDays: 5,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready")) return jsonResponse({ tasks: [] });
        if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
        if (url === "/api/categories") {
          return jsonResponse({
            categories: [{ id: 2, name: "Kitchen", position: 0 }],
          });
        }
        if (url === "/api/config") {
          return jsonResponse({ timeZone: "Europe/London" });
        }
        if (url === "/api/tasks" && init?.method === "POST") {
          return jsonResponse(createdTask, 201);
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    render(<App />);
    await screen.findByRole("heading", { name: "Ready 0 tasks" });
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    await screen.findByRole("option", { name: "Kitchen" });

    await userEvent.type(screen.getByLabelText("Name"), "Clean fridge");
    await userEvent.type(screen.getByLabelText(/Target interval/), "30");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");
    await userEvent.click(screen.getByText("Previous completion"));
    await userEvent.type(screen.getByLabelText(/Last completed/), "2026-08-06");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    const upcomingSection = screen.getByRole("region", { name: /Upcoming/ });
    await waitFor(() => {
      expect(within(upcomingSection).getByText("Clean fridge")).toBeTruthy();
    });
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/tasks" && init?.method === "POST",
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "Clean fridge",
      categoryId: 2,
      targetIntervalDays: 30,
      initialCompletedAt: "2026-08-06",
    });
  });

  it("opens editing from a task row and preserves values after an API error", async () => {
    const readyTask = task({ id: 1, name: "Hoover floor" });
    const updatedTask = task({ ...readyTask, name: "Vacuum floor" });
    let patchAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("state=ready"))
        return jsonResponse({ tasks: [readyTask] });
      if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
      if (url === "/api/categories") {
        return jsonResponse({
          categories: [{ id: 1, name: "Kitchen", position: 0 }],
        });
      }
      if (url === "/api/config")
        return jsonResponse({ timeZone: "Europe/London" });
      if (url === "/api/tasks/1" && init?.method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) {
          return jsonResponse(
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Task save failed",
                fields: { name: "Try a different name" },
              },
            },
            400,
          );
        }
        return jsonResponse(updatedTask);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Hoover floor" }),
    );
    await screen.findByRole("option", { name: "Kitchen" });
    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Vacuum floors");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Try a different name")).toBeTruthy();
    expect((nameInput as HTMLInputElement).value).toBe("Vacuum floors");

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Vacuum floor");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("button", { name: "Edit Vacuum floor" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

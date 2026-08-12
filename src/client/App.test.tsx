// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Backend availability", () => {
  it("uses offline state as a hint and retries failed API loads on reconnection", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp();

    expect(
      await screen.findByText(
        "TimeSince can’t reach its server. Changes won’t be saved until it reconnects.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    fireEvent(window, new Event("offline"));
    expect(await screen.findByText(/You appear to be offline/)).toBeTruthy();

    const callsBeforeOnline = fetchMock.mock.calls.length;
    fireEvent(window, new Event("online"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeOnline);
    });
    expect(
      await screen.findByText(
        "TimeSince can’t reach its server. Changes won’t be saved until it reconnects.",
      ),
    ).toBeTruthy();

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("state=ready") || url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [] });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(/No tasks yet/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/can’t reach its server/)).toBeNull();
    });
  });
});

describe("Global search", () => {
  it("fuzzy-ranks a flat task list and opens the selected task for editing", async () => {
    const categoryMatch = task({ id: 1, name: "Wipe worktop" });
    const nameMatch = task({
      id: 2,
      name: "Kitchen shelves",
      category: { id: 2, name: "Bedroom" },
    });
    const irrelevantTask = task({
      id: 3,
      name: "Replace smoke alarm batteries",
      category: { id: 2, name: "Bedroom" },
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("state=ready") || url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [] });
      }
      if (url === "/api/tasks?state=all") {
        return jsonResponse({
          tasks: [categoryMatch, irrelevantTask, nameMatch],
        });
      }
      if (url === "/api/categories") {
        return jsonResponse({
          categories: [
            { id: 1, name: "Kitchen", position: 0, activeTaskCount: 1 },
            { id: 2, name: "Bedroom", position: 1, activeTaskCount: 1 },
          ],
        });
      }
      if (url === "/api/config") {
        return jsonResponse({ timeZone: "Europe/London" });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp("/categories/manage");
    await screen.findByRole("heading", { name: "Manage categories" });
    await userEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search active tasks" }),
      "kitchen",
    );

    const results = await screen.findByRole("list", {
      name: "Search results",
    });
    expect(
      within(results)
        .getAllByRole("button", { name: /^Edit/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Edit Kitchen shelves", "Edit Wipe worktop"]);

    await userEvent.click(
      within(results).getByRole("button", { name: "Edit Kitchen shelves" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Manage categories" }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Search tasks" })).toBeNull();
  });

  it("opens with Cmd/Ctrl-K, clears on close, and restores trigger focus", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("state=ready") || url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [] });
      }
      if (url === "/api/tasks?state=all") return jsonResponse({ tasks: [] });
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp();
    const trigger = screen.getByRole("button", { name: "Search tasks" });
    trigger.focus();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const input = await screen.findByRole("searchbox", {
      name: "Search active tasks",
    });
    await userEvent.type(input, "oven");
    fireEvent(
      screen.getByRole("dialog", { name: "Search tasks" }),
      new Event("cancel", { cancelable: true }),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      (await screen.findByRole("searchbox", {
        name: "Search active tasks",
      })) as HTMLInputElement,
    ).toHaveProperty("value", "");
  });

  it("completes optimistically and restores the search result through exact-ID Undo", async () => {
    const readyTask = task({ id: 1, name: "Clean oven" });
    const completedTask = task({
      ...readyTask,
      lastCompletedAt: "2026-08-11T20:00:00.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const completionResponse = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready")) {
          return jsonResponse({ tasks: [readyTask] });
        }
        if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
        if (url === "/api/tasks?state=all") {
          return jsonResponse({ tasks: [readyTask] });
        }
        if (url === "/api/tasks/1/completions" && init?.method === "POST") {
          return completionResponse.promise;
        }
        if (url === "/api/completions/42" && init?.method === "DELETE") {
          return jsonResponse({
            completion: {
              id: 42,
              taskId: 1,
              completedAt: "2026-08-11T20:00:00.000Z",
              createdAt: "2026-08-11T20:00:00.000Z",
            },
            task: readyTask,
          });
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search active tasks" }),
      "clean",
    );
    const searchDialog = screen.getByRole("dialog", { name: "Search tasks" });
    await userEvent.click(
      await within(searchDialog).findByRole("button", {
        name: "Complete Clean oven",
      }),
    );
    expect(within(searchDialog).getByLabelText("0 days")).toBeTruthy();

    completionResponse.resolve(
      jsonResponse({
        completion: {
          id: 42,
          taskId: 1,
          completedAt: "2026-08-11T20:00:00.000Z",
          createdAt: "2026-08-11T20:00:00.000Z",
        },
        task: completedTask,
      }),
    );
    await userEvent.click(
      await within(searchDialog).findByRole("button", {
        name: "Undo completion of Clean oven",
      }),
    );
    await waitFor(() =>
      expect(
        within(searchDialog).getByLabelText(
          "17 days, 3 days beyond the target",
        ),
      ).toBeTruthy(),
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/completions/42" && init?.method === "DELETE",
      ),
    ).toBe(true);
  });
});

describe("Task view", () => {
  it("optimistically completes a Ready task and undoes its exact completion", async () => {
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

    const completionResponse = deferred<Response>();
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
          return completionResponse.promise;
        }
        if (url === "/api/completions/10" && init?.method === "DELETE") {
          const body: CompletionMutationResponse = {
            completion: {
              id: 10,
              taskId: 1,
              completedAt: "2026-08-11T16:00:00.000Z",
              createdAt: "2026-08-11T16:00:00.000Z",
            },
            task: readyTask,
          };
          return jsonResponse(body);
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    renderApp();

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

    expect(within(readySection).queryByText("Hoover floor")).toBeNull();
    expect(within(upcomingSection).getByText("Hoover floor")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Undo completion/ }),
    ).toBeNull();
    const upcomingRows = within(upcomingSection).getAllByRole("listitem");
    expect(within(upcomingRows[0]!).getByText("Wash towels")).toBeTruthy();
    expect(within(upcomingRows[1]!).getByText("Hoover floor")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready 0 tasks" })).toBeTruthy();

    completionResponse.resolve(
      jsonResponse(
        {
          completion: {
            id: 10,
            taskId: 1,
            completedAt: "2026-08-11T16:00:00.000Z",
            createdAt: "2026-08-11T16:00:00.000Z",
          },
          task: completedTask,
        } satisfies CompletionMutationResponse,
        201,
      ),
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Undo completion of Hoover floor",
      }),
    );
    await waitFor(() => {
      expect(within(readySection).getByText("Hoover floor")).toBeTruthy();
      expect(within(upcomingSection).queryByText("Hoover floor")).toBeNull();
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/tasks/1/completions" &&
          init?.method === "POST" &&
          init.body === "{}",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/completions/10" && init?.method === "DELETE",
      ),
    ).toBe(true);
  });

  it("rolls back only the affected task when completion creation fails", async () => {
    const firstTask = task({ id: 1, name: "Hoover floor" });
    const secondTask = task({ id: 2, name: "Clean sink", elapsedDays: 15 });
    const completionResponse = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("state=ready")) {
        return jsonResponse({ tasks: [firstTask, secondTask] });
      }
      if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
      if (url === "/api/tasks/1/completions" && init?.method === "POST") {
        return completionResponse.promise;
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp();
    const readySection = await screen.findByRole("region", { name: /Ready/ });
    const upcomingSection = screen.getByRole("region", { name: /Upcoming/ });
    await userEvent.click(
      within(readySection).getByRole("button", {
        name: "Complete Hoover floor",
      }),
    );

    expect(within(readySection).queryByText("Hoover floor")).toBeNull();
    expect(within(upcomingSection).getByText("Hoover floor")).toBeTruthy();

    completionResponse.resolve(
      jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Completion failed" } },
        500,
      ),
    );

    expect(
      await screen.findByText(/Couldn’t complete Hoover floor/),
    ).toBeTruthy();
    expect(within(readySection).getByText("Hoover floor")).toBeTruthy();
    expect(within(readySection).getByText("Clean sink")).toBeTruthy();
    expect(within(upcomingSection).queryByText("Hoover floor")).toBeNull();
    expect(screen.getByRole("heading", { name: "Ready 2 tasks" })).toBeTruthy();
  });

  it("keeps rapid completions independent and retains a failed Undo for retry", async () => {
    const firstTask = task({ id: 1, name: "Hoover floor" });
    const secondTask = task({
      id: 2,
      name: "Clean sink",
      elapsedDays: 4,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const completedFirst = task({
      ...firstTask,
      lastCompletedAt: "2026-08-11T16:00:00.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const completedSecond = task({
      ...secondTask,
      lastCompletedAt: "2026-08-11T16:00:01.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    let firstUndoAttempts = 0;
    const completion = (id: number, taskId: number, completedAt: string) => ({
      id,
      taskId,
      completedAt,
      createdAt: completedAt,
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("state=ready")) {
        return jsonResponse({ tasks: [firstTask] });
      }
      if (url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [secondTask] });
      }
      if (url === "/api/tasks/1/completions" && init?.method === "POST") {
        return jsonResponse(
          {
            completion: completion(10, 1, "2026-08-11T16:00:00.000Z"),
            task: completedFirst,
          } satisfies CompletionMutationResponse,
          201,
        );
      }
      if (url === "/api/tasks/2/completions" && init?.method === "POST") {
        return jsonResponse(
          {
            completion: completion(11, 2, "2026-08-11T16:00:01.000Z"),
            task: completedSecond,
          } satisfies CompletionMutationResponse,
          201,
        );
      }
      if (url === "/api/completions/10" && init?.method === "DELETE") {
        firstUndoAttempts += 1;
        if (firstUndoAttempts === 1) {
          return jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: "Undo failed" } },
            500,
          );
        }
        return jsonResponse({
          completion: completion(10, 1, "2026-08-11T16:00:00.000Z"),
          task: firstTask,
        } satisfies CompletionMutationResponse);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp();
    const readySection = await screen.findByRole("region", { name: /Ready/ });
    const upcomingSection = screen.getByRole("region", { name: /Upcoming/ });
    await userEvent.click(
      within(readySection).getByRole("button", {
        name: "Complete Hoover floor",
      }),
    );
    await userEvent.click(
      within(upcomingSection).getByRole("button", {
        name: "Complete Clean sink",
      }),
    );

    const firstUndo = await screen.findByRole("button", {
      name: "Undo completion of Hoover floor",
    });
    expect(
      screen.getByRole("button", { name: "Undo completion of Clean sink" }),
    ).toBeTruthy();
    expect(
      (
        within(upcomingSection).getByRole("button", {
          name: "Complete Hoover floor",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await userEvent.click(firstUndo);
    const retry = await screen.findByRole("button", {
      name: "Retry undo for Hoover floor",
    });
    expect(within(upcomingSection).getByText("Hoover floor")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Undo completion of Clean sink" }),
    ).toBeTruthy();

    await userEvent.click(retry);
    await waitFor(() => {
      expect(within(readySection).getByText("Hoover floor")).toBeTruthy();
      expect(within(upcomingSection).queryByText("Hoover floor")).toBeNull();
    });
    expect(firstUndoAttempts).toBe(2);
  });

  it("expires Undo after five active seconds and pauses while hovered", async () => {
    const readyTask = task({ id: 1, name: "Hoover floor" });
    const completedTask = task({
      ...readyTask,
      lastCompletedAt: "2026-08-11T16:00:00.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const completionResponse = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("state=ready")) {
        return jsonResponse({ tasks: [readyTask] });
      }
      if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
      if (url === "/api/tasks/1/completions" && init?.method === "POST") {
        return completionResponse.promise;
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Complete Hoover floor" }),
    );

    vi.useFakeTimers();
    await act(async () => {
      completionResponse.resolve(
        jsonResponse(
          {
            completion: {
              id: 10,
              taskId: 1,
              completedAt: "2026-08-11T16:00:00.000Z",
              createdAt: "2026-08-11T16:00:00.000Z",
            },
            task: completedTask,
          } satisfies CompletionMutationResponse,
          201,
        ),
      );
      await completionResponse.promise;
    });

    const feedback = screen.getByRole("region", {
      name: "Completion feedback for Hoover floor",
    });
    fireEvent.mouseEnter(feedback);
    act(() => vi.advanceTimersByTime(5_000));
    expect(within(feedback).getByText("Hoover floor")).toBeTruthy();

    fireEvent.mouseLeave(feedback);
    act(() => vi.advanceTimersByTime(4_999));
    expect(
      screen.getByRole("button", { name: "Undo completion of Hoover floor" }),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(
      screen.queryByRole("button", { name: "Undo completion of Hoover floor" }),
    ).toBeNull();
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

    renderApp();
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

  it("keeps the drawer open for repeated creation and only retains category", async () => {
    const createdTasks = [
      task({
        id: 3,
        name: "Dust shelves",
        category: { id: 2, name: "Bedroom" },
        targetIntervalDays: 14,
        lastCompletedAt: null,
        elapsedDays: null,
        overageDays: null,
      }),
      task({
        id: 4,
        name: "Turn mattress",
        category: { id: 2, name: "Bedroom" },
        targetIntervalDays: 90,
        lastCompletedAt: null,
        elapsedDays: null,
        overageDays: null,
      }),
    ];
    const createBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("state=ready")) return jsonResponse({ tasks: [] });
      if (url.includes("state=sleeping")) return jsonResponse({ tasks: [] });
      if (url === "/api/categories") {
        return jsonResponse({
          categories: [{ id: 2, name: "Bedroom", position: 0 }],
        });
      }
      if (url === "/api/config") {
        return jsonResponse({ timeZone: "Europe/London" });
      }
      if (url === "/api/tasks" && init?.method === "POST") {
        createBodies.push(JSON.parse(String(init.body)));
        return jsonResponse(createdTasks[createBodies.length - 1], 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp();
    await screen.findByRole("heading", { name: "Ready 0 tasks" });
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    await screen.findByRole("option", { name: "Bedroom" });

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const targetInput = screen.getByLabelText(
      /Target interval/,
    ) as HTMLInputElement;
    const categorySelect = screen.getByLabelText(
      "Category",
    ) as HTMLSelectElement;
    const createAnother = screen.getByLabelText(
      /Create another task/,
    ) as HTMLInputElement;

    await userEvent.type(nameInput, "Dust shelves");
    await userEvent.type(targetInput, "14");
    await userEvent.selectOptions(categorySelect, "2");
    await userEvent.click(createAnother);
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await screen.findByRole("button", { name: "Edit Dust shelves" });
    await waitFor(() => {
      expect(nameInput.value).toBe("");
      expect(targetInput.value).toBe("");
      expect(categorySelect.value).toBe("2");
      expect(document.activeElement).toBe(nameInput);
    });
    expect(screen.getByRole("dialog", { name: "Create task" })).toBeTruthy();

    await userEvent.type(nameInput, "Turn mattress");
    await userEvent.type(targetInput, "90");
    await userEvent.click(createAnother);
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await screen.findByRole("button", { name: "Edit Turn mattress" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(createBodies).toEqual([
      {
        name: "Dust shelves",
        categoryId: 2,
        targetIntervalDays: 14,
        initialCompletedAt: null,
      },
      {
        name: "Turn mattress",
        categoryId: 2,
        targetIntervalDays: 90,
        initialCompletedAt: null,
      },
    ]);
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

    renderApp();
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

describe("Category view", () => {
  it("groups active tasks in category order and retains collapsed sections", async () => {
    const readyTask = task({ id: 1, name: "Clean worktop" });
    const sleepingTask = task({
      id: 2,
      name: "Clean oven",
      elapsedDays: 4,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const snoozedTask = task({
      id: 3,
      name: "Mop floor",
      snoozedUntil: "2026-08-20T23:00:00.000Z",
      isSnoozed: true,
      visibleInReady: false,
    });
    const bedroomTask = task({
      id: 4,
      name: "Change sheets",
      category: { id: 2, name: "Bedroom" },
    });
    const uncategorizedTask = task({
      id: 5,
      name: "Review paperwork",
      category: null,
    });
    const allTasks = [
      sleepingTask,
      snoozedTask,
      uncategorizedTask,
      bedroomTask,
      readyTask,
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/tasks?state=all") {
        return jsonResponse({ tasks: allTasks });
      }
      if (url.includes("state=ready")) {
        return jsonResponse({ tasks: [readyTask, bedroomTask] });
      }
      if (url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [sleepingTask] });
      }
      if (url === "/api/categories") {
        return jsonResponse({
          categories: [
            { id: 1, name: "Kitchen", position: 0 },
            { id: 3, name: "Empty category", position: 1 },
            { id: 2, name: "Bedroom", position: 2 },
          ],
        });
      }
      if (url === "/api/config") {
        return jsonResponse({ timeZone: "Europe/London" });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    const firstRender = renderApp("/categories");
    await screen.findByRole("heading", { name: "Categories" });
    const categorySections = await screen.findAllByRole("region");
    expect(
      categorySections.map((section) =>
        section.getAttribute("aria-labelledby"),
      ),
    ).toEqual([
      "category-1-heading",
      "category-2-heading",
      "category-uncategorized-heading",
    ]);
    expect(screen.queryByText("Empty category")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Sleeping")).toBeNull();
    expect(screen.getByText(/Snoozed until/)).toBeTruthy();

    const kitchen = categorySections[0]!;
    expect(
      within(kitchen)
        .getAllByRole("button", { name: /^Edit/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Edit Clean worktop", "Edit Clean oven", "Edit Mop floor"]);

    await userEvent.click(
      screen.getByRole("button", { name: "Kitchen 3 tasks" }),
    );
    expect(screen.queryByText("Clean worktop")).toBeNull();
    firstRender.unmount();

    renderApp("/categories");
    const retainedToggle = await screen.findByRole("button", {
      name: "Kitchen 3 tasks",
    });
    expect(retainedToggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(retainedToggle);
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Clean worktop" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
  });

  it("completes and undoes a task without removing it from its category", async () => {
    const readyTask = task({ id: 1, name: "Clean worktop" });
    const completedTask = task({
      ...readyTask,
      lastCompletedAt: "2026-08-11T19:00:00.000Z",
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
    const completionResponse = deferred<Response>();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks?state=all") {
        return jsonResponse({ tasks: [readyTask] });
      }
      if (url.includes("state=ready")) {
        return jsonResponse({ tasks: [readyTask] });
      }
      if (url.includes("state=sleeping")) {
        return jsonResponse({ tasks: [] });
      }
      if (url === "/api/categories") {
        return jsonResponse({
          categories: [{ id: 1, name: "Kitchen", position: 0 }],
        });
      }
      if (url === "/api/config") {
        return jsonResponse({ timeZone: "Europe/London" });
      }
      if (url === "/api/tasks/1/completions" && init?.method === "POST") {
        return completionResponse.promise;
      }
      if (url === "/api/completions/10" && init?.method === "DELETE") {
        return jsonResponse({
          completion: {
            id: 10,
            taskId: 1,
            completedAt: "2026-08-11T19:00:00.000Z",
            createdAt: "2026-08-11T19:00:00.000Z",
          },
          task: readyTask,
        });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No" } }, 404);
    });

    renderApp("/categories");
    await userEvent.click(
      await screen.findByRole("button", { name: "Complete Clean worktop" }),
    );
    expect(screen.getByText("Clean worktop")).toBeTruthy();
    expect(screen.getByLabelText("0 days")).toBeTruthy();

    completionResponse.resolve(
      jsonResponse({
        completion: {
          id: 10,
          taskId: 1,
          completedAt: "2026-08-11T19:00:00.000Z",
          createdAt: "2026-08-11T19:00:00.000Z",
        },
        task: completedTask,
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Undo completion of Clean worktop",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("17 days, 3 days beyond the target"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Clean worktop")).toBeTruthy();
  });
});

describe("Manage categories", () => {
  it("creates, preserves a failed rename, reorders, and removes with reassignment", async () => {
    let categories = [
      {
        id: 1,
        name: "Kitchen",
        position: 0,
        activeTaskCount: 1,
      },
      { id: 2, name: "Garden", position: 1, activeTaskCount: 0 },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready") || url.includes("state=sleeping")) {
          return jsonResponse({ tasks: [] });
        }
        if (url === "/api/categories" && !init?.method) {
          return jsonResponse({ categories });
        }
        if (url === "/api/categories" && init?.method === "POST") {
          const name = (JSON.parse(String(init.body)) as { name: string }).name;
          const created = {
            id: 3,
            name,
            position: categories.length,
            activeTaskCount: 0,
          };
          categories = [...categories, created];
          return jsonResponse(created, 201);
        }
        if (url === "/api/categories/2" && init?.method === "PATCH") {
          const name = (JSON.parse(String(init.body)) as { name: string }).name;
          if (name === "Kitchen") {
            return jsonResponse(
              {
                error: {
                  code: "CATEGORY_NAME_CONFLICT",
                  message: "A category with that name already exists",
                  fields: { name: "Choose a different category name" },
                },
              },
              409,
            );
          }
          categories = categories.map((category) =>
            category.id === 2 ? { ...category, name } : category,
          );
          return jsonResponse(categories.find(({ id }) => id === 2));
        }
        if (url === "/api/categories/order" && init?.method === "PUT") {
          const ids = (
            JSON.parse(String(init.body)) as { categoryIds: number[] }
          ).categoryIds;
          categories = ids.map((id, position) => ({
            ...categories.find((category) => category.id === id)!,
            position,
          }));
          return jsonResponse({ categories });
        }
        if (
          url === "/api/categories/1?replacementCategoryId=2" &&
          init?.method === "DELETE"
        ) {
          categories = categories
            .filter(({ id }) => id !== 1)
            .map((category, position) => ({
              ...category,
              position,
              activeTaskCount:
                category.id === 2 ? category.activeTaskCount + 1 : 0,
            }));
          return jsonResponse({ categories });
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    renderApp("/categories/manage");
    await screen.findByRole("heading", { name: "Manage categories" });
    expect(await screen.findByText("1 active task")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("New category"), "Admin");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("heading", { name: "Admin" });

    const gardenRow = screen
      .getByRole("heading", { name: "Garden" })
      .closest("li")!;
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Rename" }),
    );
    const renameInput = within(gardenRow).getByLabelText("Category name");
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Kitchen");
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Save" }),
    );
    expect(
      await screen.findByText("Choose a different category name"),
    ).toBeTruthy();
    expect((renameInput as HTMLInputElement).value).toBe("Kitchen");

    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Outdoors");
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Save" }),
    );
    await screen.findByRole("heading", { name: "Outdoors" });

    await userEvent.click(
      screen.getByRole("button", { name: "Move Admin up" }),
    );
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("heading", { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(["Kitchen", "Admin", "Outdoors"]);
    });

    const kitchenRow = screen
      .getByRole("heading", { name: "Kitchen" })
      .closest("li")!;
    await userEvent.click(
      within(kitchenRow).getByRole("button", { name: "Remove" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Move tasks to"), "2");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove category" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Kitchen" })).toBeNull(),
    );
    expect(screen.getByText("1 active task")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/categories/1?replacementCategoryId=2" &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  });
});

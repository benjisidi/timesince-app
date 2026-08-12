// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  jsonResponse,
  renderApp,
  resetClientTestState,
  task,
} from "./test-utils";

afterEach(resetClientTestState);

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

// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
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

describe("Browse view", () => {
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
    await screen.findByRole("heading", { name: "Browse" });
    expect(screen.getAllByRole("link", { name: "Ready" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Browse" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Manage" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Manage categories" }),
    ).toBeNull();
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
    expect(within(categorySections[0]!).queryByText("Ready")).toBeNull();
    expect(within(categorySections[0]!).queryByText("Sleeping")).toBeNull();
    expect(screen.getByText("Later")).toBeTruthy();
    expect(within(categorySections[1]!).queryByText("Later")).toBeNull();
    expect(screen.getByText(/Snoozed until/)).toBeTruthy();
    expect(screen.getByLabelText("1 ready, 3 tasks")).toBeTruthy();

    const kitchen = categorySections[0]!;
    expect(
      within(kitchen)
        .getAllByRole("button", { name: /^Edit/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Edit Clean worktop", "Edit Clean oven", "Edit Mop floor"]);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Kitchen 1 ready, 3 tasks",
      }),
    );
    expect(screen.queryByText("Clean worktop")).toBeNull();
    firstRender.unmount();

    renderApp("/categories");
    const retainedToggle = await screen.findByRole("button", {
      name: "Kitchen 1 ready, 3 tasks",
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

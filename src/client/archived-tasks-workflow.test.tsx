// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  jsonResponse,
  renderApp,
  resetClientTestState,
  task,
} from "./test-utils";

afterEach(resetClientTestState);

describe("Archived task management", () => {
  it("shows read-only context and restores through the existing active collections", async () => {
    const archived = task({
      id: 1,
      name: "Clean oven",
      archivedAt: "2026-08-10T08:00:00.000Z",
      snoozedUntil: "2026-08-01T23:00:00.000Z",
      isSnoozed: false,
      visibleInReady: false,
    });
    const active = task({ id: 2, name: "Active task" });
    const restored = task({
      ...archived,
      archivedAt: null,
      visibleInReady: true,
    });
    let restoreAttempts = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready")) {
          return jsonResponse({ tasks: [] });
        }
        if (url.includes("state=sleeping")) {
          return jsonResponse({ tasks: [] });
        }
        if (url === "/api/tasks?includeArchived=true&state=all") {
          return jsonResponse({ tasks: [active, archived] });
        }
        if (url === "/api/config") {
          return jsonResponse({ timeZone: "Europe/London" });
        }
        if (url === "/api/tasks/1/restore" && init?.method === "POST") {
          restoreAttempts += 1;
          return restoreAttempts === 1
            ? jsonResponse(
                {
                  error: {
                    code: "RESTORE_FAILED",
                    message: "Couldn’t restore this task",
                  },
                },
                500,
              )
            : jsonResponse(restored);
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    renderApp("/categories/archived");
    await screen.findByRole("heading", { name: "Archived tasks" });
    expect(await screen.findByText("Clean oven")).toBeTruthy();
    expect(screen.queryByText("Active task")).toBeNull();
    expect(screen.queryByText(/Snoozed until/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Complete/ })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "View archived task Clean oven" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Clean oven" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("Kitchen")).toBeTruthy();
    expect(within(dialog).getByText("Show again after")).toBeTruthy();
    expect(within(dialog).queryByText(/Snooze/)).toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Restore task" }));
    expect(await screen.findByText("Couldn’t restore this task")).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "Clean oven" }),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Restore task" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Clean oven" })).toBeNull(),
    );
    expect(screen.getByText("No archived tasks.")).toBeTruthy();

    await userEvent.click(screen.getAllByRole("link", { name: "Ready" })[0]!);
    expect(await screen.findByText("Clean oven")).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/tasks/1/restore" && init?.method === "POST",
      ),
    ).toHaveLength(2);
  });
});

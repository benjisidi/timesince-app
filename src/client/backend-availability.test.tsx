// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, renderApp, resetClientTestState } from "./test-utils";

afterEach(resetClientTestState);

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

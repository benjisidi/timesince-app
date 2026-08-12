import { cleanup, render } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";

import type { TaskResponse } from "../shared/api";
import { App } from "./App";

export function task(
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

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

export function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

export function resetClientTestState() {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

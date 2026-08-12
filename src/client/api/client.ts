import type { ApiErrorResponse } from "../../shared/api";

export const BACKEND_STATUS_EVENT = "timesince:backend-status";
export type BackendStatus = "reachable" | "unreachable";

let backendFailureVersion = 0;

function reportBackendStatus(status: BackendStatus) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BackendStatus>(BACKEND_STATUS_EVENT, { detail: status }),
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const failureVersionAtStart = backendFailureVersion;
  try {
    const response = await fetch(input, init);
    if (failureVersionAtStart === backendFailureVersion) {
      reportBackendStatus("reachable");
    }
    return response;
  } catch (error) {
    if (!isAbortError(error)) {
      backendFailureVersion += 1;
      reportBackendStatus("unreachable");
    }
    throw error;
  }
}

export class TaskApiError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
    readonly status?: number,
  ) {
    super(message);
    this.name = "TaskApiError";
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let fields: Record<string, string> = {};

    try {
      const body = (await response.json()) as ApiErrorResponse;
      if (body.error?.message) {
        message = body.error.message;
      }
      fields = body.error?.fields ?? {};
    } catch {
      // The status remains useful when the server does not return JSON.
    }

    throw new TaskApiError(message, fields, response.status);
  }

  return (await response.json()) as T;
}

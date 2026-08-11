import type {
  ApiErrorResponse,
  CompletionMutationResponse,
  TaskListResponse,
  TaskResponse,
} from "../shared/api";

export class TaskApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const body = (await response.json()) as ApiErrorResponse;
      if (body.error?.message) {
        message = body.error.message;
      }
    } catch {
      // The status remains useful when the server does not return JSON.
    }

    throw new TaskApiError(message);
  }

  return (await response.json()) as T;
}

async function fetchTaskList(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  return (await readJson<TaskListResponse>(response)).tasks;
}

export async function fetchTaskView(signal: AbortSignal) {
  const [ready, upcoming] = await Promise.all([
    fetchTaskList("/api/tasks?state=ready&visibleInReady=true", signal),
    fetchTaskList("/api/tasks?state=sleeping", signal),
  ]);

  return { ready, upcoming };
}

export async function completeTask(taskId: number): Promise<TaskResponse> {
  const response = await fetch(`/api/tasks/${taskId}/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return (await readJson<CompletionMutationResponse>(response)).task;
}

import type {
  AppConfigResponse,
  ApiErrorResponse,
  CategoryListResponse,
  CompletionMutationResponse,
  CreateTaskRequest,
  TaskListResponse,
  TaskResponse,
  UpdateTaskRequest,
} from "../shared/api";

export class TaskApiError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "TaskApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
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

    throw new TaskApiError(message, fields);
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

export async function fetchEditorDependencies(signal?: AbortSignal) {
  const requestInit = signal ? { signal } : undefined;
  const [categoryResponse, configResponse] = await Promise.all([
    fetch("/api/categories", requestInit),
    fetch("/api/config", requestInit),
  ]);
  const [{ categories }, config] = await Promise.all([
    readJson<CategoryListResponse>(categoryResponse),
    readJson<AppConfigResponse>(configResponse),
  ]);
  return { categories, timeZone: config.timeZone };
}

export async function createTask(
  input: CreateTaskRequest,
): Promise<TaskResponse> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<TaskResponse>(response);
}

export async function updateTask(
  taskId: number,
  input: UpdateTaskRequest,
): Promise<TaskResponse> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<TaskResponse>(response);
}

export async function archiveTask(taskId: number): Promise<void> {
  const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  if (!response.ok) {
    await readJson<never>(response);
  }
}

import type {
  AppConfigResponse,
  ApiErrorResponse,
  CategoryListResponse,
  CategoryResponse,
  CompletionMutationResponse,
  CreateCategoryRequest,
  CreateTaskRequest,
  ReorderCategoriesRequest,
  TaskListResponse,
  TaskResponse,
  UpdateCategoryRequest,
  UpdateTaskRequest,
} from "../shared/api";

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

    throw new TaskApiError(message, fields, response.status);
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

export async function fetchAllActiveTasks(signal: AbortSignal) {
  return fetchTaskList("/api/tasks?state=all", signal);
}

export async function fetchCategoryView(signal: AbortSignal) {
  const requestInit = { signal };
  const [taskResponse, categoryResponse, configResponse] = await Promise.all([
    fetch("/api/tasks?state=all", requestInit),
    fetch("/api/categories", requestInit),
    fetch("/api/config", requestInit),
  ]);
  const [{ tasks }, { categories }, config] = await Promise.all([
    readJson<TaskListResponse>(taskResponse),
    readJson<CategoryListResponse>(categoryResponse),
    readJson<AppConfigResponse>(configResponse),
  ]);

  return { tasks, categories, timeZone: config.timeZone };
}

export async function fetchCategories(signal?: AbortSignal) {
  const response = await fetch(
    "/api/categories",
    signal ? { signal } : undefined,
  );
  return (await readJson<CategoryListResponse>(response)).categories;
}

export async function createCategory(
  input: CreateCategoryRequest,
): Promise<CategoryResponse> {
  const response = await fetch("/api/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<CategoryResponse>(response);
}

export async function renameCategory(
  categoryId: number,
  input: UpdateCategoryRequest,
): Promise<CategoryResponse> {
  const response = await fetch(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<CategoryResponse>(response);
}

export async function reorderCategories(
  input: ReorderCategoriesRequest,
): Promise<CategoryResponse[]> {
  const response = await fetch("/api/categories/order", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await readJson<CategoryListResponse>(response)).categories;
}

export async function deleteCategory(
  categoryId: number,
  replacementCategoryId: number | null,
): Promise<CategoryResponse[]> {
  const query =
    replacementCategoryId === null
      ? ""
      : `?replacementCategoryId=${replacementCategoryId}`;
  const response = await fetch(`/api/categories/${categoryId}${query}`, {
    method: "DELETE",
  });
  return (await readJson<CategoryListResponse>(response)).categories;
}

export async function completeTask(
  taskId: number,
): Promise<CompletionMutationResponse> {
  const response = await fetch(`/api/tasks/${taskId}/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return readJson<CompletionMutationResponse>(response);
}

export async function undoCompletion(
  completionId: number,
): Promise<CompletionMutationResponse> {
  const response = await fetch(`/api/completions/${completionId}`, {
    method: "DELETE",
  });
  return readJson<CompletionMutationResponse>(response);
}

export async function fetchTask(taskId: number): Promise<TaskResponse> {
  const response = await fetch(`/api/tasks/${taskId}`);
  return readJson<TaskResponse>(response);
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

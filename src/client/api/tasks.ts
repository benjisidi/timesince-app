import type {
  CompletionMutationResponse,
  CreateTaskRequest,
  TaskListResponse,
  TaskResponse,
  UpdateTaskRequest,
} from "../../shared/api";
import { apiFetch, readJson } from "./client";

export async function fetchTaskList(path: string, signal: AbortSignal) {
  const response = await apiFetch(path, { signal });
  return (await readJson<TaskListResponse>(response)).tasks;
}

export async function fetchAllActiveTasks(signal: AbortSignal) {
  return fetchTaskList("/api/tasks?state=all", signal);
}

export async function completeTask(
  taskId: number,
): Promise<CompletionMutationResponse> {
  const response = await apiFetch(`/api/tasks/${taskId}/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return readJson<CompletionMutationResponse>(response);
}

export async function undoCompletion(
  completionId: number,
): Promise<CompletionMutationResponse> {
  const response = await apiFetch(`/api/completions/${completionId}`, {
    method: "DELETE",
  });
  return readJson<CompletionMutationResponse>(response);
}

export async function fetchTask(taskId: number): Promise<TaskResponse> {
  const response = await apiFetch(`/api/tasks/${taskId}`);
  return readJson<TaskResponse>(response);
}

export async function createTask(
  input: CreateTaskRequest,
): Promise<TaskResponse> {
  const response = await apiFetch("/api/tasks", {
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
  const response = await apiFetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<TaskResponse>(response);
}

export async function archiveTask(taskId: number): Promise<void> {
  const response = await apiFetch(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    await readJson<never>(response);
  }
}

import type { TaskState } from "./task-state";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface TaskCategoryResponse {
  id: number;
  name: string;
}

export interface TaskResponse {
  id: number;
  name: string;
  category: TaskCategoryResponse | null;
  targetIntervalDays: number;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastCompletedAt: string | null;
  elapsedDays: number | null;
  overageDays: number | null;
  state: TaskState;
  isSnoozed: boolean;
  visibleInReady: boolean;
}

export interface CompletionResponse {
  id: number;
  taskId: number;
  completedAt: string;
  createdAt: string;
}

export interface TaskListResponse {
  tasks: TaskResponse[];
}

export interface CompletionListResponse {
  completions: CompletionResponse[];
}

export interface CompletionMutationResponse {
  completion: CompletionResponse;
  task: TaskResponse;
}

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

export interface CategoryResponse extends TaskCategoryResponse {
  position: number;
  activeTaskCount: number;
}

export interface CategoryListResponse {
  categories: CategoryResponse[];
}

export interface CreateCategoryRequest {
  name: string;
}

export interface UpdateCategoryRequest {
  name: string;
}

export interface ReorderCategoriesRequest {
  categoryIds: number[];
}

export interface AppConfigResponse {
  timeZone: string;
}

export interface CreateTaskRequest {
  name: string;
  categoryId: number | null;
  targetIntervalDays: number;
  initialCompletedAt: string | null;
}

export interface UpdateTaskRequest {
  name: string;
  categoryId: number | null;
  targetIntervalDays: number;
  snoozedUntil: string | null;
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

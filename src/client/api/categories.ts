import type {
  CategoryListResponse,
  CategoryResponse,
  CreateCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from "../../shared/api";
import { apiFetch, readJson } from "./client";

export async function fetchCategories(signal?: AbortSignal) {
  const response = await apiFetch(
    "/api/categories",
    signal ? { signal } : undefined,
  );
  return (await readJson<CategoryListResponse>(response)).categories;
}

export async function createCategory(
  input: CreateCategoryRequest,
): Promise<CategoryResponse> {
  const response = await apiFetch("/api/categories", {
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
  const response = await apiFetch(`/api/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<CategoryResponse>(response);
}

export async function reorderCategories(
  input: ReorderCategoriesRequest,
): Promise<CategoryResponse[]> {
  const response = await apiFetch("/api/categories/order", {
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
  const response = await apiFetch(`/api/categories/${categoryId}${query}`, {
    method: "DELETE",
  });
  return (await readJson<CategoryListResponse>(response)).categories;
}

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CategoryResponse } from "../../shared/api";
import { TaskApiError } from "../api/client";

interface CategoryDeleteDialogProps {
  category: CategoryResponse;
  categories: CategoryResponse[];
  onCancel: () => void;
  onDelete: (replacementCategoryId: number | null) => Promise<void>;
}

function CategoryDeleteDialog({
  category,
  categories,
  onCancel,
  onDelete,
}: CategoryDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const taskLabel = category.activeTaskCount === 1 ? "task" : "tasks";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, []);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onDelete(replacementId ? Number(replacementId) : null);
    } catch (deleteError) {
      setError(
        deleteError instanceof TaskApiError
          ? deleteError.message
          : "Couldn’t remove the category. Check your connection and try again.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog delete-category-dialog"
      aria-labelledby="delete-category-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!isDeleting) onCancel();
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Remove category</p>
            <h2 id="delete-category-heading" tabIndex={-1} data-initial-focus>
              Remove {category.name}?
            </h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Close category removal"
          >
            ×
          </button>
        </div>
        <p className="delete-category-summary">
          {category.activeTaskCount} active {taskLabel} will be reassigned. No
          tasks or completion history will be deleted. Any archived tasks in
          this category will be reassigned too.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="form-field">
          <span>Move tasks to</span>
          <select
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
            disabled={isDeleting}
          >
            <option value="">Uncategorized</option>
            {categories
              .filter((candidate) => candidate.id !== category.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="archive-button"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? "Removing…" : "Remove category"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface ManageCategoriesProps {
  loadState: "loading" | "ready" | "error";
  categories: CategoryResponse[];
  onRetry: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (categoryId: number, name: string) => Promise<void>;
  onReorder: (categoryIds: number[]) => Promise<void>;
  onDelete: (
    categoryId: number,
    replacementCategoryId: number | null,
  ) => Promise<void>;
}

export function ManageCategories({
  loadState,
  categories,
  onRetry,
  onCreate,
  onRename,
  onReorder,
  onDelete,
}: ManageCategoriesProps) {
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] =
    useState<CategoryResponse | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null) renameInputRef.current?.focus();
  }, [editingId]);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof TaskApiError
      ? (error.fields.name ?? error.message)
      : fallback;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    setCreateError(null);
    if (!name) {
      setCreateError("Enter a category name.");
      return;
    }
    setBusyAction("create");
    try {
      await onCreate(name);
      setCreateName("");
      setAnnouncement(`Created ${name}.`);
    } catch (error) {
      setCreateError(
        errorMessage(error, "Couldn’t create the category. Try again."),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRename(
    event: FormEvent<HTMLFormElement>,
    category: CategoryResponse,
  ) {
    event.preventDefault();
    const name = renameValue.trim();
    setActionError(null);
    if (!name) {
      setActionError("Enter a category name.");
      return;
    }
    setBusyAction(`rename-${category.id}`);
    try {
      await onRename(category.id, name);
      setEditingId(null);
      setAnnouncement(`Renamed ${category.name} to ${name}.`);
    } catch (error) {
      setActionError(
        errorMessage(error, "Couldn’t rename the category. Try again."),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= categories.length) return;
    const reordered = categories.map(({ id }) => id);
    [reordered[index], reordered[destination]] = [
      reordered[destination]!,
      reordered[index]!,
    ];
    setActionError(null);
    setBusyAction("reorder");
    try {
      await onReorder(reordered);
      setAnnouncement(`Moved ${categories[index]!.name}.`);
    } catch (error) {
      setActionError(
        error instanceof TaskApiError
          ? error.message
          : "Couldn’t reorder categories. Try again.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const isBusy = busyAction !== null;

  return (
    <main
      className="task-page manage-categories-page"
      aria-labelledby="manage-categories-title"
    >
      <div className="page-intro">
        <div>
          <h1 id="manage-categories-title">Manage categories</h1>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className="page-status" role="status">
          Loading categories…
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className="page-status error-state" role="alert">
          <p>Couldn’t load categories. Check your connection and try again.</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {loadState === "ready" ? (
        <>
          <form
            className="create-category-form"
            onSubmit={(event) => void handleCreate(event)}
            noValidate
          >
            <label className="form-field">
              <span>New category</span>
              <span className="category-create-controls">
                <input
                  value={createName}
                  onChange={(event) => {
                    setCreateName(event.target.value);
                    setCreateError(null);
                  }}
                  aria-invalid={Boolean(createError)}
                  aria-describedby={
                    createError ? "create-category-error" : undefined
                  }
                  disabled={isBusy}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isBusy}
                >
                  {busyAction === "create" ? "Adding…" : "Add"}
                </button>
              </span>
              {createError ? (
                <small id="create-category-error" role="alert">
                  {createError}
                </small>
              ) : null}
            </label>
          </form>

          {categories.length === 0 ? (
            <p className="all-tasks-empty">
              No categories yet. Add one to start organising tasks.
            </p>
          ) : (
            <section className="category-management" aria-label="Categories">
              {actionError ? (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              ) : null}
              <ol className="category-management-list">
                {categories.map((category, index) => {
                  const countLabel = `${category.activeTaskCount} ${category.activeTaskCount === 1 ? "active task" : "active tasks"}`;
                  const isEditing = editingId === category.id;
                  return (
                    <li key={category.id}>
                      {isEditing ? (
                        <form
                          className="category-rename-form"
                          onSubmit={(event) =>
                            void handleRename(event, category)
                          }
                        >
                          <label>
                            <span className="visually-hidden">
                              Category name
                            </span>
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(event) => {
                                setRenameValue(event.target.value);
                                setActionError(null);
                              }}
                              aria-invalid={Boolean(actionError)}
                              disabled={isBusy}
                            />
                          </label>
                          <button
                            className="primary-button"
                            type="submit"
                            disabled={isBusy}
                          >
                            {busyAction === `rename-${category.id}`
                              ? "Saving…"
                              : "Save"}
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setEditingId(null);
                              setActionError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="category-management-identity">
                            <h2>{category.name}</h2>
                            <span>{countLabel}</span>
                          </div>
                          <div className="category-management-actions">
                            <button
                              type="button"
                              onClick={() => void moveCategory(index, -1)}
                              disabled={isBusy || index === 0}
                              aria-label={`Move ${category.name} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => void moveCategory(index, 1)}
                              disabled={
                                isBusy || index === categories.length - 1
                              }
                              aria-label={`Move ${category.name} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setEditingId(category.id);
                                setRenameValue(category.name);
                                setActionError(null);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="remove-category-button"
                              disabled={isBusy}
                              onClick={() => setDeletingCategory(category)}
                            >
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {deletingCategory ? (
        <CategoryDeleteDialog
          category={deletingCategory}
          categories={categories}
          onCancel={() => setDeletingCategory(null)}
          onDelete={async (replacementCategoryId) => {
            await onDelete(deletingCategory.id, replacementCategoryId);
            setAnnouncement(`Removed ${deletingCategory.name}.`);
            setDeletingCategory(null);
          }}
        />
      ) : null}
    </main>
  );
}

import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import type { CategoryResponse, TaskResponse } from "../shared/api";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  renameCategory,
  reorderCategories,
} from "./api/categories";
import {
  BACKEND_STATUS_EVENT,
  TaskApiError,
  type BackendStatus,
} from "./api/client";
import {
  fetchCategoryView,
  fetchEditorDependencies,
  fetchTaskView,
} from "./api/loaders";
import {
  completeTask,
  fetchAllActiveTasks,
  fetchTask,
  undoCompletion,
} from "./api/tasks";
import { AppNavigation } from "./components/AppNavigation";
import { AddTaskButton } from "./components/TaskList";
import {
  UndoStack,
  type UndoItem,
  type UndoStatus,
} from "./features/completion/UndoStack";
import {
  TaskEditor,
  type EditorDependencies,
  type EditorState,
} from "./features/editor/TaskEditor";
import { TaskSearchDialog } from "./features/search/TaskSearchDialog";
import { BrowsePage } from "./pages/BrowsePage";
import { ManageCategories } from "./pages/ManageCategoriesPage";
import { ReadyPage } from "./pages/ReadyPage";
import { PwaStatus } from "./PwaStatus";

type LoadState = "loading" | "ready" | "error";
type DependencyState = "idle" | LoadState;
const SLEEPING_EXPANDED_KEY = "timesince.sleeping-expanded.v1";
function compareByNameAndId(first: TaskResponse, second: TaskResponse) {
  return first.name.localeCompare(second.name) || first.id - second.id;
}

function compareReady(first: TaskResponse, second: TaskResponse) {
  if (first.elapsedDays === null && second.elapsedDays !== null) return -1;
  if (first.elapsedDays !== null && second.elapsedDays === null) return 1;
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

function compareSleeping(first: TaskResponse, second: TaskResponse) {
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

function optimisticallyCompleteTask(task: TaskResponse): TaskResponse {
  return {
    ...task,
    lastCompletedAt: new Date().toISOString(),
    elapsedDays: 0,
    overageDays: 0,
    state: "sleeping",
    visibleInReady: false,
  };
}

function readSleepingExpanded() {
  try {
    return window.localStorage.getItem(SLEEPING_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

export function App() {
  const location = useLocation();
  const isCategoryView = location.pathname === "/categories";
  const isManageCategories = location.pathname === "/categories/manage";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [readyTasks, setReadyTasks] = useState<TaskResponse[]>([]);
  const [sleepingTasks, setSleepingTasks] = useState<TaskResponse[]>([]);
  const [sleepingExpanded, setSleepingExpanded] =
    useState(readSleepingExpanded);
  const [categoryLoadState, setCategoryLoadState] =
    useState<DependencyState>("idle");
  const [categoryLoadAttempt, setCategoryLoadAttempt] = useState(0);
  const [categoryTasks, setCategoryTasks] = useState<TaskResponse[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryResponse[]>([]);
  const [categoryTimeZone, setCategoryTimeZone] = useState<string | null>(null);
  const [managementLoadState, setManagementLoadState] =
    useState<LoadState>("loading");
  const [managementLoadAttempt, setManagementLoadAttempt] = useState(0);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [undoItems, setUndoItems] = useState<UndoItem[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoadState, setSearchLoadState] =
    useState<DependencyState>("idle");
  const [searchLoadAttempt, setSearchLoadAttempt] = useState(0);
  const [searchTasks, setSearchTasks] = useState<TaskResponse[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorDependencies, setEditorDependencies] =
    useState<EditorDependencies | null>(null);
  const [dependencyState, setDependencyState] =
    useState<DependencyState>("idle");
  const [appearsOffline, setAppearsOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const nextUndoIdRef = useRef(1);

  const completionDisabledTaskIds = new Set(completingTaskIds);
  for (const item of undoItems) completionDisabledTaskIds.add(item.taskId);

  useEffect(() => {
    function handleBackendStatus(event: Event) {
      const status = (event as CustomEvent<BackendStatus>).detail;
      setBackendUnavailable(status === "unreachable");
    }

    window.addEventListener(BACKEND_STATUS_EVENT, handleBackendStatus);
    return () =>
      window.removeEventListener(BACKEND_STATUS_EVENT, handleBackendStatus);
  }, []);

  useEffect(() => {
    function handleOffline() {
      setAppearsOffline(true);
    }

    function handleOnline() {
      setAppearsOffline(false);
      if (loadState === "error") setLoadAttempt((attempt) => attempt + 1);
      if (isCategoryView && categoryLoadState === "error") {
        setCategoryLoadAttempt((attempt) => attempt + 1);
      }
      if (isManageCategories && managementLoadState === "error") {
        setManagementLoadState("loading");
        setManagementLoadAttempt((attempt) => attempt + 1);
      }
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [
    categoryLoadState,
    isCategoryView,
    isManageCategories,
    loadState,
    managementLoadState,
  ]);

  useEffect(() => {
    const abortController = new AbortController();
    async function loadTasks() {
      setLoadState("loading");
      setCompletionError(null);
      try {
        const taskView = await fetchTaskView(abortController.signal);
        setReadyTasks(taskView.ready);
        setSleepingTasks(taskView.sleeping);
        setLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setLoadState("error");
      }
    }
    void loadTasks();
    return () => abortController.abort();
  }, [loadAttempt]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();
      if (document.querySelector("dialog[open]")) return;
      searchReturnFocusRef.current =
        document.activeElement as HTMLElement | null;
      setCompletionError(null);
      setSearchLoadState((current) => (current === "error" ? "idle" : current));
      setIsSearchOpen(true);
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    if (!isSearchOpen || searchTasks !== null) return;

    const abortController = new AbortController();
    fetchAllActiveTasks(abortController.signal)
      .then((tasks) => {
        setSearchTasks(tasks);
        setSearchLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setSearchLoadState("idle");
        } else {
          setSearchLoadState("error");
        }
      });

    return () => abortController.abort();
  }, [isSearchOpen, searchLoadAttempt, searchTasks]);

  useEffect(() => {
    if (!isCategoryView) return;

    const abortController = new AbortController();
    async function loadCategories() {
      setCategoryLoadState("loading");
      setCompletionError(null);
      try {
        const categoryView = await fetchCategoryView(abortController.signal);
        setCategoryTasks(categoryView.tasks);
        setCategoryList(categoryView.categories);
        setCategoryTimeZone(categoryView.timeZone);
        setEditorDependencies({
          categories: categoryView.categories,
          timeZone: categoryView.timeZone,
        });
        setDependencyState("ready");
        setCategoryLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setCategoryLoadState("error");
      }
    }
    void loadCategories();
    return () => abortController.abort();
  }, [categoryLoadAttempt, isCategoryView]);

  useEffect(() => {
    if (!isManageCategories) return;
    const abortController = new AbortController();
    fetchCategories(abortController.signal)
      .then((categories) => {
        setCategoryList(categories);
        setEditorDependencies((current) =>
          current ? { ...current, categories } : current,
        );
        setManagementLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setManagementLoadState("error");
        }
      });
    return () => abortController.abort();
  }, [isManageCategories, managementLoadAttempt]);

  async function loadDependencies() {
    setDependencyState("loading");
    try {
      setEditorDependencies(await fetchEditorDependencies());
      setDependencyState("ready");
    } catch {
      setDependencyState("error");
    }
  }

  function openEditor(
    nextEditor: EditorState,
    returnFocus = document.activeElement as HTMLElement | null,
  ) {
    returnFocusRef.current = returnFocus;
    setEditor(nextEditor);
    if (!editorDependencies && dependencyState !== "loading")
      void loadDependencies();
  }

  function closeEditor() {
    setEditor(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  function openSearch(trigger: HTMLElement | null) {
    if (document.querySelector("dialog[open]")) return;
    searchReturnFocusRef.current = trigger;
    setCompletionError(null);
    setSearchLoadState((current) => (current === "error" ? "idle" : current));
    setIsSearchOpen(true);
  }

  function closeSearch() {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    setCompletionError(null);
    window.setTimeout(() => returnFocus?.focus(), 0);
  }

  function selectSearchResult(task: TaskResponse) {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    setCompletionError(null);
    openEditor({ mode: "edit", task }, returnFocus);
  }

  function reconcileTask(task: TaskResponse) {
    setReadyTasks((current) => {
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null &&
        task.state === "ready" &&
        task.visibleInReady
        ? [...remaining, task].sort(compareReady)
        : remaining;
    });
    setSleepingTasks((current) => {
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null && task.state === "sleeping"
        ? [...remaining, task].sort(compareSleeping)
        : remaining;
    });
    if (categoryLoadState === "ready") {
      setCategoryTasks((current) => {
        const remaining = current.filter((item) => item.id !== task.id);
        return task.archivedAt === null ? [...remaining, task] : remaining;
      });
    }
    setSearchTasks((current) => {
      if (current === null) return current;
      const remaining = current.filter((item) => item.id !== task.id);
      return task.archivedAt === null ? [...remaining, task] : remaining;
    });
  }

  function storeCategories(categories: CategoryResponse[]) {
    setCategoryList(categories);
    setEditorDependencies((current) =>
      current ? { ...current, categories } : current,
    );
  }

  function reconcileCategoryReference(
    categoryId: number,
    replacement: { id: number; name: string } | null,
  ) {
    const update = (tasks: TaskResponse[]) =>
      tasks.map((task) =>
        task.category?.id === categoryId
          ? { ...task, category: replacement }
          : task,
      );
    setReadyTasks(update);
    setSleepingTasks(update);
    setCategoryTasks(update);
    setSearchTasks((current) => (current === null ? current : update(current)));
  }

  function focusCompletionControl(taskId: number) {
    window.setTimeout(() => {
      const controls = document.querySelectorAll<HTMLButtonElement>(
        `[data-completion-task-id="${taskId}"]`,
      );
      controls.item(controls.length - 1)?.focus();
    }, 0);
  }

  async function handleComplete(task: TaskResponse, shouldFocusUndo: boolean) {
    if (completionDisabledTaskIds.has(task.id)) return;
    setCompletionError(null);
    setAnnouncement("");
    setCompletingTaskIds((current) => new Set(current).add(task.id));
    reconcileTask(optimisticallyCompleteTask(task));
    try {
      const result = await completeTask(task.id);
      reconcileTask(result.task);
      const undoItem: UndoItem = {
        id: nextUndoIdRef.current++,
        completionId: result.completion.id,
        taskId: task.id,
        taskName: task.name,
        status: "available",
        shouldFocus: shouldFocusUndo,
      };
      setUndoItems((current) => [...current, undoItem]);
      setAnnouncement(
        `Completed ${task.name}. Undo is available for five seconds.`,
      );
    } catch {
      reconcileTask(task);
      setCompletionError(
        `Couldn’t complete ${task.name}. Check your connection and try again.`,
      );
      if (shouldFocusUndo) focusCompletionControl(task.id);
    } finally {
      setCompletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function expireUndo(itemId: number) {
    setUndoItems((current) => current.filter((item) => item.id !== itemId));
  }

  function setUndoStatus(itemId: number, status: UndoStatus) {
    setUndoItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, status } : item)),
    );
  }

  async function handleUndo(item: UndoItem) {
    setAnnouncement("");
    setUndoStatus(item.id, "undoing");
    try {
      let task: TaskResponse;
      try {
        task = (await undoCompletion(item.completionId)).task;
      } catch (error) {
        if (!(error instanceof TaskApiError && error.status === 404)) {
          throw error;
        }
        task = await fetchTask(item.taskId);
      }
      reconcileTask(task);
      setUndoItems((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      setAnnouncement(`Undid completion of ${item.taskName}.`);
      focusCompletionControl(item.taskId);
    } catch {
      setUndoStatus(item.id, "failed");
      setAnnouncement(`Couldn’t undo completion of ${item.taskName}.`);
    }
  }

  function toggleSleeping() {
    setSleepingExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SLEEPING_EXPANDED_KEY, String(next));
      } catch {
        // The in-memory state still works when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      <AppNavigation onSearch={openSearch} />
      <div className="app-content">
        <PwaStatus
          appearsOffline={appearsOffline}
          backendUnavailable={backendUnavailable}
        />
        <Routes>
          <Route
            path="/"
            element={
              <ReadyPage
                loadState={loadState}
                readyTasks={readyTasks}
                sleepingTasks={sleepingTasks}
                sleepingExpanded={sleepingExpanded}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
                onToggleSleeping={toggleSleeping}
                onComplete={(task, shouldFocusUndo) =>
                  void handleComplete(task, shouldFocusUndo)
                }
                onEdit={(task) => openEditor({ mode: "edit", task })}
                onCreate={() => openEditor({ mode: "create" })}
              />
            }
          />
          <Route
            path="/categories"
            element={
              <BrowsePage
                loadState={categoryLoadState}
                tasks={categoryTasks}
                categories={categoryList}
                timeZone={categoryTimeZone}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setCategoryLoadAttempt((attempt) => attempt + 1)}
                onComplete={(task, shouldFocusUndo) =>
                  void handleComplete(task, shouldFocusUndo)
                }
                onEdit={(task) => openEditor({ mode: "edit", task })}
                onCreate={() => openEditor({ mode: "create" })}
              />
            }
          />
          <Route
            path="/categories/manage"
            element={
              <ManageCategories
                loadState={managementLoadState}
                categories={categoryList}
                onRetry={() => {
                  setManagementLoadState("loading");
                  setManagementLoadAttempt((attempt) => attempt + 1);
                }}
                onCreate={async (name) => {
                  const created = await createCategory({ name });
                  storeCategories(
                    [...categoryList, created].sort(
                      (first, second) =>
                        first.position - second.position ||
                        first.id - second.id,
                    ),
                  );
                }}
                onRename={async (categoryId, name) => {
                  const renamed = await renameCategory(categoryId, { name });
                  reconcileCategoryReference(categoryId, {
                    id: renamed.id,
                    name: renamed.name,
                  });
                  storeCategories(
                    categoryList.map((category) =>
                      category.id === categoryId ? renamed : category,
                    ),
                  );
                }}
                onReorder={async (categoryIds) => {
                  storeCategories(await reorderCategories({ categoryIds }));
                }}
                onDelete={async (categoryId, replacementCategoryId) => {
                  const replacement =
                    categoryList.find(
                      ({ id }) => id === replacementCategoryId,
                    ) ?? null;
                  const remainingCategories = await deleteCategory(
                    categoryId,
                    replacementCategoryId,
                  );
                  reconcileCategoryReference(
                    categoryId,
                    replacement
                      ? { id: replacement.id, name: replacement.name }
                      : null,
                  );
                  storeCategories(remainingCategories);
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {!isSearchOpen ? (
        <UndoStack
          items={undoItems}
          onExpire={expireUndo}
          onUndo={(selectedItem) => void handleUndo(selectedItem)}
        />
      ) : null}

      {!isManageCategories ? (
        <AddTaskButton
          accessibleName="Add task"
          className="add-task-button"
          onClick={() => openEditor({ mode: "create" })}
        />
      ) : null}

      {isSearchOpen ? (
        <TaskSearchDialog
          loadState={searchLoadState}
          tasks={searchTasks ?? []}
          query={searchQuery}
          completionError={completionError}
          completingTaskIds={completingTaskIds}
          completionDisabledTaskIds={completionDisabledTaskIds}
          undoItems={undoItems}
          onQueryChange={setSearchQuery}
          onRetry={() => {
            setSearchTasks(null);
            setSearchLoadState("idle");
            setSearchLoadAttempt((attempt) => attempt + 1);
          }}
          onClose={closeSearch}
          onComplete={(task, shouldFocusUndo) =>
            void handleComplete(task, shouldFocusUndo)
          }
          onSelect={selectSearchResult}
          onExpireUndo={expireUndo}
          onUndo={(item) => void handleUndo(item)}
        />
      ) : null}

      {editor ? (
        <TaskEditor
          key={editor.mode === "edit" ? `edit-${editor.task.id}` : "create"}
          editor={editor}
          dependencies={editorDependencies}
          dependencyState={dependencyState}
          onRetryDependencies={() => void loadDependencies()}
          onClose={closeEditor}
          onSaved={(task, action, keepOpen = false) => {
            reconcileTask(task);
            setAnnouncement(
              `${action === "created" ? "Created" : "Updated"} ${task.name}.${keepOpen ? " Ready for another task." : ""}`,
            );
            if (!keepOpen) closeEditor();
          }}
          onArchived={(task) => {
            setReadyTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setSleepingTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setCategoryTasks((current) =>
              current.filter((item) => item.id !== task.id),
            );
            setSearchTasks(
              (current) =>
                current?.filter((item) => item.id !== task.id) ?? null,
            );
            setAnnouncement(`Archived ${task.name}.`);
            closeEditor();
          }}
        />
      ) : null}
    </div>
  );
}

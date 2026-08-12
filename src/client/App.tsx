import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import type { CategoryResponse, TaskResponse } from "../shared/api";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  renameCategory,
  reorderCategories,
} from "./api/categories";
import { BACKEND_STATUS_EVENT, type BackendStatus } from "./api/client";
import {
  fetchArchivedData,
  fetchBrowseData,
  fetchEditorDependencies,
  fetchReadyData,
} from "./api/loaders";
import { fetchAllActiveTasks } from "./api/tasks";
import { AppNavigation } from "./components/AppNavigation";
import { AddTaskButton } from "./components/TaskList";
import { UndoStack } from "./features/completion/UndoStack";
import { useCompletionWorkflow } from "./features/completion/useCompletionWorkflow";
import { ArchivedTaskDetails } from "./features/archive/ArchivedTaskDetails";
import { TaskEditor, type EditorState } from "./features/editor/TaskEditor";
import { TaskSearchDialog } from "./features/search/TaskSearchDialog";
import { useTaskCollections } from "./features/tasks/useTaskCollections";
import { BrowsePage } from "./pages/BrowsePage";
import { ArchivedTasksPage } from "./pages/ArchivedTasksPage";
import { ManageCategories } from "./pages/ManageCategoriesPage";
import { ReadyPage } from "./pages/ReadyPage";
import { PwaStatus } from "./PwaStatus";

type LoadState = "loading" | "ready" | "error";
type DependencyState = "idle" | LoadState;
const SLEEPING_EXPANDED_KEY = "timesince.sleeping-expanded.v1";

function readSleepingExpanded() {
  try {
    return window.localStorage.getItem(SLEEPING_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

export function App() {
  const location = useLocation();
  const isBrowseRoute = location.pathname === "/categories";
  const isManageCategories = location.pathname === "/categories/manage";
  const isArchivedTasks = location.pathname === "/categories/archived";
  const [readyLoadState, setReadyLoadState] = useState<LoadState>("loading");
  const [readyLoadAttempt, setReadyLoadAttempt] = useState(0);
  const {
    readyTasks,
    sleepingTasks,
    browseTasks,
    searchTasks,
    archivedTasks,
    loadReady,
    loadBrowse,
    loadSearch,
    loadArchived,
    clearSearch,
    reconcileTask,
    removeTask,
    replaceCategoryReference,
  } = useTaskCollections();
  const [sleepingExpanded, setSleepingExpanded] =
    useState(readSleepingExpanded);
  const [browseLoadState, setBrowseLoadState] =
    useState<DependencyState>("idle");
  const [browseLoadAttempt, setBrowseLoadAttempt] = useState(0);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [appTimeZone, setAppTimeZone] = useState<string | null>(null);
  const [managementLoadState, setManagementLoadState] =
    useState<LoadState>("loading");
  const [managementLoadAttempt, setManagementLoadAttempt] = useState(0);
  const [archivedLoadState, setArchivedLoadState] =
    useState<DependencyState>("idle");
  const [archivedLoadAttempt, setArchivedLoadAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  const reconcileActiveTask = useCallback(
    (task: TaskResponse) => {
      reconcileTask(task);
      setEditor((current) =>
        current?.mode === "edit" && current.task.id === task.id
          ? { mode: "edit", task }
          : current,
      );
    },
    [reconcileTask],
  );

  const {
    completingTaskIds,
    completionDisabledTaskIds,
    completionError,
    undoItems,
    clearCompletionError,
    handleComplete,
    handleCompleteEarlier,
    expireUndo,
    handleUndo,
  } = useCompletionWorkflow({
    reconcileTask: reconcileActiveTask,
    announce: setAnnouncement,
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoadState, setSearchLoadState] =
    useState<DependencyState>("idle");
  const [searchLoadAttempt, setSearchLoadAttempt] = useState(0);
  const [archivedDetails, setArchivedDetails] = useState<TaskResponse | null>(
    null,
  );
  const [dependencyState, setDependencyState] =
    useState<DependencyState>("idle");
  const [appearsOffline, setAppearsOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const editorDependencies = appTimeZone
    ? { categories, timeZone: appTimeZone }
    : null;

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
      if (readyLoadState === "error") {
        setReadyLoadAttempt((attempt) => attempt + 1);
      }
      if (isBrowseRoute && browseLoadState === "error") {
        setBrowseLoadAttempt((attempt) => attempt + 1);
      }
      if (isManageCategories && managementLoadState === "error") {
        setManagementLoadState("loading");
        setManagementLoadAttempt((attempt) => attempt + 1);
      }
      if (isArchivedTasks && archivedLoadState === "error") {
        setArchivedLoadAttempt((attempt) => attempt + 1);
      }
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [
    browseLoadState,
    isBrowseRoute,
    isManageCategories,
    isArchivedTasks,
    readyLoadState,
    managementLoadState,
    archivedLoadState,
  ]);

  useEffect(() => {
    const abortController = new AbortController();
    async function loadTasks() {
      setReadyLoadState("loading");
      clearCompletionError();
      try {
        const readyData = await fetchReadyData(abortController.signal);
        loadReady(readyData.ready, readyData.sleeping);
        setReadyLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setReadyLoadState("error");
      }
    }
    void loadTasks();
    return () => abortController.abort();
  }, [clearCompletionError, loadReady, readyLoadAttempt]);

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
      clearCompletionError();
      setSearchLoadState((current) => (current === "error" ? "idle" : current));
      setIsSearchOpen(true);
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [clearCompletionError]);

  useEffect(() => {
    if (!isSearchOpen || searchTasks !== null) return;

    const abortController = new AbortController();
    fetchAllActiveTasks(abortController.signal)
      .then((tasks) => {
        loadSearch(tasks);
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
  }, [isSearchOpen, loadSearch, searchLoadAttempt, searchTasks]);

  useEffect(() => {
    if (!isBrowseRoute) return;

    const abortController = new AbortController();
    async function loadBrowseData() {
      setBrowseLoadState("loading");
      clearCompletionError();
      try {
        const browseData = await fetchBrowseData(abortController.signal);
        loadBrowse(browseData.tasks);
        setCategories(browseData.categories);
        setAppTimeZone(browseData.timeZone);
        setDependencyState("ready");
        setBrowseLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setBrowseLoadState("error");
      }
    }
    void loadBrowseData();
    return () => abortController.abort();
  }, [browseLoadAttempt, clearCompletionError, isBrowseRoute, loadBrowse]);

  useEffect(() => {
    if (!isManageCategories) return;
    const abortController = new AbortController();
    fetchCategories(abortController.signal)
      .then((categories) => {
        setCategories(categories);
        setManagementLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setManagementLoadState("error");
        }
      });
    return () => abortController.abort();
  }, [isManageCategories, managementLoadAttempt]);

  useEffect(() => {
    if (!isArchivedTasks) return;
    const abortController = new AbortController();
    async function loadArchivedTasks() {
      setArchivedLoadState("loading");
      try {
        const data = await fetchArchivedData(abortController.signal);
        loadArchived(data.tasks);
        setAppTimeZone(data.timeZone);
        setArchivedLoadState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setArchivedLoadState("error");
        }
      }
    }
    void loadArchivedTasks();
    return () => abortController.abort();
  }, [archivedLoadAttempt, isArchivedTasks, loadArchived]);

  async function loadDependencies() {
    setDependencyState("loading");
    try {
      const dependencies = await fetchEditorDependencies();
      setCategories(dependencies.categories);
      setAppTimeZone(dependencies.timeZone);
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

  function openArchivedDetails(task: TaskResponse) {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setArchivedDetails(task);
  }

  function closeArchivedDetails() {
    setArchivedDetails(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  function openSearch(trigger: HTMLElement | null) {
    if (document.querySelector("dialog[open]")) return;
    searchReturnFocusRef.current = trigger;
    clearCompletionError();
    setSearchLoadState((current) => (current === "error" ? "idle" : current));
    setIsSearchOpen(true);
  }

  function closeSearch() {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    clearCompletionError();
    window.setTimeout(() => returnFocus?.focus(), 0);
  }

  function selectSearchResult(task: TaskResponse) {
    const returnFocus = searchReturnFocusRef.current;
    setIsSearchOpen(false);
    setSearchQuery("");
    clearCompletionError();
    openEditor({ mode: "edit", task }, returnFocus);
  }

  function storeCategories(nextCategories: CategoryResponse[]) {
    setCategories(nextCategories);
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
                loadState={readyLoadState}
                readyTasks={readyTasks}
                sleepingTasks={sleepingTasks}
                sleepingExpanded={sleepingExpanded}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setReadyLoadAttempt((attempt) => attempt + 1)}
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
                loadState={browseLoadState}
                tasks={browseTasks}
                categories={categories}
                timeZone={appTimeZone}
                completionError={completionError}
                completingTaskIds={completingTaskIds}
                completionDisabledTaskIds={completionDisabledTaskIds}
                onRetry={() => setBrowseLoadAttempt((attempt) => attempt + 1)}
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
                categories={categories}
                onRetry={() => {
                  setManagementLoadState("loading");
                  setManagementLoadAttempt((attempt) => attempt + 1);
                }}
                onCreate={async (name) => {
                  const created = await createCategory({ name });
                  storeCategories(
                    [...categories, created].sort(
                      (first, second) =>
                        first.position - second.position ||
                        first.id - second.id,
                    ),
                  );
                }}
                onRename={async (categoryId, name) => {
                  const renamed = await renameCategory(categoryId, { name });
                  replaceCategoryReference(categoryId, {
                    id: renamed.id,
                    name: renamed.name,
                  });
                  storeCategories(
                    categories.map((category) =>
                      category.id === categoryId ? renamed : category,
                    ),
                  );
                }}
                onReorder={async (categoryIds) => {
                  storeCategories(await reorderCategories({ categoryIds }));
                }}
                onDelete={async (categoryId, replacementCategoryId) => {
                  const replacement =
                    categories.find(({ id }) => id === replacementCategoryId) ??
                    null;
                  const remainingCategories = await deleteCategory(
                    categoryId,
                    replacementCategoryId,
                  );
                  replaceCategoryReference(
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
          <Route
            path="/categories/archived"
            element={
              <ArchivedTasksPage
                loadState={archivedLoadState}
                tasks={archivedTasks}
                timeZone={appTimeZone}
                onRetry={() => setArchivedLoadAttempt((attempt) => attempt + 1)}
                onSelect={openArchivedDetails}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {!isSearchOpen && !editor ? (
        <UndoStack
          items={undoItems}
          onExpire={expireUndo}
          onUndo={(selectedItem) => void handleUndo(selectedItem)}
        />
      ) : null}

      {!isManageCategories && !isArchivedTasks ? (
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
            clearSearch();
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
            removeTask(task.id);
            setAnnouncement(`Archived ${task.name}.`);
            closeEditor();
          }}
          historicalCompletionDisabled={completionDisabledTaskIds.has(
            editor.mode === "edit" ? editor.task.id : -1,
          )}
          undoItems={undoItems}
          onCompletedEarlier={(task, completedAt, formattedDate, shouldFocus) =>
            handleCompleteEarlier(task, completedAt, formattedDate, shouldFocus)
          }
          onExpireUndo={expireUndo}
          onUndo={(item) => void handleUndo(item)}
        />
      ) : null}

      {archivedDetails && appTimeZone ? (
        <ArchivedTaskDetails
          key={`archived-${archivedDetails.id}`}
          task={archivedDetails}
          timeZone={appTimeZone}
          onClose={closeArchivedDetails}
          onRestored={(task) => {
            reconcileTask(task);
            setAnnouncement(`Restored ${task.name}.`);
            closeArchivedDetails();
          }}
        />
      ) : null}
    </div>
  );
}

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { NavLink } from "react-router";

import type { CategoryResponse, TaskResponse } from "../../shared/api";
import { AddTaskButton, TaskRow } from "../components/TaskList";

const COLLAPSED_CATEGORIES_KEY = "timesince.collapsed-categories.v1";
const CATEGORY_GRID_ROW_PX = 8;
const CATEGORY_GRID_GAP_PX = 24;

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

function compareCategoryTasks(first: TaskResponse, second: TaskResponse) {
  const firstBucket = first.isSnoozed ? 2 : first.state === "ready" ? 0 : 1;
  const secondBucket = second.isSnoozed ? 2 : second.state === "ready" ? 0 : 1;
  if (firstBucket !== secondBucket) return firstBucket - secondBucket;

  if (first.state !== second.state) return first.state === "ready" ? -1 : 1;
  return first.state === "ready"
    ? compareReady(first, second)
    : compareSleeping(first, second);
}

interface CategoryGroup {
  key: string;
  name: string;
  tasks: TaskResponse[];
  readyCount: number;
}

function readCollapsedCategories() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(COLLAPSED_CATEGORIES_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

interface CategorySectionProps {
  group: CategoryGroup;
  collapsed: boolean;
  onToggle: (key: string) => void;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
  timeZone: string;
}

function CategorySection({
  group,
  collapsed,
  onToggle,
  completingTaskIds,
  completionDisabledTaskIds,
  onComplete,
  onEdit,
  timeZone,
}: CategorySectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingId = `category-${group.key}-heading`;
  const listId = `category-${group.key}-tasks`;
  const totalLabel = `${group.tasks.length} ${group.tasks.length === 1 ? "task" : "tasks"}`;
  const readyLabel = `${group.readyCount} ready`;
  const firstSleepingIndex = group.tasks.findIndex(
    (task) => !task.isSnoozed && task.state === "sleeping",
  );
  const showLaterDivider = group.readyCount > 0 && firstSleepingIndex >= 0;

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const updateGridSpan = () => {
      const height = section.getBoundingClientRect().height;
      const span = Math.max(
        1,
        Math.ceil((height + CATEGORY_GRID_GAP_PX) / CATEGORY_GRID_ROW_PX),
      );
      section.style.setProperty("--category-grid-span", String(span));
    };

    updateGridSpan();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateGridSpan);
    observer.observe(section);
    return () => observer.disconnect();
  }, [collapsed, group.tasks.length]);

  return (
    <section
      ref={sectionRef}
      className="task-section category-section"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => onToggle(group.key)}
        >
          <span className="category-heading-name">{group.name}</span>
          <span
            className="category-summary"
            aria-label={`${readyLabel}, ${totalLabel}`}
          >
            {readyLabel} <span aria-hidden="true">·</span> {group.tasks.length}{" "}
            total
          </span>
          <span className="category-chevron" aria-hidden="true" />
        </button>
      </h2>
      {!collapsed ? (
        <ul id={listId} className="task-list">
          {group.tasks.map((task, index) => (
            <Fragment key={task.id}>
              {showLaterDivider && index === firstSleepingIndex ? (
                <li className="browse-divider">
                  <span>Later</span>
                </li>
              ) : null}
              <TaskRow
                task={task}
                isCompleting={completingTaskIds.has(task.id)}
                isCompletionDisabled={completionDisabledTaskIds.has(task.id)}
                onComplete={onComplete}
                onEdit={onEdit}
                showCategory={false}
                timeZone={timeZone}
              />
            </Fragment>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

interface BrowsePageProps {
  loadState: "idle" | "loading" | "ready" | "error";
  tasks: TaskResponse[];
  categories: CategoryResponse[];
  timeZone: string | null;
  completionError: string | null;
  completingTaskIds: ReadonlySet<number>;
  completionDisabledTaskIds: ReadonlySet<number>;
  onRetry: () => void;
  onComplete: (task: TaskResponse, shouldFocusUndo: boolean) => void;
  onEdit: (task: TaskResponse) => void;
  onCreate: () => void;
}

export function BrowsePage({
  loadState,
  tasks,
  categories,
  timeZone,
  completionError,
  completingTaskIds,
  completionDisabledTaskIds,
  onRetry,
  onComplete,
  onEdit,
  onCreate,
}: BrowsePageProps) {
  const [collapsedCategories, setCollapsedCategories] = useState(
    readCollapsedCategories,
  );
  const tasksByCategory = new Map<number, TaskResponse[]>();
  const uncategorizedTasks: TaskResponse[] = [];
  const categoryIds = new Set(categories.map((category) => category.id));

  for (const task of tasks) {
    const categoryId = task.category?.id;
    if (categoryId === undefined || !categoryIds.has(categoryId)) {
      uncategorizedTasks.push(task);
      continue;
    }
    const groupedTasks = tasksByCategory.get(categoryId) ?? [];
    groupedTasks.push(task);
    tasksByCategory.set(categoryId, groupedTasks);
  }

  const groups: CategoryGroup[] = categories.flatMap((category) => {
    const groupedTasks = tasksByCategory.get(category.id);
    return groupedTasks && groupedTasks.length > 0
      ? [
          {
            key: String(category.id),
            name: category.name,
            tasks: groupedTasks.sort(compareCategoryTasks),
            readyCount: groupedTasks.filter((task) => task.visibleInReady)
              .length,
          },
        ]
      : [];
  });
  if (uncategorizedTasks.length > 0) {
    groups.push({
      key: "uncategorized",
      name: "Uncategorized",
      tasks: uncategorizedTasks.sort(compareCategoryTasks),
      readyCount: uncategorizedTasks.filter((task) => task.visibleInReady)
        .length,
    });
  }

  function toggleCategory(key: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(
          COLLAPSED_CATEGORIES_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        // The in-memory state still works when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <main className="task-page" aria-labelledby="browse-view-title">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Every active task, grouped by category</p>
          <h1 id="browse-view-title">Browse</h1>
        </div>
        <div className="page-actions">
          <NavLink className="page-action" to="/categories/manage">
            Manage
          </NavLink>
          <AddTaskButton
            accessibleName="New task"
            className="desktop-add-task-button"
            onClick={onCreate}
          />
        </div>
      </div>

      {loadState === "idle" || loadState === "loading" ? (
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
          {groups.length === 0 ? (
            <p className="all-tasks-empty">
              No active tasks yet. Add one to start a category.
            </p>
          ) : null}
          {completionError ? (
            <p className="completion-error" role="alert">
              {completionError}
            </p>
          ) : null}
          {timeZone ? (
            <div className="category-groups">
              {groups.map((group) => (
                <CategorySection
                  key={group.key}
                  group={group}
                  collapsed={collapsedCategories.has(group.key)}
                  onToggle={toggleCategory}
                  completingTaskIds={completingTaskIds}
                  completionDisabledTaskIds={completionDisabledTaskIds}
                  onComplete={onComplete}
                  onEdit={onEdit}
                  timeZone={timeZone}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

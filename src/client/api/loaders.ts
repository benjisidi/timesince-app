import { fetchCategories } from "./categories";
import { fetchAppConfig } from "./config";
import {
  fetchAllActiveTasks,
  fetchArchivedTasks,
  fetchTaskList,
} from "./tasks";

export async function fetchReadyData(signal: AbortSignal) {
  const [ready, sleeping] = await Promise.all([
    fetchTaskList("/api/tasks?state=ready&visibleInReady=true", signal),
    fetchTaskList("/api/tasks?state=sleeping", signal),
  ]);

  return { ready, sleeping };
}

export async function fetchBrowseData(signal: AbortSignal) {
  const [tasks, categories, config] = await Promise.all([
    fetchAllActiveTasks(signal),
    fetchCategories(signal),
    fetchAppConfig(signal),
  ]);

  return { tasks, categories, timeZone: config.timeZone };
}

export async function fetchArchivedData(signal: AbortSignal) {
  const [tasks, config] = await Promise.all([
    fetchArchivedTasks(signal),
    fetchAppConfig(signal),
  ]);

  return { tasks, timeZone: config.timeZone };
}

export async function fetchEditorDependencies(signal?: AbortSignal) {
  const [categories, config] = await Promise.all([
    fetchCategories(signal),
    fetchAppConfig(signal),
  ]);
  return { categories, timeZone: config.timeZone };
}

import { fuzzy } from "fast-fuzzy";

import type { TaskResponse } from "../../../shared/api";

const SEARCH_MATCH_THRESHOLD = 0.6;

export function rankSearchResults(tasks: TaskResponse[], query: string) {
  const term = query.trim();
  if (!term) return [];

  return tasks
    .map((task) => {
      const nameScore = fuzzy(term, task.name);
      const categoryScore = fuzzy(term, task.category?.name ?? "Uncategorized");
      return {
        task,
        score: nameScore * 2 + categoryScore,
        isRelevant:
          Math.max(nameScore, categoryScore) >= SEARCH_MATCH_THRESHOLD,
      };
    })
    .filter(({ isRelevant }) => isRelevant)
    .sort((first, second) => second.score - first.score)
    .map(({ task }) => task);
}

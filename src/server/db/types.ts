import type { Generated } from "kysely";

export interface CategoryTable {
  id: Generated<number>;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TaskTable {
  id: Generated<number>;
  name: string;
  category_id: number | null;
  target_interval_days: number;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CompletionTable {
  id: Generated<number>;
  task_id: number;
  completed_at: string;
  created_at: string;
}

export interface TimeSinceDatabase {
  categories: CategoryTable;
  tasks: TaskTable;
  completions: CompletionTable;
}

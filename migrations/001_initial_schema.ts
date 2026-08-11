import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const initialSchema: Migration = {
  async up(database: Kysely<unknown>) {
    await database.schema
      .createTable("categories")
      .addColumn("id", "integer", (column) =>
        column.primaryKey().autoIncrement(),
      )
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("position", "integer", (column) => column.notNull())
      .addColumn("created_at", "text", (column) => column.notNull())
      .addColumn("updated_at", "text", (column) => column.notNull())
      .addCheckConstraint(
        "categories_name_nonblank",
        sql`length(trim(name)) > 0`,
      )
      .addCheckConstraint("categories_position_nonnegative", sql`position >= 0`)
      .execute();

    await sql`
      create unique index categories_name_nocase_unique
      on categories (name collate nocase)
    `.execute(database);

    await database.schema
      .createTable("tasks")
      .addColumn("id", "integer", (column) =>
        column.primaryKey().autoIncrement(),
      )
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("category_id", "integer")
      .addColumn("target_interval_days", "integer", (column) =>
        column.notNull(),
      )
      .addColumn("snoozed_until", "text")
      .addColumn("created_at", "text", (column) => column.notNull())
      .addColumn("updated_at", "text", (column) => column.notNull())
      .addColumn("archived_at", "text")
      .addForeignKeyConstraint(
        "tasks_category_id_foreign",
        ["category_id"],
        "categories",
        ["id"],
        (constraint) => constraint.onDelete("set null"),
      )
      .addCheckConstraint(
        "tasks_target_interval_positive",
        sql`target_interval_days >= 1`,
      )
      .execute();

    await database.schema
      .createIndex("tasks_category_id_index")
      .on("tasks")
      .column("category_id")
      .execute();

    await database.schema
      .createTable("completions")
      .addColumn("id", "integer", (column) =>
        column.primaryKey().autoIncrement(),
      )
      .addColumn("task_id", "integer", (column) => column.notNull())
      .addColumn("completed_at", "text", (column) => column.notNull())
      .addColumn("created_at", "text", (column) => column.notNull())
      .addForeignKeyConstraint(
        "completions_task_id_foreign",
        ["task_id"],
        "tasks",
        ["id"],
        (constraint) => constraint.onDelete("restrict"),
      )
      .execute();

    await sql`
      create index completions_task_completed_at_index
      on completions (task_id, completed_at desc)
    `.execute(database);
  },

  async down(database: Kysely<unknown>) {
    await database.schema.dropTable("completions").execute();
    await database.schema.dropTable("tasks").execute();
    await database.schema.dropTable("categories").execute();
  },
};

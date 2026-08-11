import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/server/app";
import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";
import { createCategoryRepository } from "../src/server/db/repositories/categories";

const TIME_ZONE = "Europe/London";
const databases = new Set<ReturnType<typeof openDatabase>>();

async function setup(initialNow = "2026-08-11T12:00:00.000Z") {
  const database = openDatabase({ path: ":memory:" });
  databases.add(database);
  const migration = await createMigrator(database).migrateToLatest();
  if (migration.error) {
    throw migration.error;
  }

  let now = new Date(initialNow);
  const clock = () => now;
  return {
    api: request(createApp({ database, timeZone: TIME_ZONE, clock })),
    categories: createCategoryRepository(database, clock),
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
});

describe("task API", () => {
  it("creates and retrieves a categorized task with an atomic initial completion", async () => {
    const { api, categories } = await setup();
    const category = await categories.create({ name: "Bedroom", position: 0 });

    const created = await api.post("/api/tasks").send({
      name: "  Change bedsheets  ",
      categoryId: category.id,
      targetIntervalDays: 14,
      initialCompletedAt: "2026-08-01",
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Change bedsheets",
      category: { id: category.id, name: "Bedroom" },
      targetIntervalDays: 14,
      lastCompletedAt: "2026-07-31T23:00:00.000Z",
      elapsedDays: 10,
      overageDays: 0,
      state: "sleeping",
      isSnoozed: false,
      visibleInReady: false,
    });
    expect(created.body).not.toHaveProperty("dueAt");
    expect(created.body).not.toHaveProperty("overdue");

    const fetched = await api.get(`/api/tasks/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);

    const history = await api.get(`/api/tasks/${created.body.id}/completions`);
    expect(history.status).toBe(200);
    expect(history.body.completions).toHaveLength(1);
    expect(history.body.completions[0]).toMatchObject({
      taskId: created.body.id,
      completedAt: "2026-07-31T23:00:00.000Z",
    });
  });

  it("lists ordered task-editor metadata and the configured timezone", async () => {
    const { api, categories } = await setup();
    const later = await categories.create({ name: "Garden", position: 2 });
    const earlier = await categories.create({ name: "Admin", position: 1 });

    const categoryResponse = await api.get("/api/categories");
    expect(categoryResponse.status).toBe(200);
    expect(categoryResponse.body.categories).toEqual([
      { id: earlier.id, name: "Admin", position: 1 },
      { id: later.id, name: "Garden", position: 2 },
    ]);

    const configResponse = await api.get("/api/config");
    expect(configResponse.status).toBe(200);
    expect(configResponse.body).toEqual({ timeZone: TIME_ZONE });
  });

  it("filters semantic state separately from Ready-list visibility and orders each state", async () => {
    const { api, categories, setNow } = await setup();
    const category = await categories.create({ name: "Kitchen", position: 0 });

    const never = await api.post("/api/tasks").send({
      name: "Never done",
      categoryId: category.id,
      targetIntervalDays: 7,
    });
    const longest = await api.post("/api/tasks").send({
      name: "Longest ready",
      categoryId: category.id,
      targetIntervalDays: 14,
      initialCompletedAt: "2026-06-01T08:00:00.000Z",
    });
    const snoozed = await api.post("/api/tasks").send({
      name: "Snoozed ready",
      targetIntervalDays: 14,
      initialCompletedAt: "2026-07-01T08:00:00.000Z",
    });
    const sleepingOldest = await api.post("/api/tasks").send({
      name: "Sleeping oldest",
      targetIntervalDays: 30,
      initialCompletedAt: "2026-07-30T08:00:00.000Z",
    });
    const sleepingNewest = await api.post("/api/tasks").send({
      name: "Sleeping newest",
      targetIntervalDays: 7,
      initialCompletedAt: "2026-08-09T08:00:00.000Z",
    });
    await api.patch(`/api/tasks/${snoozed.body.id}`).send({
      snoozedUntil: "2026-08-12T12:00:00.000Z",
    });

    const ready = await api.get("/api/tasks?state=ready");
    expect(ready.status).toBe(200);
    expect(ready.body.tasks.map(({ id }: { id: number }) => id)).toEqual([
      never.body.id,
      longest.body.id,
      snoozed.body.id,
    ]);
    expect(
      ready.body.tasks.find(({ id }: { id: number }) => id === snoozed.body.id),
    ).toMatchObject({ state: "ready", visibleInReady: false });

    const visible = await api.get("/api/tasks?state=ready&visibleInReady=true");
    expect(visible.body.tasks.map(({ id }: { id: number }) => id)).toEqual([
      never.body.id,
      longest.body.id,
    ]);

    const sleeping = await api.get("/api/tasks?state=sleeping");
    expect(sleeping.body.tasks.map(({ id }: { id: number }) => id)).toEqual([
      sleepingOldest.body.id,
      sleepingNewest.body.id,
    ]);

    const categorized = await api.get(
      `/api/tasks?categoryId=${category.id}&state=all`,
    );
    expect(categorized.body.tasks.map(({ id }: { id: number }) => id)).toEqual([
      never.body.id,
      longest.body.id,
    ]);

    setNow("2026-08-12T12:00:00.000Z");
    const afterSnoozeExpiry = await api.get(
      "/api/tasks?state=ready&visibleInReady=true",
    );
    expect(
      afterSnoozeExpiry.body.tasks.find(
        ({ id }: { id: number }) => id === snoozed.body.id,
      ),
    ).toMatchObject({
      state: "ready",
      snoozedUntil: "2026-08-12T12:00:00.000Z",
      isSnoozed: false,
      visibleInReady: true,
    });
  });

  it("edits, snoozes, archives, reads, and restores while preserving history", async () => {
    const { api, setNow } = await setup();
    const created = await api.post("/api/tasks").send({
      name: "Clean oven",
      targetIntervalDays: 30,
    });
    const completion = await api
      .post(`/api/tasks/${created.body.id}/completions`)
      .send({ completedAt: "2026-07-01T08:00:00.000Z" });
    const edited = await api.patch(`/api/tasks/${created.body.id}`).send({
      name: "Deep-clean oven",
      targetIntervalDays: 45,
      snoozedUntil: "2026-08-20",
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      name: "Deep-clean oven",
      targetIntervalDays: 45,
      snoozedUntil: "2026-08-19T23:00:00.000Z",
      lastCompletedAt: "2026-07-01T08:00:00.000Z",
    });

    setNow("2026-08-11T13:00:00.000Z");
    expect((await api.delete(`/api/tasks/${created.body.id}`)).status).toBe(
      204,
    );
    expect((await api.delete(`/api/tasks/${created.body.id}`)).status).toBe(
      409,
    );
    expect((await api.get("/api/tasks")).body.tasks).toEqual([]);

    const archived = await api.get(`/api/tasks/${created.body.id}`);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({
      name: "Deep-clean oven",
      visibleInReady: false,
      archivedAt: "2026-08-11T13:00:00.000Z",
    });
    expect(
      (await api.get("/api/tasks?includeArchived=true")).body.tasks,
    ).toHaveLength(1);
    expect(
      (await api.get(`/api/tasks/${created.body.id}/completions`)).body
        .completions,
    ).toHaveLength(1);

    expect(
      (await api.patch(`/api/tasks/${created.body.id}`).send({ name: "No" }))
        .status,
    ).toBe(409);
    expect(
      (await api.post(`/api/tasks/${created.body.id}/completions`).send({}))
        .status,
    ).toBe(409);
    expect(
      (await api.delete(`/api/completions/${completion.body.completion.id}`))
        .status,
    ).toBe(409);

    setNow("2026-08-11T14:00:00.000Z");
    const restored = await api.post(`/api/tasks/${created.body.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      name: "Deep-clean oven",
      targetIntervalDays: 45,
      snoozedUntil: "2026-08-19T23:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-08-11T14:00:00.000Z",
      lastCompletedAt: "2026-07-01T08:00:00.000Z",
    });
    expect((await api.get("/api/tasks")).body.tasks).toHaveLength(1);
    expect(
      (await api.post(`/api/tasks/${created.body.id}/restore`)).status,
    ).toBe(409);
  });

  it("creates past/current completions and deletes only the exact requested event", async () => {
    const { api } = await setup();
    const task = await api.post("/api/tasks").send({
      name: "Descale kettle",
      targetIntervalDays: 14,
    });
    const oldCompletion = await api
      .post(`/api/tasks/${task.body.id}/completions`)
      .send({ completedAt: "2026-07-01T08:00:00.000Z" });
    const currentCompletion = await api
      .post(`/api/tasks/${task.body.id}/completions`)
      .send({});

    expect(currentCompletion.status).toBe(201);
    expect(currentCompletion.body).toMatchObject({
      completion: { completedAt: "2026-08-11T12:00:00.000Z" },
      task: { state: "sleeping", elapsedDays: 0 },
    });

    const deleteOld = await api.delete(
      `/api/completions/${oldCompletion.body.completion.id}`,
    );
    expect(deleteOld.status).toBe(200);
    expect(deleteOld.body).toMatchObject({
      completion: { id: oldCompletion.body.completion.id },
      task: {
        lastCompletedAt: "2026-08-11T12:00:00.000Z",
        state: "sleeping",
      },
    });

    const replacementOld = await api
      .post(`/api/tasks/${task.body.id}/completions`)
      .send({ completedAt: "2026-07-15T08:00:00.000Z" });
    const undoCurrent = await api.delete(
      `/api/completions/${currentCompletion.body.completion.id}`,
    );
    expect(undoCurrent.body.task).toMatchObject({
      lastCompletedAt: replacementOld.body.completion.completedAt,
      state: "ready",
      elapsedDays: 27,
      overageDays: 13,
    });

    const history = await api.get(`/api/tasks/${task.body.id}/completions`);
    expect(
      history.body.completions.map(({ id }: { id: number }) => id),
    ).toEqual([replacementOld.body.completion.id]);
    expect(
      (
        await api.delete(
          `/api/completions/${currentCompletion.body.completion.id}`,
        )
      ).status,
    ).toBe(404);
  });

  it("validates write payloads, references, IDs, queries, and timestamps", async () => {
    const { api } = await setup();

    const invalidBodies = [
      { name: " ", targetIntervalDays: 1 },
      { name: "Task", targetIntervalDays: 0 },
      { name: "Task", targetIntervalDays: 1.5 },
      { name: "Task", targetIntervalDays: 1, categoryId: 999 },
      { name: "Task", targetIntervalDays: 1, unexpected: true },
      {
        name: "Task",
        targetIntervalDays: 1,
        initialCompletedAt: "2026-08-12T12:00:00.000Z",
      },
      {
        name: "Task",
        targetIntervalDays: 1,
        initialCompletedAt: "2026-02-30",
      },
    ];
    for (const body of invalidBodies) {
      const response = await api.post("/api/tasks").send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: expect.any(String) });
    }

    const task = await api.post("/api/tasks").send({
      name: "Valid task",
      targetIntervalDays: 1,
    });
    expect(
      (
        await api.patch(`/api/tasks/${task.body.id}`).send({
          snoozedUntil: "2026-08-11T12:00:00.000Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.post(`/api/tasks/${task.body.id}/completions`).send({
          completedAt: "2026-08-12T12:00:00.000Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.patch(`/api/tasks/${task.body.id}`).send({})).status,
    ).toBe(400);
    expect((await api.get("/api/tasks?state=overdue")).status).toBe(400);
    expect((await api.get("/api/tasks?includeArchived=yes")).status).toBe(400);
    expect((await api.get("/api/tasks/not-an-id")).status).toBe(400);
    expect((await api.get("/api/tasks/999")).status).toBe(404);

    const malformedJson = await api
      .post("/api/tasks")
      .set("Content-Type", "application/json")
      .send('{"name":');
    expect(malformedJson.status).toBe(400);
    expect(malformedJson.body.error.code).toBe("INVALID_JSON");
  });

  it("unsnoozes with null without changing elapsed or completion state", async () => {
    const { api } = await setup();
    const task = await api.post("/api/tasks").send({
      name: "Water plants",
      targetIntervalDays: 7,
      initialCompletedAt: "2026-07-01T08:00:00.000Z",
    });
    const snoozed = await api.patch(`/api/tasks/${task.body.id}`).send({
      snoozedUntil: "2026-08-12T12:00:00.000Z",
    });
    const unsnoozed = await api.patch(`/api/tasks/${task.body.id}`).send({
      snoozedUntil: null,
    });

    expect(snoozed.body).toMatchObject({
      state: "ready",
      isSnoozed: true,
      visibleInReady: false,
    });
    expect(unsnoozed.body).toMatchObject({
      lastCompletedAt: snoozed.body.lastCompletedAt,
      elapsedDays: snoozed.body.elapsedDays,
      overageDays: snoozed.body.overageDays,
      state: "ready",
      snoozedUntil: null,
      isSnoozed: false,
      visibleInReady: true,
    });
  });
});

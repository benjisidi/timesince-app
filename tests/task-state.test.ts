import { describe, expect, it } from "vitest";

import {
  calculateElapsedDays,
  deriveTaskState,
  findLatestCompletionAt,
} from "../src/shared/task-state";

const TIME_ZONE = "Europe/London";
const NOW = new Date("2026-08-11T12:00:00.000Z");

function stateAtElapsedDays(elapsedDays: number) {
  return deriveTaskState({
    completionTimestamps: [
      new Date(NOW.getTime() - elapsedDays * 24 * 60 * 60 * 1_000),
    ],
    targetIntervalDays: 14,
    snoozedUntil: null,
    now: NOW,
    timeZone: TIME_ZONE,
  });
}

describe("latest completion", () => {
  it("finds the newest timestamp without relying on input order", () => {
    const latest = new Date("2026-08-10T08:00:00.000Z");

    expect(
      findLatestCompletionAt([
        new Date("2026-06-01T08:00:00.000Z"),
        latest,
        new Date("2026-07-15T08:00:00.000Z"),
      ]),
    ).toEqual(latest);
    expect(findLatestCompletionAt([])).toBeNull();
  });

  it("rejects invalid completion timestamps", () => {
    expect(() => findLatestCompletionAt([new Date("invalid")])).toThrow(
      "Completion timestamp must be a valid date",
    );
  });
});

describe("Ready and Sleeping state", () => {
  it.each([
    { elapsedDays: 13, expectedState: "sleeping", expectedOverage: 0 },
    { elapsedDays: 14, expectedState: "ready", expectedOverage: 0 },
    { elapsedDays: 17, expectedState: "ready", expectedOverage: 3 },
  ] as const)(
    "derives target 14 at $elapsedDays elapsed days as $expectedState",
    ({ elapsedDays, expectedState, expectedOverage }) => {
      expect(stateAtElapsedDays(elapsedDays)).toMatchObject({
        elapsedDays,
        overageDays: expectedOverage,
        state: expectedState,
        visibleInReady: expectedState === "ready",
      });
    },
  );

  it("is Sleeping immediately after completion", () => {
    expect(stateAtElapsedDays(0)).toMatchObject({
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
      visibleInReady: false,
    });
  });

  it("treats a never-completed task as Ready with inapplicable elapsed metadata", () => {
    expect(
      deriveTaskState({
        completionTimestamps: [],
        targetIntervalDays: 14,
        snoozedUntil: null,
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).toEqual({
      lastCompletedAt: null,
      elapsedDays: null,
      overageDays: null,
      state: "ready",
      isSnoozed: false,
      visibleInReady: true,
    });
  });

  it("uses a new completion to reset elapsed state", () => {
    const oldCompletion = new Date("2026-07-01T12:00:00.000Z");
    const newCompletion = new Date("2026-08-11T11:30:00.000Z");
    const before = deriveTaskState({
      completionTimestamps: [oldCompletion],
      targetIntervalDays: 14,
      snoozedUntil: null,
      now: NOW,
      timeZone: TIME_ZONE,
    });
    const after = deriveTaskState({
      completionTimestamps: [oldCompletion, newCompletion],
      targetIntervalDays: 14,
      snoozedUntil: null,
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(before.state).toBe("ready");
    expect(after).toMatchObject({
      lastCompletedAt: newCompletion,
      elapsedDays: 0,
      overageDays: 0,
      state: "sleeping",
    });
  });
});

describe("snooze visibility", () => {
  const readyCompletion = new Date("2026-07-01T12:00:00.000Z");

  it("keeps a snoozed task semantically Ready while suppressing it", () => {
    const result = deriveTaskState({
      completionTimestamps: [readyCompletion],
      targetIntervalDays: 14,
      snoozedUntil: new Date("2026-08-12T12:00:00.000Z"),
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(result).toMatchObject({
      lastCompletedAt: readyCompletion,
      state: "ready",
      isSnoozed: true,
      visibleInReady: false,
    });
  });

  it.each([
    ["past", new Date("2026-08-11T11:59:59.999Z")],
    ["exact expiry", new Date("2026-08-11T12:00:00.000Z")],
  ])("shows a Ready task when its snooze is in the %s", (_label, snooze) => {
    expect(
      deriveTaskState({
        completionTimestamps: [readyCompletion],
        targetIntervalDays: 14,
        snoozedUntil: snooze,
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).toMatchObject({
      state: "ready",
      isSnoozed: false,
      visibleInReady: true,
    });
  });

  it("does not let snooze alter completion or elapsed calculations", () => {
    const commonInput = {
      completionTimestamps: [readyCompletion],
      targetIntervalDays: 14,
      now: NOW,
      timeZone: TIME_ZONE,
    };
    const unsnoozed = deriveTaskState({
      ...commonInput,
      snoozedUntil: null,
    });
    const snoozed = deriveTaskState({
      ...commonInput,
      snoozedUntil: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(snoozed.lastCompletedAt).toEqual(unsnoozed.lastCompletedAt);
    expect(snoozed.elapsedDays).toBe(unsnoozed.elapsedDays);
    expect(snoozed.overageDays).toBe(unsnoozed.overageDays);
    expect(snoozed.state).toBe(unsnoozed.state);
  });

  it("can hide a never-completed Ready task", () => {
    expect(
      deriveTaskState({
        completionTimestamps: [],
        targetIntervalDays: 14,
        snoozedUntil: new Date("2026-08-12T12:00:00.000Z"),
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).toMatchObject({
      elapsedDays: null,
      state: "ready",
      isSnoozed: true,
      visibleInReady: false,
    });
  });
});

describe("local calendar-day calculation", () => {
  it("increments at local midnight", () => {
    expect(
      calculateElapsedDays(
        new Date("2026-08-11T22:59:00.000Z"),
        new Date("2026-08-11T23:01:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(1);
  });

  it("does not increment across UTC midnight within the same local date", () => {
    expect(
      calculateElapsedDays(
        new Date("2026-08-11T23:30:00.000Z"),
        new Date("2026-08-12T00:30:00.000Z"),
        TIME_ZONE,
      ),
    ).toBe(0);
  });

  it.each([
    [
      "spring-forward day",
      new Date("2026-03-28T12:00:00.000Z"),
      new Date("2026-03-29T11:00:00.000Z"),
    ],
    [
      "fall-back day",
      new Date("2026-10-24T11:00:00.000Z"),
      new Date("2026-10-25T12:00:00.000Z"),
    ],
  ])("counts the %s as one calendar day", (_label, completedAt, now) => {
    expect(calculateElapsedDays(completedAt, now, TIME_ZONE)).toBe(1);
  });

  it.each([
    ["month", "2026-07-31T12:00:00.000Z", "2026-08-01T12:00:00.000Z"],
    ["year", "2025-12-31T12:00:00.000Z", "2026-01-01T12:00:00.000Z"],
    ["leap day", "2028-02-28T12:00:00.000Z", "2028-03-01T12:00:00.000Z"],
  ])("handles a %s boundary", (_label, completedAt, now) => {
    expect(
      calculateElapsedDays(new Date(completedAt), new Date(now), TIME_ZONE),
    ).toBe(_label === "leap day" ? 2 : 1);
  });

  it("clamps a future completion to zero elapsed days", () => {
    expect(
      calculateElapsedDays(
        new Date("2026-08-12T12:00:00.000Z"),
        NOW,
        TIME_ZONE,
      ),
    ).toBe(0);

    expect(
      deriveTaskState({
        completionTimestamps: [new Date("2026-08-12T12:00:00.000Z")],
        targetIntervalDays: 1,
        snoozedUntil: null,
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).toMatchObject({ elapsedDays: 0, state: "sleeping" });
  });
});

describe("input validation", () => {
  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid target interval %s",
    (targetIntervalDays) => {
      expect(() =>
        deriveTaskState({
          completionTimestamps: [],
          targetIntervalDays,
          snoozedUntil: null,
          now: NOW,
          timeZone: TIME_ZONE,
        }),
      ).toThrow("Target interval must be a positive whole number");
    },
  );

  it("rejects invalid current and snooze timestamps", () => {
    expect(() =>
      deriveTaskState({
        completionTimestamps: [],
        targetIntervalDays: 1,
        snoozedUntil: null,
        now: new Date("invalid"),
        timeZone: TIME_ZONE,
      }),
    ).toThrow("Current timestamp must be a valid date");

    expect(() =>
      deriveTaskState({
        completionTimestamps: [],
        targetIntervalDays: 1,
        snoozedUntil: new Date("invalid"),
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    ).toThrow("Snooze timestamp must be a valid date");
  });

  it("requires a valid explicitly supplied IANA timezone", () => {
    expect(() =>
      deriveTaskState({
        completionTimestamps: [],
        targetIntervalDays: 1,
        snoozedUntil: null,
        now: NOW,
        timeZone: "Not/A_Time_Zone",
      }),
    ).toThrow(RangeError);
  });
});

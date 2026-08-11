const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export type TaskState = "ready" | "sleeping";

export interface DeriveTaskStateInput {
  completionTimestamps: readonly Date[];
  targetIntervalDays: number;
  snoozedUntil: Date | null;
  now: Date;
  timeZone: string;
}

export interface DerivedTaskState {
  lastCompletedAt: Date | null;
  elapsedDays: number | null;
  overageDays: number | null;
  state: TaskState;
  isSnoozed: boolean;
  visibleInReady: boolean;
}

function assertValidDate(value: Date, name: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid date`);
  }
}

function createCalendarDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function calendarDayNumber(
  timestamp: Date,
  formatter: Intl.DateTimeFormat,
): number {
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type === "year") {
      year = Number(part.value);
    } else if (part.type === "month") {
      month = Number(part.value);
    } else if (part.type === "day") {
      day = Number(part.value);
    }
  }

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError("Could not determine the local calendar date");
  }

  const utcDate = new Date(0);
  utcDate.setUTCHours(0, 0, 0, 0);
  utcDate.setUTCFullYear(year, month - 1, day);

  return Math.floor(utcDate.getTime() / MILLISECONDS_PER_DAY);
}

export function findLatestCompletionAt(
  completionTimestamps: readonly Date[],
): Date | null {
  let latestTimestamp: number | null = null;

  for (const completionTimestamp of completionTimestamps) {
    assertValidDate(completionTimestamp, "Completion timestamp");
    const timestamp = completionTimestamp.getTime();

    if (latestTimestamp === null || timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp === null ? null : new Date(latestTimestamp);
}

export function calculateElapsedDays(
  lastCompletedAt: Date,
  now: Date,
  timeZone: string,
): number {
  assertValidDate(lastCompletedAt, "Last completion timestamp");
  assertValidDate(now, "Current timestamp");

  const formatter = createCalendarDateFormatter(timeZone);
  const calendarDayDifference =
    calendarDayNumber(now, formatter) -
    calendarDayNumber(lastCompletedAt, formatter);

  return Math.max(0, calendarDayDifference);
}

export function deriveTaskState(input: DeriveTaskStateInput): DerivedTaskState {
  if (
    !Number.isInteger(input.targetIntervalDays) ||
    input.targetIntervalDays < 1
  ) {
    throw new RangeError("Target interval must be a positive whole number");
  }

  assertValidDate(input.now, "Current timestamp");
  if (input.snoozedUntil !== null) {
    assertValidDate(input.snoozedUntil, "Snooze timestamp");
  }

  // Constructing the formatter validates the explicitly supplied IANA zone,
  // including for never-completed tasks that do not need an elapsed calculation.
  createCalendarDateFormatter(input.timeZone);

  const lastCompletedAt = findLatestCompletionAt(input.completionTimestamps);
  const elapsedDays =
    lastCompletedAt === null
      ? null
      : calculateElapsedDays(lastCompletedAt, input.now, input.timeZone);
  const overageDays =
    elapsedDays === null
      ? null
      : Math.max(0, elapsedDays - input.targetIntervalDays);
  const state: TaskState =
    elapsedDays === null || elapsedDays >= input.targetIntervalDays
      ? "ready"
      : "sleeping";
  const isSnoozed =
    input.snoozedUntil !== null &&
    input.snoozedUntil.getTime() > input.now.getTime();

  return {
    lastCompletedAt,
    elapsedDays,
    overageDays,
    state,
    isSnoozed,
    visibleInReady: state === "ready" && !isSnoozed,
  };
}

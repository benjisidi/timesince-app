import { ApiError } from "./errors";

type JsonObject = Record<string, unknown>;

export interface CreateTaskBody {
  name: string;
  categoryId: number | null;
  targetIntervalDays: number;
  initialCompletedAt: Date | null;
}

export interface UpdateTaskBody {
  name?: string;
  categoryId?: number | null;
  targetIntervalDays?: number;
  snoozedUntil?: Date | null;
}

export interface CreateCompletionBody {
  completedAt?: Date;
}

function invalidRequest(
  message: string,
  fields?: Record<string, string>,
): never {
  throw new ApiError(400, "INVALID_REQUEST", message, fields);
}

function asObject(value: unknown): JsonObject {
  if (value === undefined) {
    return {};
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidRequest("Request body must be a JSON object");
  }

  return value as JsonObject;
}

function assertAllowedKeys(value: JsonObject, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unknownKey) {
    invalidRequest("Request body contains an unknown field", {
      [unknownKey]: "Unknown field",
    });
  }
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidRequest("Task name must not be blank", {
      name: "Must be a non-blank string",
    });
  }

  return value.trim();
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return invalidRequest(`${field} must be a positive whole number`, {
      [field]: "Must be a positive whole number",
    });
  }

  return value as number;
}

function parseNullableCategoryId(value: unknown): number | null {
  return value === null ? null : parsePositiveInteger(value, "categoryId");
}

function parseTimestamp(value: unknown, field: string): Date {
  const isoInstantPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstantPattern.test(value)) {
    return invalidRequest(`${field} must be an ISO-8601 timestamp`, {
      [field]: "Must be an ISO-8601 timestamp",
    });
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return invalidRequest(`${field} must be an ISO-8601 timestamp`, {
      [field]: "Must be an ISO-8601 timestamp",
    });
  }

  return timestamp;
}

function assertNotFuture(value: Date, now: Date, field: string): void {
  if (value.getTime() > now.getTime()) {
    invalidRequest(`${field} must not be in the future`, {
      [field]: "Must not be in the future",
    });
  }
}

export function parseId(value: string, field: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    return invalidRequest(`${field} must be a positive integer`);
  }

  return parsePositiveInteger(Number(value), field);
}

export function parseCreateTaskBody(body: unknown, now: Date): CreateTaskBody {
  const value = asObject(body);
  assertAllowedKeys(value, [
    "name",
    "categoryId",
    "targetIntervalDays",
    "initialCompletedAt",
  ]);

  if (!("name" in value) || !("targetIntervalDays" in value)) {
    return invalidRequest("Task name and targetIntervalDays are required");
  }

  let initialCompletedAt: Date | null = null;
  if (
    value.initialCompletedAt !== undefined &&
    value.initialCompletedAt !== null
  ) {
    initialCompletedAt = parseTimestamp(
      value.initialCompletedAt,
      "initialCompletedAt",
    );
    assertNotFuture(initialCompletedAt, now, "initialCompletedAt");
  }

  return {
    name: parseName(value.name),
    categoryId:
      value.categoryId === undefined
        ? null
        : parseNullableCategoryId(value.categoryId),
    targetIntervalDays: parsePositiveInteger(
      value.targetIntervalDays,
      "targetIntervalDays",
    ),
    initialCompletedAt,
  };
}

export function parseUpdateTaskBody(body: unknown, now: Date): UpdateTaskBody {
  const value = asObject(body);
  assertAllowedKeys(value, [
    "name",
    "categoryId",
    "targetIntervalDays",
    "snoozedUntil",
  ]);

  if (Object.keys(value).length === 0) {
    return invalidRequest("At least one task field must be supplied");
  }

  const result: UpdateTaskBody = {};
  if (value.name !== undefined) {
    result.name = parseName(value.name);
  }
  if (value.categoryId !== undefined) {
    result.categoryId = parseNullableCategoryId(value.categoryId);
  }
  if (value.targetIntervalDays !== undefined) {
    result.targetIntervalDays = parsePositiveInteger(
      value.targetIntervalDays,
      "targetIntervalDays",
    );
  }
  if (value.snoozedUntil !== undefined) {
    if (value.snoozedUntil === null) {
      result.snoozedUntil = null;
    } else {
      const snoozedUntil = parseTimestamp(value.snoozedUntil, "snoozedUntil");
      if (snoozedUntil.getTime() <= now.getTime()) {
        invalidRequest("snoozedUntil must be in the future", {
          snoozedUntil: "Must be in the future, or null to unsnooze",
        });
      }
      result.snoozedUntil = snoozedUntil;
    }
  }

  return result;
}

export function parseCreateCompletionBody(
  body: unknown,
  now: Date,
): CreateCompletionBody {
  const value = asObject(body);
  assertAllowedKeys(value, ["completedAt"]);

  if (value.completedAt === undefined) {
    return {};
  }

  const completedAt = parseTimestamp(value.completedAt, "completedAt");
  assertNotFuture(completedAt, now, "completedAt");
  return { completedAt };
}

export function assertEmptyBody(body: unknown): void {
  const value = asObject(body);
  assertAllowedKeys(value, []);
}

export function parseBooleanQuery(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return invalidRequest(`${field} must be true or false`);
}

export function parseCategoryQuery(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return invalidRequest("categoryId must be a positive integer");
  }

  return parseId(value, "categoryId");
}

export function parseStateQuery(value: unknown): "ready" | "sleeping" | "all" {
  if (value === undefined) {
    return "all";
  }
  if (value === "ready" || value === "sleeping" || value === "all") {
    return value;
  }

  return invalidRequest("state must be ready, sleeping, or all");
}

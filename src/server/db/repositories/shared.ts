export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function toIsoTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError("Timestamp must be a valid date");
  }

  return value.toISOString();
}

export function normalizeCategoryName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0) {
    throw new RangeError("Category name must not be blank");
  }

  return normalized;
}

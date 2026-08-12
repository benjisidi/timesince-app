import type { TaskResponse } from "../../../shared/api";

function compareByNameAndId(first: TaskResponse, second: TaskResponse) {
  return first.name.localeCompare(second.name) || first.id - second.id;
}

export function compareReadyTasks(first: TaskResponse, second: TaskResponse) {
  if (first.elapsedDays === null && second.elapsedDays !== null) return -1;
  if (first.elapsedDays !== null && second.elapsedDays === null) return 1;
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

export function compareSleepingTasks(
  first: TaskResponse,
  second: TaskResponse,
) {
  return (
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0) ||
    compareByNameAndId(first, second)
  );
}

export function compareBrowseTasks(first: TaskResponse, second: TaskResponse) {
  const firstBucket = first.isSnoozed ? 2 : first.state === "ready" ? 0 : 1;
  const secondBucket = second.isSnoozed ? 2 : second.state === "ready" ? 0 : 1;
  if (firstBucket !== secondBucket) return firstBucket - secondBucket;

  if (first.state !== second.state) return first.state === "ready" ? -1 : 1;
  return first.state === "ready"
    ? compareReadyTasks(first, second)
    : compareSleepingTasks(first, second);
}

import type { AppConfigResponse } from "../../shared/api";
import { apiFetch, readJson } from "./client";

export async function fetchAppConfig(signal?: AbortSignal) {
  const response = await apiFetch(
    "/api/config",
    signal ? { signal } : undefined,
  );
  return readJson<AppConfigResponse>(response);
}

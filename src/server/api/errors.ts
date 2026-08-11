import type { ErrorRequestHandler } from "express";

import type { ApiErrorResponse } from "../../shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const apiErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  void next;

  if (error instanceof ApiError) {
    const body: ApiErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    response.status(error.status).json(body);
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    const body: ApiErrorResponse = {
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON",
      },
    };
    response.status(400).json(body);
    return;
  }

  console.error("Unexpected API error", error);
  const body: ApiErrorResponse = {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  };
  response.status(500).json(body);
};

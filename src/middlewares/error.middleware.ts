import type { ErrorRequestHandler } from "express";

const supportedStatuses = [400, 401, 403, 404] as const;

function getErrorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return 500;
  }

  const status = error.status;
  return typeof status === "number" && supportedStatuses.includes(status as (typeof supportedStatuses)[number])
    ? status
    : 500;
}

export const errorMiddleware: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  const status = getErrorStatus(error);
  const env = process.env.NODE_ENV ?? "development";
  const message =
    status === 500 && env === "production"
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : "Internal server error";

  response.status(status).json({
    success: false,
    message,
    errors: null,
  });
};

/**
 * Structured application errors.
 *
 * Service and validation code throw `AppError` subclasses with a stable `code`
 * and a user-safe `message`. The UI/API layer can surface `message` directly
 * without leaking stack traces or internals. Anything that is NOT an AppError is
 * treated as an unexpected internal error and shown generically.
 */

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "STORAGE_ERROR"
  | "PARSE_ERROR"
  | "INGEST_ERROR"
  | "FEATURE_DISABLED"
  | "REVIEW_IN_PROGRESS"
  | "CHAT_BUSY";

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Optional field-level detail (e.g. Zod issues) safe to show the user. */
  readonly details?: Record<string, string[] | undefined>;

  constructor(
    code: AppErrorCode,
    message: string,
    details?: Record<string, string[] | undefined>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, string[] | undefined>) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

/**
 * Normalize any thrown value into a user-safe message + code. Unexpected errors
 * are logged server-side and reported generically so internals never leak.
 */
export function toUserError(error: unknown): {
  code: AppErrorCode | "INTERNAL_ERROR";
  message: string;
  details?: Record<string, string[] | undefined>;
} {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  console.error("Unexpected error:", error);
  return {
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
  };
}

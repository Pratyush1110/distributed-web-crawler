import { HttpError } from "./http.js";

export function isTransientHttpStatus(statusCode: number): boolean {
  return (
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  );
}

export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const transientErrorCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
  ]);

  const errorWithCode = error as Error & {
    code?: string;
  };

  return (
    errorWithCode.code !== undefined &&
    transientErrorCodes.has(errorWithCode.code)
  );
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return isTransientHttpStatus(error.statusCode);
  }

  return isTransientNetworkError(error);
}
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

export const RETRY_BASE_DELAY_MS = 1000;

export function getRetryDelay(
    attempt: number,
    baseDelayMs = RETRY_BASE_DELAY_MS,
): number {
    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new Error("attempt must be a positive integer");
    }

    return baseDelayMs * 2 ** (attempt - 1);
}

export async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    shouldRetry: (error: unknown) => boolean,
    maxAttempts = 3,
    onRetry?: (details: {
        attempt: number;
        nextAttempt: number;
        delayMs: number;
        error: unknown;
    }) => void,
): Promise<T> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error("maxAttempts must be a positive integer");
    }

    let attempt = 1;

    while (true) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !shouldRetry(error)) {
                throw error;
            }

            const delay =
                error instanceof HttpError && error.retryAfterMs !== undefined
                    ? error.retryAfterMs
                    : getRetryDelay(attempt);

            onRetry?.({
                attempt,
                nextAttempt: attempt + 1,
                delayMs: delay,
                error,
            });

            await new Promise((resolve) => {
                setTimeout(resolve, delay);
            });

            attempt++;
        }
    }
}

export function isTransientError(error: unknown): boolean {
    if (error instanceof HttpError) {
        return isTransientHttpStatus(error.statusCode);
    }

    return isTransientNetworkError(error);
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchUrl(
  url: string,
  options?: {
    userAgent?: string;
  },
): Promise<{
  statusCode: number;
  contentType: string | null;
  body: string;
}> {
  const response = await fetch(url, {
    headers: options?.userAgent
      ? {
        "User-Agent": options.userAgent,
      }
      : undefined,
  });

  if (!response.ok) {
    let retryAfterMs: number | undefined;

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");

      if (retryAfter) {
        const retryAfterSeconds = Number(retryAfter);

        if (
          Number.isFinite(retryAfterSeconds) &&
          retryAfterSeconds >= 0
        ) {
          retryAfterMs = retryAfterSeconds * 1000;
        }
      }
    }

    throw new HttpError(
      `HTTP request failed with status ${response.status}`,
      response.status,
      retryAfterMs,
    );
  }

  const body = await response.text();

  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
}
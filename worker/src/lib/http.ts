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

  const body = await response.text();

  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
}
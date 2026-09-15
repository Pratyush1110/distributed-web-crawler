export async function fetchUrl(url: string): Promise<{
  statusCode: number;
  contentType: string | null;
  body: string;
}> {
  const response = await fetch(url);

  const body = await response.text();

  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
}
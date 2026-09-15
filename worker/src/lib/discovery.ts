import { normalizeUrl } from "./normalize-url.js";

export function resolveAndNormalizeUrl(
  href: string,
  baseUrl: string,
): string | null {
  try {
    const resolvedUrl = new URL(href, baseUrl);

    if (
      resolvedUrl.protocol !== "http:" &&
      resolvedUrl.protocol !== "https:"
    ) {
      return null;
    }

    return normalizeUrl(resolvedUrl.toString());
  } catch {
    return null;
  }
}
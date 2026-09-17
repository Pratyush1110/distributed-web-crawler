import { Redis } from "ioredis";

export const DEFAULT_REQUESTS_PER_SECOND = 1;

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
});

export function getDomain(url: string): string {
  return new URL(url).hostname;
}

export function getRequestsPerSecond(domain: string): number {
  const configuredLimits = process.env.DOMAIN_RATE_LIMITS;

  if (!configuredLimits) {
    return DEFAULT_REQUESTS_PER_SECOND;
  }

  for (const entry of configuredLimits.split(",")) {
    const [configuredDomain, configuredRate] = entry.split(":");

    if (configuredDomain === domain) {
      const rate = Number(configuredRate);

      if (Number.isInteger(rate) && rate > 0) {
        return rate;
      }
    }
  }

  return DEFAULT_REQUESTS_PER_SECOND;
}

export async function waitForRateLimit(
  url: string,
  requestsPerSecond = getRequestsPerSecond(getDomain(url)),
): Promise<void> {
  const domain = getDomain(url);

  for (let slot = 0; slot < requestsPerSecond; slot++) {
    const key = `rate-limit:${domain}:${slot}`;

    const acquired = await redis.set(key, "1", "EX", 1, "NX");

    if (acquired === "OK") {
      return;
    }
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

  return waitForRateLimit(url, requestsPerSecond);
}
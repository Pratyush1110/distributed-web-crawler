import { Redis } from "ioredis";
import { fetchUrl } from "./http.js";
import {
  parseRobotsTxt,
  type RobotsRules,
} from "./robots-parser.js";

export const CRAWLER_USER_AGENT = "DistributedWebCrawler/1.0";

const ROBOTS_CACHE_TTL_SECONDS = 60 * 60;

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
});

export function getRobotsUrl(url: string): string {
  const parsedUrl = new URL(url);

  return `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;
}

function getRobotsCacheKey(url: string): string {
  const parsedUrl = new URL(url);

  return `robots:${parsedUrl.protocol}//${parsedUrl.host}`;
}

export async function fetchRobotsTxt(url: string): Promise<string | null> {
  const robotsUrl = getRobotsUrl(url);

  const response = await fetchUrl(robotsUrl, {
    userAgent: CRAWLER_USER_AGENT,
  });

  if (response.statusCode === 404) {
    return null;
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Failed to fetch robots.txt: ${response.statusCode}`,
    );
  }

  return response.body;
}

export async function getRobotsRules(
  url: string,
): Promise<RobotsRules> {
  const cacheKey = getRobotsCacheKey(url);

  const cachedRules = await redis.get(cacheKey);

  if (cachedRules) {
    return JSON.parse(cachedRules) as RobotsRules;
  }

  const robotsTxt = await fetchRobotsTxt(url);

  const rules = robotsTxt
    ? parseRobotsTxt(robotsTxt, CRAWLER_USER_AGENT)
    : { rules: [] };

  await redis.set(
    cacheKey,
    JSON.stringify(rules),
    "EX",
    ROBOTS_CACHE_TTL_SECONDS,
  );

  return rules;
}
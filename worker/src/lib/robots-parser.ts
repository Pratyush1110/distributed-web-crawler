export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsRules {
  rules: RobotsRule[];
}

export function parseRobotsTxt(
  robotsTxt: string,
  userAgent: string,
): RobotsRules {
  const lines = robotsTxt.split(/\r?\n/);

  const rules: RobotsRule[] = [];

  let appliesToCrawler = false;
  let hasUserAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#", 1)[0].trim();

    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const directive = line
      .slice(0, separatorIndex)
      .trim()
      .toLowerCase();

    const value = line.slice(separatorIndex + 1).trim();

    if (directive === "user-agent") {
      hasUserAgent = true;

      const normalizedAgent = value.toLowerCase();
      const normalizedCrawler = userAgent.toLowerCase();

      appliesToCrawler =
        normalizedAgent === "*" ||
        normalizedCrawler.includes(normalizedAgent);

      continue;
    }

    if (!hasUserAgent || !appliesToCrawler) {
      continue;
    }

    if (directive === "allow" || directive === "disallow") {
      if (value === "") {
        continue;
      }

      rules.push({
        allow: directive === "allow",
        path: value,
      });
    }
  }

  return {
    rules,
  };
}

export function isUrlAllowed(
  url: string,
  rules: RobotsRules,
): boolean {
  const parsedUrl = new URL(url);

  let matchedRule: RobotsRule | null = null;

  for (const rule of rules.rules) {
    if (!parsedUrl.pathname.startsWith(rule.path)) {
      continue;
    }

    if (
      matchedRule === null ||
      rule.path.length > matchedRule.path.length
    ) {
      matchedRule = rule;
    }
  }

  if (!matchedRule) {
    return true;
  }

  return matchedRule.allow;
}
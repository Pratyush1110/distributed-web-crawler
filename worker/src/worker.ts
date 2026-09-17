import "dotenv/config";
import { Worker } from "bullmq";
import { fetchUrl } from "./lib/http.js";
import { parseHtml } from "./lib/html.js";
import { prisma } from "./lib/prisma.js";
import { registerUrl } from "./lib/url.js";
import { getCrawlMaxDepth } from "./lib/crawl.js";
import { extractLinks } from "./lib/links.js";
import { resolveAndNormalizeUrl } from "./lib/discovery.js";
import { crawlQueue } from "./lib/queue.js";
import { waitForRateLimit } from "./lib/rate-limit.js";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const worker = new Worker(
  "crawlQueue",
  async (job) => {
    console.log("Received job:", job.id, job.name, job.data);

    if (!job.data.registered) {
      const registration = await registerUrl(
        job.data.crawlId,
        job.data.url,
        job.data.depth,
      );

      if (!registration.created) {
        console.log("Skipping duplicate URL:", job.data.url);
        return;
      }
    }

    const maxDepth = await getCrawlMaxDepth(job.data.crawlId);

    if (job.data.depth >= maxDepth) {
      console.log("Maximum depth reached:", {
        url: job.data.url,
        depth: job.data.depth,
        maxDepth,
      });
    }

    await waitForRateLimit(job.data.url);

    const result = await fetchUrl(job.data.url);

    console.log("Fetched URL:", {
      url: job.data.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      bodyLength: result.body.length,
    });

    const $ = parseHtml(result.body);

    console.log("Page title:", $("title").text());

    if (job.data.depth >= maxDepth) {
      return;
    }

    const links = extractLinks(result.body);

    console.log("Extracted links:", links.length);

    for (const href of links) {
      const normalizedUrl = resolveAndNormalizeUrl(
        href,
        job.data.url,
      );

      if (!normalizedUrl) {
        continue;
      }

      const registration = await registerUrl(
        job.data.crawlId,
        normalizedUrl,
        job.data.depth + 1,
      );

      if (!registration.created) {
        console.log("Skipping duplicate discovered URL:", normalizedUrl);
        continue;
      }

      await crawlQueue.add("crawl", {
        crawlId: job.data.crawlId,
        url: normalizedUrl,
        depth: job.data.depth + 1,
        registered: true,
      });

      console.log("Enqueued discovered URL:", {
        url: normalizedUrl,
        depth: job.data.depth + 1,
      });
    }
  },
  {
    connection: redisConnection,
  },
);

worker.on("completed", (job) => {
  console.log("Job completed:", job.id);
});

worker.on("failed", (job, error) => {
  console.error("Job failed:", job?.id, error.message);
});

console.log("Crawler worker started");
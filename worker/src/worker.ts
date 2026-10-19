import "dotenv/config";
import { UnrecoverableError, Worker } from "bullmq";
import { fetchUrl } from "./lib/http.js";
import { parseHtml } from "./lib/html.js";
import { prisma } from "./lib/prisma.js";
import { registerUrl } from "./lib/url.js";
import { getCrawlMaxDepth } from "./lib/crawl.js";
import { extractLinks } from "./lib/links.js";
import { resolveAndNormalizeUrl } from "./lib/discovery.js";
import { crawlQueue } from "./lib/queue.js";
import { waitForRateLimit, closeRateLimitRedis } from "./lib/rate-limit.js";
import {
  CRAWLER_USER_AGENT,
  getRobotsRules,
  closeRobotsRedis
} from "./lib/robots.js";
import { isUrlAllowed } from "./lib/robots-parser.js";
import { isTransientError } from "./lib/retry.js";
import { crawlDLQ } from "./lib/dlq.js";
import { updateCrawlStatusIfFinished } from "./lib/crawl-status.js";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const worker = new Worker(
  "crawlQueue",
  async (job) => {
    console.log("Received job:", job.id, job.name, job.data);

    await prisma.crawl.updateMany({
      where: {
        id: job.data.crawlId,
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
      },
    });

    if (!job.data.registered) {
      const registration = await registerUrl(
        job.data.crawlId,
        job.data.url,
        job.data.depth,
      );

      if (registration.crawlTerminal) {
        console.log("Skipping job for terminal crawl:", {
          crawlId: job.data.crawlId,
          url: job.data.url,
        });
        return;
      }

      if (!registration.created) {
        const existingUrl = await prisma.url.findUnique({
          where: {
            crawlId_normalizedUrl: {
              crawlId: job.data.crawlId,
              normalizedUrl: job.data.url,
            },
          },
          select: {
            status: true,
          },
        });

        if (!existingUrl || existingUrl.status === "CRAWLED") {
          console.log("Skipping duplicate URL:", job.data.url);
          return;
        }

        console.log("Retrying existing URL:", job.data.url);
      }
    }

    await prisma.url.updateMany({
      where: {
        crawlId: job.data.crawlId,
        normalizedUrl: job.data.url,
      },
      data: {
        status: "CRAWLING",
      },
    });

    const maxDepth = await getCrawlMaxDepth(job.data.crawlId);

    if (job.data.depth >= maxDepth) {
      console.log("Maximum depth reached:", {
        url: job.data.url,
        depth: job.data.depth,
        maxDepth,
      });
    }

    const robotsRules = await getRobotsRules(job.data.url);

    if (!isUrlAllowed(job.data.url, robotsRules)) {
      await prisma.url.updateMany({
        where: {
          crawlId: job.data.crawlId,
          normalizedUrl: job.data.url,
        },
        data: {
          status: "FAILED",
        },
      });

      console.log("Blocked by robots.txt:", {
        url: job.data.url,
        userAgent: CRAWLER_USER_AGENT,
      });

      await updateCrawlStatusIfFinished(job.data.crawlId);

      return;
    }

    await waitForRateLimit(job.data.url);

    let result;

    try {
      result = await fetchUrl(job.data.url, {
        userAgent: CRAWLER_USER_AGENT,
      });

    } catch (error) {
      const transient = isTransientError(error);
      const maxAttempts = job.opts.attempts ?? 1;
      const currentAttempt = job.attemptsMade + 1;
      const finalAttempt = currentAttempt >= maxAttempts;
      const terminalFailure = !transient || finalAttempt;

      if (terminalFailure) {
        const updateResult = await prisma.url.updateMany({
          where: {
            crawlId: job.data.crawlId,
            normalizedUrl: job.data.url,
          },
          data: {
            status: "FAILED",
          },
        });

        console.log("URL marked as failed:", {
          url: job.data.url,
          updatedCount: updateResult.count,
          transient,
          finalAttempt,
        });

        try {
          await crawlDLQ.add("crawl-failed", {
            crawlId: job.data.crawlId,
            jobId: String(job.id),
            url: job.data.url,
            depth: job.data.depth,
            attempts: currentAttempt,
            error: {
              name:
                error instanceof Error
                  ? error.name
                  : "UnknownError",
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
            failedAt: new Date().toISOString(),
          });

          console.log("Job moved to DLQ:", {
            jobId: job.id,
            url: job.data.url,
            attempts: currentAttempt,
            transient,
          });
        } catch (dlqError) {
          console.error("Failed to add job to DLQ:", dlqError);
        }
      }

      if (terminalFailure) {
        await updateCrawlStatusIfFinished(job.data.crawlId);

        throw new UnrecoverableError(
          error instanceof Error ? error.message : String(error),
        );
      }

      throw error;
    }

    console.log("Fetched URL:", {
      url: job.data.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      bodyLength: result.body.length,
    });

    const $ = parseHtml(result.body);
    const title = $("title").text() || null;

    const urlRecord = await prisma.url.findUnique({
      where: {
        crawlId_normalizedUrl: {
          crawlId: job.data.crawlId,
          normalizedUrl: job.data.url,
        },
      },
      select: {
        id: true,
      },
    });

    if (!urlRecord) {
      throw new Error(`URL record not found: ${job.data.url}`);
    }

    await prisma.$transaction([
      prisma.page.upsert({
        where: {
          urlId: urlRecord.id,
        },
        create: {
          urlId: urlRecord.id,
          statusCode: result.statusCode,
          title,
          content: result.body,
          contentType: result.contentType,
        },
        update: {
          statusCode: result.statusCode,
          title,
          content: result.body,
          contentType: result.contentType,
          fetchedAt: new Date(),
        },
      }),
    ]);

    console.log("Page saved:", {
      url: job.data.url,
      title,
    });

    if (job.data.depth >= maxDepth) {
      await prisma.url.update({
        where: {
          id: urlRecord.id,
        },
        data: {
          status: "CRAWLED",
          crawledAt: new Date(),
        },
      });

      await updateCrawlStatusIfFinished(job.data.crawlId);
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

      if (registration.crawlTerminal) {
        console.log("Stopping discovery for terminal crawl:", {
          crawlId: job.data.crawlId,
          url: normalizedUrl,
        });
        break;
      }

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

    await prisma.url.update({
      where: {
        id: urlRecord.id,
      },
      data: {
        status: "CRAWLED",
        crawledAt: new Date(),
      },
    });

    await updateCrawlStatusIfFinished(job.data.crawlId);
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

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  try {
    await worker.close();
    console.log("Worker closed.");
  } catch (error) {
    console.error("Error closing worker:", error);
    process.exitCode = 1;
  }

  try {
    await Promise.all([
      crawlQueue.close(),
      crawlDLQ.close(),
      closeRateLimitRedis(),
      closeRobotsRedis(),
    ]);
    console.log("Redis connections and queues closed.");
  } catch (error) {
    console.error("Error closing Redis queues:", error);
    process.exitCode = 1;
  }

  try {
    await prisma.$disconnect();
    console.log("Database connection closed.");
  } catch (error) {
    console.error("Error disconnecting Prisma:", error);
    process.exitCode = 1;
  }

  console.log("Graceful shutdown complete.");
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

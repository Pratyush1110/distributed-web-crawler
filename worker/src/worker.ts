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
import { logger } from "./lib/logger.js";
import {
  pagesCrawledTotal,
  crawlFailuresTotal,
  httpRequestsTotal,
  httpRequestDuration,
  crawlJobDuration,
} from "./lib/metrics.js";
import {
  startMetricsServer,
  closeMetricsServer,
} from "./lib/metrics-server.js";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const jobStartTimes = new Map<string, number>();

const worker = new Worker(
  "crawlQueue",
  async (job) => {
    const jobStartedAt = performance.now();
    logger.info("job_received", {
      jobId: job.id,
      jobName: job.name,
      crawlId: job.data.crawlId,
      url: job.data.url,
      depth: job.data.depth,
    });

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
        logger.info("job_skipped_terminal_crawl", {
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
          logger.info("duplicate_url_skipped", {
            url: job.data.url,
          });
          return;
        }

        logger.info("existing_url_retry", {
          url: job.data.url,
        });
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
      logger.info("maximum_depth_reached", {
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

      logger.warn("url_blocked_by_robots", {
        url: job.data.url,
        userAgent: CRAWLER_USER_AGENT,
      });

      await updateCrawlStatusIfFinished(job.data.crawlId);

      return;
    }

    await waitForRateLimit(job.data.url);

    let result;
    const fetchStartedAt = performance.now();

    try {
      result = await fetchUrl(job.data.url, {
        userAgent: CRAWLER_USER_AGENT,
      });

      httpRequestsTotal.inc({ outcome: "success" });

    } catch (error) {
      httpRequestDuration.observe(
        (performance.now() - fetchStartedAt) / 1000,
      );
      httpRequestsTotal.inc({ outcome: "error" });

      const transient = isTransientError(error);
      const maxAttempts = job.opts.attempts ?? 1;
      const currentAttempt = job.attemptsMade + 1;
      const finalAttempt = currentAttempt >= maxAttempts;
      const terminalFailure = !transient || finalAttempt;

      if (terminalFailure) {
        crawlFailuresTotal.inc();

        const updateResult = await prisma.url.updateMany({
          where: {
            crawlId: job.data.crawlId,
            normalizedUrl: job.data.url,
          },
          data: {
            status: "FAILED",
          },
        });

        logger.error("url_marked_failed", {
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

          logger.error("job_moved_to_dlq", {
            jobId: job.id,
            url: job.data.url,
            attempts: currentAttempt,
            transient,
          });
        } catch (dlqError) {
          logger.error("dlq_insertion_failed", {
            error:
              dlqError instanceof Error
                ? dlqError.message
                : String(dlqError),
          });
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

    httpRequestDuration.observe(
      (performance.now() - fetchStartedAt) / 1000,
    );

    logger.info("url_fetched", {
      url: job.data.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      bodyLength: result.body.length,
      latencyMs: Math.round(performance.now() - fetchStartedAt),
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

    logger.info("page_saved", {
      url: job.data.url,
      title,
    });
    pagesCrawledTotal.inc();

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

    logger.info("links_extracted", {
      url: job.data.url,
      count: links.length,
    });

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
        logger.info("discovery_stopped_terminal_crawl", {
          crawlId: job.data.crawlId,
          url: normalizedUrl,
        });
        break;
      }

      if (!registration.created) {
        logger.info("duplicate_discovered_url_skipped", {
          url: normalizedUrl,
        });
        continue;
      }

      await crawlQueue.add("crawl", {
        crawlId: job.data.crawlId,
        url: normalizedUrl,
        depth: job.data.depth + 1,
        registered: true,
      });

      logger.info("discovered_url_enqueued", {
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

worker.on("active", (job) => {
  jobStartTimes.set(String(job.id), performance.now());
});

worker.on("completed", (job) => {
  const startedAt = jobStartTimes.get(String(job.id));

  if (startedAt !== undefined) {
    crawlJobDuration.observe(
      (performance.now() - startedAt) / 1000,
    );
    jobStartTimes.delete(String(job.id));
  }

  logger.info("job_completed", {
    jobId: job.id,
  });
});

worker.on("failed", (job, error) => {
  if (job) {
    const startedAt = jobStartTimes.get(String(job.id));

    if (startedAt !== undefined) {
      crawlJobDuration.observe(
        (performance.now() - startedAt) / 1000,
      );
      jobStartTimes.delete(String(job.id));
    }
  }

  logger.error("job_failed", {
    jobId: job?.id,
    error: error.message,
  });
});

await startMetricsServer();
logger.info("worker_started");

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("shutdown_started", { signal });

  try {
    await worker.close();
    logger.info("worker_closed");
  } catch (error) {
    logger.error("worker_close_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }

  try {
    await closeMetricsServer();
    logger.info("metrics_server_closed");
  } catch (error) {
    logger.error("metrics_server_close_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }

  try {
    await Promise.all([
      crawlQueue.close(),
      crawlDLQ.close(),
      closeRateLimitRedis(),
      closeRobotsRedis(),
    ]);
    logger.info("redis_connections_closed");
  } catch (error) {
    logger.error("redis_cleanup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }

  try {
    await prisma.$disconnect();
    logger.info("database_connection_closed");
  } catch (error) {
    logger.error("database_disconnect_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }

  logger.info("shutdown_completed");
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

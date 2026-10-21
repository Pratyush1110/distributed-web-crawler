import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import { crawlQueue } from "./queue.js";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const pagesCrawledTotal = new Counter({
  name: "crawler_pages_crawled_total",
  help: "Total number of pages successfully crawled.",
  registers: [registry],
});

export const crawlFailuresTotal = new Counter({
  name: "crawler_failures_total",
  help: "Total number of terminal crawl failures.",
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "crawler_http_requests_total",
  help: "Total number of HTTP fetch attempts by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "crawler_http_request_duration_seconds",
  help: "Duration of HTTP fetch attempts in seconds.",
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const crawlJobDuration = new Histogram({
  name: "crawler_job_duration_seconds",
  help: "Duration of worker job processing in seconds.",
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const queueWaitingJobs = new Gauge({
  name: "crawler_queue_waiting_jobs",
  help: "Number of crawl jobs waiting to be processed.",
  registers: [registry],
  async collect() {
    this.set(await crawlQueue.getWaitingCount());
  },
});
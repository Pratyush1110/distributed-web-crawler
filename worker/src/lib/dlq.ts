import { Queue } from "bullmq";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export interface CrawlDLQData {
  crawlId: string;
  jobId: string;
  url: string;
  depth: number;
  attempts: number;
  error: {
    name: string;
    message: string;
  };
  failedAt: string;
}

export const crawlDLQ = new Queue<CrawlDLQData>("crawlDLQ", {
  connection: redisConnection,
});
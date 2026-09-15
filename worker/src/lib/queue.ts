import { Queue } from "bullmq";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const crawlQueue = new Queue("crawlQueue", {
  connection: redisConnection,
});
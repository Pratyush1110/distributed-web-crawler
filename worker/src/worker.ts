import "dotenv/config";
import { Worker } from "bullmq";
import { fetchUrl } from "./lib/http.js";
import { parseHtml } from "./lib/html.js";
import { prisma } from "./lib/prisma.js";
import { registerUrl } from "./lib/url.js";

const redisConnection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const worker = new Worker(
  "crawlQueue",
  async (job) => {
    console.log("Received job:", job.id, job.name, job.data);

    const registration = await registerUrl(
      job.data.crawlId,
      job.data.url,
      job.data.depth,
    );

    if (!registration.created) {
      console.log("Skipping duplicate URL:", job.data.url);
      return;
    }

    const result = await fetchUrl(job.data.url);

    console.log("Fetched URL:", {
      url: job.data.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      bodyLength: result.body.length,
    });

    const $ = parseHtml(result.body);

    console.log("Page title:", $("title").text());
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
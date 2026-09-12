import "dotenv/config";
import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return { status: "ok" };
});

app.post("/crawl", async (request, reply) => {
  const body = request.body as {
    startUrl?: unknown;
    maxDepth?: unknown;
  };

  if (typeof body.startUrl !== "string") {
    return reply.status(400).send({
      error: "startUrl must be a string",
    });
  }

  if (typeof body.maxDepth !== "number" || !Number.isInteger(body.maxDepth)) {
    return reply.status(400).send({
      error: "maxDepth must be an integer",
    });
  }

  if (body.maxDepth < 0) {
    return reply.status(400).send({
      error: "maxDepth must be greater than or equal to 0",
    });
  }

  let startUrl: URL;

  try {
    startUrl = new URL(body.startUrl);
  } catch {
    return reply.status(400).send({
      error: "startUrl must be a valid URL",
    });
  }

  if (startUrl.protocol !== "http:" && startUrl.protocol !== "https:") {
    return reply.status(400).send({
      error: "startUrl must use HTTP or HTTPS",
    });
  }

  const crawl = await prisma.crawl.create({
    data: {
      startUrl: startUrl.toString(),
      maxDepth: body.maxDepth,
    },
  });

  return reply.status(201).send({
    crawlId: crawl.id,
    status: crawl.status,
  });
});

const start = async () => {
  try {
    await app.listen({
      host: "127.0.0.1",
      port: 3000,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
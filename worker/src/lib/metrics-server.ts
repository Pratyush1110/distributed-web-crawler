import { createServer } from "node:http";
import { registry } from "./metrics.js";
import { logger } from "./logger.js";

const metricsPort = Number(process.env.METRICS_PORT ?? 9464);

export const metricsServer = createServer(async (req, res) => {
  if (req.url !== "/metrics" || req.method !== "GET") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  try {
    const metrics = await registry.metrics();

    res.writeHead(200, {
      "Content-Type": registry.contentType,
    });
    res.end(metrics);
  } catch (error) {
    logger.error("metrics_collection_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Failed to collect metrics");
  }
});

export function startMetricsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    metricsServer.once("error", reject);

    metricsServer.listen(metricsPort, () => {
      metricsServer.removeListener("error", reject);

      logger.info("metrics_server_started", {
        port: metricsPort,
        path: "/metrics",
      });

      resolve();
    });
  });
}

export function closeMetricsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!metricsServer.listening) {
      resolve();
      return;
    }

    metricsServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
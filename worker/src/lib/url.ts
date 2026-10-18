
import { prisma } from "./prisma.js";

export async function registerUrl(
  crawlId: string,
  normalizedUrl: string,
  depth: number,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const crawls = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
        SELECT "id", "status"
        FROM "Crawl"
        WHERE "id" = ${crawlId}
        FOR UPDATE
      `;

      const crawl = crawls[0];

      if (!crawl) {
        throw new Error(`Crawl not found: ${crawlId}`);
      }

      if (
        crawl.status === "COMPLETED" ||
        crawl.status === "FAILED"
      ) {
        return {
          created: false,
          url: null,
          crawlTerminal: true,
        };
      }

      const url = await tx.url.create({
        data: {
          crawlId,
          url: normalizedUrl,
          normalizedUrl,
          depth,
        },
      });

      return {
        created: true,
        url,
        crawlTerminal: false,
      };
    });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return {
        created: false,
        url: null,
        crawlTerminal: false,
      };
    }

    throw error;
  }
}

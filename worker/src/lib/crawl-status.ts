import { prisma } from "./prisma.js";

export async function updateCrawlStatusIfFinished(
  crawlId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const crawls = await tx.$queryRaw<
      Array<{ id: string; status: string }>
    >`
      SELECT "id", "status"
      FROM "Crawl"
      WHERE "id" = ${crawlId}
      FOR UPDATE
    `;

    const crawl = crawls[0];

    if (
      !crawl ||
      crawl.status === "COMPLETED" ||
      crawl.status === "FAILED"
    ) {
      return;
    }

    const urlCount = await tx.url.count({
      where: { crawlId },
    });

    if (urlCount === 0) {
      return;
    }

    const unfinishedUrl = await tx.url.findFirst({
      where: {
        crawlId,
        status: {
          in: ["PENDING", "CRAWLING"],
        },
      },
      select: {
        id: true,
      },
    });

    if (unfinishedUrl) {
      return;
    }

    const failedUrl = await tx.url.findFirst({
      where: {
        crawlId,
        status: "FAILED",
      },
      select: {
        id: true,
      },
    });

    await tx.crawl.update({
      where: { id: crawlId },
      data: {
        status: failedUrl ? "FAILED" : "COMPLETED",
      },
    });
  });
}

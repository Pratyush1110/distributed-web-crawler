import { prisma } from "./prisma.js";

export async function getCrawlMaxDepth(crawlId: string): Promise<number> {
  const crawl = await prisma.crawl.findUnique({
    where: {
      id: crawlId,
    },
    select: {
      maxDepth: true,
    },
  });

  if (!crawl) {
    throw new Error(`Crawl not found: ${crawlId}`);
  }

  return crawl.maxDepth;
}
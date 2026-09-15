import { prisma } from "./prisma.js";

export async function registerUrl(
  crawlId: string,
  normalizedUrl: string,
  depth: number,
) {
  try {
    const url = await prisma.url.create({
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
    };
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
      };
    }

    throw error;
  }
}
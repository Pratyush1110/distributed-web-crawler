import * as cheerio from "cheerio";

export function extractLinks(html: string): string[] {
  const $ = cheerio.load(html);

  const links: string[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (href) {
      links.push(href);
    }
  });

  return links;
}
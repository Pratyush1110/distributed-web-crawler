import * as cheerio from "cheerio";

export function parseHtml(html: string) {
  return cheerio.load(html);
}
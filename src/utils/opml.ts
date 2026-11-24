export interface OpmlFeed {
  title: string;
  xmlUrl: string;
}

/**
 * OPML 里最多处理多少个 feed。
 * Workers 免费版单次请求的子请求上限是 50，导入时每个 feed 要发一次 fetch，
 * 再加上 getFile / 下载文件 / 发消息，30 是留了余量的安全值。
 */
export const MAX_IMPORT_FEEDS = 30;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 生成 OPML 2.0 文档 */
export function buildOpml(feeds: OpmlFeed[]): string {
  const outlines = feeds
    .map((feed) => `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.xmlUrl)}"/>`)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>Telegram RSS Bot Subscriptions</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    `  </head>`,
    `  <body>`,
    outlines,
    `  </body>`,
    `</opml>`,
    ``,
  ].join("\n");
}

/** 读取 outline 标签上的属性，属性名大小写不敏感，值可用单/双引号 */
function readAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * 解析 OPML，取出所有带 xmlUrl 的 outline。
 * 不做完整 XML 解析：OPML 结构扁平，按标签正则提取足够稳，且不用引新依赖。
 */
export function parseOpml(xml: string): OpmlFeed[] {
  const feeds: OpmlFeed[] = [];
  const seen = new Set<string>();
  const outlineRe = /<outline\b([^>]*)>/gi;

  let match: RegExpExecArray | null;
  while ((match = outlineRe.exec(xml)) !== null) {
    const xmlUrl = readAttribute(match[1], "xmlUrl");
    if (!xmlUrl) continue;

    const decodedUrl = decodeXmlEntities(xmlUrl).trim();
    if (!/^https?:\/\//i.test(decodedUrl) || seen.has(decodedUrl)) continue;
    seen.add(decodedUrl);

    const rawTitle = readAttribute(match[1], "title") ?? readAttribute(match[1], "text");
    const title = rawTitle ? decodeXmlEntities(rawTitle).trim() : "";
    feeds.push({ title: title || decodedUrl, xmlUrl: decodedUrl });
  }

  return feeds;
}

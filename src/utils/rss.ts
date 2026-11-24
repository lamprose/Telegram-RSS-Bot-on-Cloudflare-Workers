import Parser from "rss-parser";

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate?: string;
}

interface CacheEntry {
  items: FeedItem[];
  feedTitle: string;
  timestamp: number;
}

export class RSSUtil {
  private parser: Parser;
  private cache: Map<string, CacheEntry>;
  private readonly CACHE_TTL: number;

  constructor(updateInterval: number) {
    this.CACHE_TTL = updateInterval * 60 * 1000;
    this.parser = new Parser({
      timeout: 5000,
      headers: {
        "User-Agent": "Telegram RSS Bot/1.0",
      },
    });
    this.cache = new Map();
  }

  /**
   * 获取 RSS 源的最新文章
   * @param url - RSS 源的 URL
   * @returns 包含文章和源标题的对象。如果没有获取到标题，则使用 URL 作为标题
   */
  async fetchFeed(url: string): Promise<{ items: FeedItem[]; feedTitle: string }> {
    // 检查缓存
    const cached = this.cache.get(url);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return { items: cached.items, feedTitle: cached.feedTitle };
    }

    try {
      const response = await fetch(url);
      const xml = await response.text();
      // Do not use `parseURL`: cloudflare worker does not support https.get
      // Failed to fetch RSS feed: [unenv] https.get is not implemented yet!
      const feed = await this.parser.parseString(xml);
      const items = feed.items.map((item) => ({
        title: item.title?.trim() || "Untitled",
        link: item.link || url,
        guid: item.guid || item.link || "",
        pubDate: item.pubDate,
      }));

      const feedTitle = feed.title?.trim() || url;

      // 更新缓存
      this.cache.set(url, { items, feedTitle, timestamp: now });

      return { items, feedTitle };
    } catch (error: unknown) {
      console.error(`Error fetching RSS feed from ${url}:`, error);
      throw error;
    }
  }
}

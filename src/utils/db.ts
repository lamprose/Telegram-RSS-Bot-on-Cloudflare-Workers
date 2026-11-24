import { Language } from "./i18n";

export interface RSSSubscription {
  id?: number;
  user_id: number;
  feed_url: string;
  feed_title: string;
  /** 用户自定义的订阅名；为空时展示 feed_title */
  name?: string | null;
  last_fetch_time?: number;
  last_item_guid?: string;
  created_at: number;
}

export interface PendingAction {
  user_id: number;
  action: string;
  sub_id?: number | null;
  created_at: number;
}

/** 订阅在界面上展示的名字 */
export function subscriptionName(sub: RSSSubscription): string {
  return sub.name?.trim() || sub.feed_title;
}

export class Database {
  private cache: Cache;
  private cacheUrl: string;

  constructor(private db: D1Database) {
    this.cache = caches.default;
    this.cacheUrl = "https://telegram-rss-bot.workers.dev"; // 使用你的 worker URL 作为 base url
  }

  // 用户语言设置相关操作
  async getUserLanguage(userId: number): Promise<Language> {
    const cacheKey = new URL(`/cache/user_lang_${userId}`, this.cacheUrl).toString();

    try {
      // 尝试从缓存获取
      const cachedResponse = await this.cache.match(cacheKey);
      if (cachedResponse) {
        const cachedLang = await cachedResponse.text();
        return cachedLang as Language;
      }

      // 如果缓存中没有，从数据库获取
      const result = await this.db.prepare("SELECT language FROM user_settings WHERE user_id = ?").bind(userId).first<{ language: Language }>();

      const lang = result?.language || "zh";

      // 将结果存入缓存，设置 1 小时过期时间
      await this.cache.put(
        cacheKey,
        new Response(lang, {
          headers: {
            "Cache-Control": "max-age=3600",
          },
        }),
      );

      return lang;
    } catch (error) {
      console.error("Error getting user language:", error);
      return "zh"; // 发生错误时返回默认语言
    }
  }

  async setUserLanguage(userId: number, language: Language): Promise<void> {
    const cacheKey = new URL(`/cache/user_lang_${userId}`, this.cacheUrl).toString();

    try {
      // 更新数据库
      await this.db.prepare("INSERT OR REPLACE INTO user_settings (user_id, language) VALUES (?, ?)").bind(userId, language).run();

      // 删除旧的缓存
      await this.cache.delete(cacheKey);

      // 设置新的缓存，但强制立即过期以确保下次获取时会重新从数据库读取
      await this.cache.put(
        cacheKey,
        new Response(language, {
          headers: {
            "Cache-Control": "max-age=0, must-revalidate",
          },
        }),
      );
    } catch (error) {
      console.error("Error setting user language:", error);
      throw error;
    }
  }

  // RSS订阅相关操作
  /**
   * 新增订阅；同一用户重复订阅同一个源时更新名字，不再撞 UNIQUE 约束报错。
   * @returns true 表示是新建，false 表示是覆盖已有订阅
   */
  async addSubscription(userId: number, feedUrl: string, feedTitle: string, name?: string): Promise<boolean> {
    const existing = await this.db
      .prepare("SELECT id FROM rss_subscriptions WHERE user_id = ? AND feed_url = ?")
      .bind(userId, feedUrl)
      .first<{ id: number }>();

    await this.db
      .prepare(
        `INSERT INTO rss_subscriptions (user_id, feed_url, feed_title, name, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, feed_url) DO UPDATE SET
           feed_title = excluded.feed_title,
           name = excluded.name`,
      )
      .bind(userId, feedUrl, feedTitle, name?.trim() || feedTitle, Date.now())
      .run();

    return !existing;
  }

  async removeSubscription(userId: number, feedUrl: string): Promise<void> {
    await this.db.prepare("DELETE FROM rss_subscriptions WHERE user_id = ? AND feed_url = ?").bind(userId, feedUrl).run();
  }

  async removeSubscriptionById(userId: number, id: number): Promise<void> {
    await this.db.prepare("DELETE FROM rss_subscriptions WHERE user_id = ? AND id = ?").bind(userId, id).run();
  }

  /** 按 id 取订阅，并强制限定归属，避免回调查到别人的数据 */
  async getSubscription(userId: number, id: number): Promise<RSSSubscription | null> {
    return await this.db
      .prepare("SELECT * FROM rss_subscriptions WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first<RSSSubscription>();
  }

  async updateSubscriptionName(userId: number, id: number, name: string): Promise<void> {
    await this.db.prepare("UPDATE rss_subscriptions SET name = ? WHERE user_id = ? AND id = ?").bind(name, userId, id).run();
  }

  async listSubscriptions(userId: number): Promise<RSSSubscription[]> {
    return await this.db
      .prepare("SELECT * FROM rss_subscriptions WHERE user_id = ? ORDER BY id")
      .bind(userId)
      .all<RSSSubscription>()
      .then((result) => result.results);
  }

  async updateLastFetch(userId: number, feedUrl: string, lastFetchTime: number, lastItemGuid: string): Promise<void> {
    await this.db
      .prepare("UPDATE rss_subscriptions SET last_fetch_time = ?, last_item_guid = ? WHERE user_id = ? AND feed_url = ?")
      .bind(lastFetchTime, lastItemGuid, userId, feedUrl)
      .run();
  }

  async getSubscriptionsToUpdate(interval: number): Promise<RSSSubscription[]> {
    const cutoffTime = Date.now() - interval * 60 * 1000;
    return await this.db
      .prepare("SELECT * FROM rss_subscriptions WHERE last_fetch_time IS NULL OR last_fetch_time < ?")
      .bind(cutoffTime)
      .all<RSSSubscription>()
      .then((result) => result.results);
  }

  // 待处理动作（目前只有重命名），每个用户最多一条
  async setPendingAction(userId: number, action: string, subId: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pending_actions (user_id, action, sub_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           action = excluded.action,
           sub_id = excluded.sub_id,
           created_at = excluded.created_at`,
      )
      .bind(userId, action, subId, Date.now())
      .run();
  }

  async getPendingAction(userId: number): Promise<PendingAction | null> {
    return await this.db.prepare("SELECT * FROM pending_actions WHERE user_id = ?").bind(userId).first<PendingAction>();
  }

  async clearPendingAction(userId: number): Promise<void> {
    await this.db.prepare("DELETE FROM pending_actions WHERE user_id = ?").bind(userId).run();
  }
}

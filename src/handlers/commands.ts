import { TelegramMessage as Message } from "@codebam/cf-workers-telegram-bot";
import { Database, subscriptionName } from "../utils/db";
import { RSSUtil } from "../utils/rss";
import { downloadFile, sendDocument, sendMarkdownV2, sendMessage } from "../utils/tgapi";
import { getMessage, normalizeLanguage } from "../utils/i18n";
import { parseCommand } from "../utils/command";
import { MAX_IMPORT_FEEDS, buildOpml, parseOpml } from "../utils/opml";
import {
  MAX_NAME_LENGTH,
  articleCard,
  feedDetailCard,
  feedDetailKeyboard,
  feedListCard,
  feedListKeyboard,
  languageCard,
  languageKeyboard,
  unsubListCard,
  unsubListKeyboard,
} from "../utils/card";

/** 重命名等「下一步输入」请求的有效期，超过则视为过期 */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** 单个 OPML 文件大小上限。Telegram getFile 上限 20MB，这里远低于它以免单次导入跑太久 */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export class CommandHandler {
  constructor(private db: Database, private rssUtil: RSSUtil, private token: string) {}

  async sendMessage(chatId: number, text: string, options?: Record<string, any>) {
    return await sendMessage(this.token, chatId, text, options);
  }

  async handleStart(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const helpText = getMessage(lang, "help");
    await this.sendMessage(message.chat.id, helpText, { disable_web_page_preview: true });
  }

  /**
   * /lang [zh|en]
   * 带参数直接切换；不带参数弹出语言选择键盘。
   */
  async handleLanguage(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const { arg } = parseCommand(message.text);

    if (!arg) {
      await sendMarkdownV2(this.token, message.chat.id, languageCard(lang), {
        reply_markup: { inline_keyboard: languageKeyboard(lang) },
      });
      return;
    }

    const target = normalizeLanguage(arg);
    if (!target) {
      await this.sendMessage(message.chat.id, getMessage(lang, "lang_invalid"));
      return;
    }

    await this.db.setUserLanguage(userId, target);
    await this.sendMessage(message.chat.id, getMessage(target, "lang_switched"));
  }

  /**
   * /sub <rss_url> [名字]
   * 名字取 URL 之后的全部内容，允许带空格；缺省时用 feed title 填充。
   */
  async handleSubscribe(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const { arg: feedUrl, rest: name } = parseCommand(message.text);
    if (!feedUrl) {
      await this.sendMessage(message.chat.id, getMessage(lang, "url_required"));
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      await this.sendMessage(message.chat.id, getMessage(lang, "name_too_long", { max: MAX_NAME_LENGTH }));
      return;
    }

    try {
      // 先尝试获取 feed，确保 URL 有效
      const { items, feedTitle } = await this.rssUtil.fetchFeed(feedUrl);
      const displayName = name || feedTitle;

      const isNew = await this.db.addSubscription(userId, feedUrl, feedTitle, name || undefined);

      if (items.length > 0) {
        // 首次订阅只推最新一条，这里同样把 guid 记下来，避免定时任务重复推送
        await this.db.updateLastFetch(userId, feedUrl, Date.now(), items[0].guid);

        await this.sendMessage(
          message.chat.id,
          getMessage(lang, isNew ? "subscribe_success" : "subscribe_updated", { title: displayName, url: feedUrl }),
        );
        await sendMarkdownV2(this.token, message.chat.id, articleCard(items[0], displayName, lang));
      } else {
        await this.sendMessage(
          message.chat.id,
          getMessage(lang, isNew ? "subscribe_success_no_articles" : "subscribe_updated", {
            title: displayName,
            url: feedUrl,
          }),
        );
      }
    } catch (error) {
      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "subscribe_failed", { error: error instanceof Error ? error.message : "Unknown error" }),
      );
    }
  }

  /**
   * /unsub [URL 或名字]
   * 带参数直接退订；不带参数列出订阅，点按钮直接退订。
   */
  async handleUnsubscribe(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const { arg } = parseCommand(message.text);
    const subscriptions = await this.db.listSubscriptions(userId);

    if (!arg) {
      if (subscriptions.length === 0) {
        await this.sendMessage(message.chat.id, getMessage(lang, "list_empty"));
        return;
      }
      await sendMarkdownV2(this.token, message.chat.id, unsubListCard(subscriptions, lang), {
        reply_markup: { inline_keyboard: unsubListKeyboard(subscriptions, lang) },
      });
      return;
    }

    const needle = arg.trim().toLowerCase();
    // URL 精确匹配优先，其次按展示名匹配
    const byUrl = subscriptions.filter((sub) => sub.feed_url.toLowerCase() === needle);
    const byName = subscriptions.filter((sub) => subscriptionName(sub).trim().toLowerCase() === needle);
    const matches = byUrl.length > 0 ? byUrl : byName;

    if (matches.length === 0) {
      await this.sendMessage(message.chat.id, getMessage(lang, "unsub_not_found", { query: arg }));
      return;
    }
    if (matches.length > 1) {
      await this.sendMessage(message.chat.id, getMessage(lang, "unsub_ambiguous", { name: arg }));
      return;
    }

    const target = matches[0];
    try {
      await this.db.removeSubscription(userId, target.feed_url);
      await this.sendMessage(message.chat.id, getMessage(lang, "unsubscribe_success", { name: subscriptionName(target) }));
    } catch (error) {
      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "unsubscribe_failed", { error: error instanceof Error ? error.message : "Unknown error" }),
      );
    }
  }

  /** /list：发一条带按钮的卡片，点名字进入详情 */
  async handleList(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const subscriptions = await this.db.listSubscriptions(userId);
    if (subscriptions.length === 0) {
      await this.sendMessage(message.chat.id, getMessage(lang, "list_empty"));
      return;
    }

    await sendMarkdownV2(this.token, message.chat.id, feedListCard(subscriptions, lang), {
      reply_markup: { inline_keyboard: feedListKeyboard(subscriptions, lang) },
    });
  }

  /**
   * 处理非命令的普通文本：目前只有「重命名」会进入这个流程。
   * 没有待处理动作时静默忽略，避免机器人对闲聊有反应。
   */
  async handleFreeText(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const pending = await this.db.getPendingAction(userId);
    if (!pending || pending.sub_id == null) return;

    const lang = await this.db.getUserLanguage(userId);
    if (Date.now() - pending.created_at > PENDING_TTL_MS) {
      await this.db.clearPendingAction(userId);
      await this.sendMessage(message.chat.id, getMessage(lang, "rename_expired"));
      return;
    }

    if (pending.action !== "rename") return;

    const name = (message.text ?? "").trim();
    if (!name) return;
    if (name.length > MAX_NAME_LENGTH) {
      await this.sendMessage(message.chat.id, getMessage(lang, "name_too_long", { max: MAX_NAME_LENGTH }));
      return;
    }

    await this.db.updateSubscriptionName(userId, pending.sub_id, name);
    await this.db.clearPendingAction(userId);

    const sub = await this.db.getSubscription(userId, pending.sub_id);
    if (!sub) {
      await this.sendMessage(message.chat.id, getMessage(lang, "feed_not_found"));
      return;
    }

    await this.sendMessage(message.chat.id, getMessage(lang, "rename_success", { name }));
    await sendMarkdownV2(this.token, message.chat.id, feedDetailCard(sub, lang), {
      reply_markup: { inline_keyboard: feedDetailKeyboard(sub, lang) },
    });
  }

  /** /cancel：清掉待处理动作 */
  async handleCancel(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const pending = await this.db.getPendingAction(userId);
    if (!pending) {
      await this.sendMessage(message.chat.id, getMessage(lang, "cancel_help"));
      return;
    }

    await this.db.clearPendingAction(userId);
    await this.sendMessage(message.chat.id, getMessage(lang, "rename_cancelled"));
  }

  /** /export：把当前订阅导出成 OPML 文件发给用户 */
  async handleExport(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    const subscriptions = await this.db.listSubscriptions(userId);
    if (subscriptions.length === 0) {
      await this.sendMessage(message.chat.id, getMessage(lang, "export_empty"));
      return;
    }

    try {
      const opml = buildOpml(subscriptions.map((sub) => ({ title: subscriptionName(sub), xmlUrl: sub.feed_url })));
      await sendDocument(this.token, message.chat.id, "subscriptions.opml", opml, {
        caption: getMessage(lang, "export_caption", { count: subscriptions.length }),
      });
    } catch (error) {
      console.error("导出 OPML 失败:", error);
      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "export_failed", { error: error instanceof Error ? error.message : "Unknown error" }),
      );
    }
  }

  /** /import：只是提示，真正的导入由 handleDocument 完成 */
  async handleImport(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const lang = await this.db.getUserLanguage(userId);
    await this.sendMessage(message.chat.id, getMessage(lang, "import_hint"));
  }

  /**
   * 收到文件即尝试按 OPML 导入（不依赖 /import 命令，省掉一次交互状态）。
   * Worker 免费版单次请求的子请求上限是 50，所以按 MAX_IMPORT_FEEDS 限流。
   */
  async handleDocument(message: Message): Promise<void> {
    const userId = message.from?.id;
    if (!userId) return;

    const document = message.document;
    if (!document) return;

    const lang = await this.db.getUserLanguage(userId);
    const fileName = (document.file_name ?? "").toLowerCase();
    const mimeType = (document.mime_type ?? "").toLowerCase();
    const looksLikeOpml = /\.(opml|xml)$/.test(fileName) || /(opml|xml)/.test(mimeType);
    if (!looksLikeOpml) {
      await this.sendMessage(message.chat.id, getMessage(lang, "import_invalid_file"));
      return;
    }

    if (document.file_size > MAX_IMPORT_BYTES) {
      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "import_file_too_large", { max: MAX_IMPORT_BYTES / 1024 / 1024 }),
      );
      return;
    }

    try {
      const xml = await downloadFile(this.token, document.file_id);
      const feeds = parseOpml(xml);
      if (feeds.length === 0) {
        await this.sendMessage(message.chat.id, getMessage(lang, "import_no_feeds"));
        return;
      }

      const targets = feeds.slice(0, MAX_IMPORT_FEEDS);
      let imported = 0;
      let failed = 0;

      for (const feed of targets) {
        try {
          const { items, feedTitle } = await this.rssUtil.fetchFeed(feed.xmlUrl);
          await this.db.addSubscription(userId, feed.xmlUrl, feedTitle, feed.title);
          // 导入时把当前最新一篇记为已读，避免一次性把整个历史推给用户
          if (items.length > 0) {
            await this.db.updateLastFetch(userId, feed.xmlUrl, Date.now(), items[0].guid);
          }
          imported += 1;
        } catch (error) {
          console.error(`导入订阅失败 ${feed.xmlUrl}:`, error);
          failed += 1;
        }
      }

      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "import_result", { imported, failed, skipped: feeds.length - targets.length }),
      );
    } catch (error) {
      console.error("导入 OPML 失败:", error);
      await this.sendMessage(
        message.chat.id,
        getMessage(lang, "import_failed", { error: error instanceof Error ? error.message : "Unknown error" }),
      );
    }
  }
}

import { Database, subscriptionName } from "./utils/db";
import { RSSUtil } from "./utils/rss";
import { CommandHandler } from "./handlers/commands";
import { CallbackHandler, CallbackQuery } from "./handlers/callbacks";
import { TelegramMessage } from "@codebam/cf-workers-telegram-bot";
import { sendMarkdownV2 } from "./utils/tgapi";
import { getMessage } from "./utils/i18n";
import { parseCommand } from "./utils/command";
import { articleCard } from "./utils/card";

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  UPDATE_INTERVAL: number;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const db = new Database(env.DB);
    const rssUtil = new RSSUtil(env.UPDATE_INTERVAL);
    const commandHandler = new CommandHandler(
      db,
      rssUtil,
      env.TELEGRAM_BOT_TOKEN,
    );

    if (request.method !== "POST") {
      return new Response("OK");
    }

    const update = (await request.json()) as TelegramUpdate;

    // 内联按钮的回调：Telegram 会把它发到同一个 webhook
    if (update.callback_query) {
      const callbackHandler = new CallbackHandler(db, env.TELEGRAM_BOT_TOKEN);
      await callbackHandler.handle(update.callback_query);
      return new Response("OK");
    }

    const message = update.message;
    if (!message) {
      return new Response("OK");
    }

    // 用户上传的文件：当作 OPML 导入请求
    if (message.document) {
      try {
        await commandHandler.handleDocument(message);
      } catch (error) {
        console.error("Error handling document:", error);
      }
      return new Response("OK");
    }

    if (!message.text) {
      return new Response("OK");
    }

    const { command } = parseCommand(message.text);
    console.log("command:", command);
    try {
      // 普通文本：可能是重命名的下一步输入
      if (!command.startsWith("/")) {
        await commandHandler.handleFreeText(message);
        return new Response("OK");
      }

      switch (command) {
        case "/start":
        case "/help":
          await commandHandler.handleStart(message);
          break;
        case "/sub":
          await commandHandler.handleSubscribe(message);
          break;
        case "/unsub":
          await commandHandler.handleUnsubscribe(message);
          break;
        case "/list":
          await commandHandler.handleList(message);
          break;
        case "/lang":
          await commandHandler.handleLanguage(message);
          break;
        case "/cancel":
          await commandHandler.handleCancel(message);
          break;
        case "/export":
          await commandHandler.handleExport(message);
          break;
        case "/import":
          await commandHandler.handleImport(message);
          break;
      }
    } catch (error) {
      console.error("Error handling command:", error);
      const lang = await db.getUserLanguage(message.from?.id || 0);
      await commandHandler.sendMessage(
        message.chat.id,
        getMessage(lang, "error_processing"),
      );
    }

    return new Response("OK");
  },

  async scheduled(
    _event: ScheduledEvent | null,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    console.log("scheduled event triggered at ", new Date().toISOString());
    const db = new Database(env.DB);
    const rssUtil = new RSSUtil(env.UPDATE_INTERVAL);

    try {
      // 获取所有需要更新的订阅
      const subscriptions = await db.getSubscriptionsToUpdate(
        env.UPDATE_INTERVAL,
      );
      const fetchPromises = subscriptions.map(async (sub) => {
        try {
          const { items } = await rssUtil.fetchFeed(sub.feed_url);
          const lastItemGuid = sub.last_item_guid;

          // 找到上次发送的文章的索引
          const lastIndex = lastItemGuid
            ? items.findIndex((item) => item.guid === lastItemGuid)
            : -1;
          // 如果找到了上次的文章,则发送它之前的所有新文章;如果是首次订阅,只发送最新的一条
          const newItems =
            lastIndex >= 0 ? items.slice(0, lastIndex) : items.slice(0, 1);

          if (newItems.length > 0) {
            const lang = await db.getUserLanguage(sub.user_id);
            const rssName = subscriptionName(sub);

            // 发送更新通知
            const messages = newItems
              .sort((a, b) =>
                a.pubDate && b.pubDate
                  ? new Date(a.pubDate).getTime() -
                    new Date(b.pubDate).getTime()
                  : a.pubDate
                    ? 1
                    : 0,
              )
              .map((item) => articleCard(item, rssName, lang));
            for (const text of messages) {
              await sendMarkdownV2(env.TELEGRAM_BOT_TOKEN, sub.user_id, text);
            }

            // 更新最后获取时间和 GUID
            await db.updateLastFetch(
              sub.user_id,
              sub.feed_url,
              Date.now(),
              items[0].guid,
            );
          }
        } catch (error) {
          console.error(
            `Error processing subscription ${sub.feed_url}:`,
            error,
          );
        }
      });
      await Promise.all(fetchPromises);
    } catch (error) {
      console.error("Error in scheduled task:", error);
    }
  },
};

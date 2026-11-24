import { Database, subscriptionName } from "../utils/db";
import { Language, getMessage, normalizeLanguage } from "../utils/i18n";
import {
  CALLBACK_ACTION,
  CancelContext,
  InlineKeyboard,
  feedDetailCard,
  feedDetailKeyboard,
  feedListCard,
  feedListKeyboard,
  unsubListCard,
  unsubListKeyboard,
} from "../utils/card";
import {
  answerCallbackQuery,
  deleteMessage,
  editMarkdownV2,
  editMessageReplyMarkup,
  sendMarkdownV2,
  sendMessage,
} from "../utils/tgapi";
import { escapeV2 } from "../utils/markdown";

/** Webhook 收到的 callback_query 更新；@codebam 的类型包没有导出这个类型 */
export interface CallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: {
    message_id: number;
    chat: { id: number };
  };
}

/** 取消按钮的上下文 → 取消后要发的提示文案 */
const CANCEL_MESSAGE_KEY = {
  list: "cancel_list",
  unsub: "cancel_unsub",
  lang: "cancel_lang",
} as const;

/** answerCallbackQuery 的提示文本上限 200 字符，超了会整条调用失败 */
function toast(text: string): string {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * 处理内联按钮回调。
 * 所有订阅查询都带 user_id 限定，别人点到自己看不到的按钮只会得到「找不到订阅」。
 */
export class CallbackHandler {
  constructor(private db: Database, private token: string) {}

  async handle(query: CallbackQuery): Promise<void> {
    const userId = query.from.id;
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const data = query.data ?? "";
    const lang = await this.db.getUserLanguage(userId);

    if (chatId === undefined || messageId === undefined) {
      // 来自 inline 模式的消息没有可编辑的 chat/message，直接应答结束
      await answerCallbackQuery(this.token, query.id);
      return;
    }

    try {
      const [prefix, action, payload = ""] = data.split(":");
      if (prefix !== "f") {
        await answerCallbackQuery(this.token, query.id);
        return;
      }

      switch (action) {
        // 详情卡里的「返回列表」
        case CALLBACK_ACTION.list:
          await answerCallbackQuery(this.token, query.id);
          await this.renderList(chatId, messageId, userId, lang);
          return;

        // 各列表底部的「取消」：撤回消息 + 发一条取消提示
        case CALLBACK_ACTION.cancel: {
          await answerCallbackQuery(this.token, query.id);
          const context: CancelContext = payload === "unsub" || payload === "lang" ? payload : "list";
          await this.closeMessage(chatId, messageId);
          await sendMessage(this.token, chatId, getMessage(lang, CANCEL_MESSAGE_KEY[context]));
          return;
        }

        // 语言切换：载荷是语言码，不需要订阅 id
        case CALLBACK_ACTION.lang: {
          const target = normalizeLanguage(payload);
          if (!target) {
            await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "lang_invalid")));
            return;
          }
          await this.db.setUserLanguage(userId, target);
          const message = getMessage(target, "lang_switched");
          await answerCallbackQuery(this.token, query.id, toast(message));
          await this.closeMessage(chatId, messageId);
          await sendMessage(this.token, chatId, message);
          return;
        }
      }

      // 其余动作的载荷是订阅 id
      const id = Number(payload);
      if (!Number.isInteger(id) || id <= 0) {
        await answerCallbackQuery(this.token, query.id);
        return;
      }

      const sub = await this.db.getSubscription(userId, id);
      if (!sub) {
        await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "feed_not_found")));
        return;
      }

      switch (action) {
        case CALLBACK_ACTION.detail:
          await answerCallbackQuery(this.token, query.id);
          await this.render(chatId, messageId, feedDetailCard(sub, lang), feedDetailKeyboard(sub, lang));
          return;

        case CALLBACK_ACTION.remove:
          await this.db.removeSubscriptionById(userId, id);
          await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "toast_unsubscribed")));
          await this.renderList(chatId, messageId, userId, lang);
          return;

        // /unsub 列表里直接退订，退完后重新渲染待退订列表
        case CALLBACK_ACTION.unsub:
          await this.db.removeSubscriptionById(userId, id);
          await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "toast_unsubscribed")));
          await this.renderUnsubList(chatId, messageId, userId, lang);
          return;

        case CALLBACK_ACTION.rename:
          await this.db.setPendingAction(userId, "rename", id);
          await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "rename_prompt")));
          // 提示用户下一条消息会被当作新名字
          await sendMessage(
            this.token,
            chatId,
            `✏️ ${subscriptionName(sub)}\n\n${getMessage(lang, "rename_prompt")}`,
          );
          return;

        default:
          await answerCallbackQuery(this.token, query.id);
      }
    } catch (error) {
      console.error(`Error handling callback data "${data}":`, error);
      await answerCallbackQuery(this.token, query.id, toast(getMessage(lang, "error_processing")));
    }
  }

  private async renderList(chatId: number, messageId: number, userId: number, lang: Language): Promise<void> {
    const subscriptions = await this.db.listSubscriptions(userId);
    if (subscriptions.length === 0) {
      // render 走的是直发 MarkdownV2 通道，纯文案必须先转义
      await this.render(chatId, messageId, escapeV2(getMessage(lang, "list_empty")), []);
      return;
    }
    await this.render(chatId, messageId, feedListCard(subscriptions, lang), feedListKeyboard(subscriptions, lang));
  }

  private async renderUnsubList(chatId: number, messageId: number, userId: number, lang: Language): Promise<void> {
    const subscriptions = await this.db.listSubscriptions(userId);
    if (subscriptions.length === 0) {
      await this.render(chatId, messageId, escapeV2(getMessage(lang, "list_empty")), []);
      return;
    }
    await this.render(chatId, messageId, unsubListCard(subscriptions, lang), unsubListKeyboard(subscriptions, lang));
  }

  /**
   * 撤掉这条消息。超过 48 小时的消息删不掉，
   * 退化为用 editMessageReplyMarkup 清空按钮（不动正文）。
   */
  private async closeMessage(chatId: number, messageId: number): Promise<void> {
    try {
      await deleteMessage(this.token, chatId, messageId);
    } catch (error) {
      console.error("deleteMessage failed, clearing the keyboard instead:", error);
      try {
        await editMessageReplyMarkup(this.token, chatId, messageId, { inline_keyboard: [] });
      } catch (markupError) {
        console.error("failed to clear the keyboard:", markupError);
      }
    }
  }

  /** 优先原地编辑；消息被删除或内容未变化时退化为新发一条 */
  private async render(chatId: number, messageId: number, text: string, keyboard: InlineKeyboard): Promise<void> {
    const replyMarkup = { inline_keyboard: keyboard };
    try {
      await editMarkdownV2(this.token, chatId, messageId, text, { reply_markup: replyMarkup });
    } catch (error) {
      console.error("editMessageText failed, sending a new message instead:", error);
      // 退化发送也失败时必须上抛，否则用户看到的是“点了没反应”
      const sent = await sendMarkdownV2(this.token, chatId, text, { reply_markup: replyMarkup });
      if (!sent) {
        throw new Error("fallback sendMessage failed");
      }
    }
  }
}

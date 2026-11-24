import { RSSSubscription, subscriptionName } from "./db";
import { Language, getMessage } from "./i18n";
import { boldV2, escapeV2, joinV2, linkV2 } from "./markdown";
import { FeedItem } from "./rss";

/** 订阅名长度上限，重命名时校验 */
export const MAX_NAME_LENGTH = 64;
/** 按钮文字过长时截断，避免键盘被撑爆 */
const BUTTON_TEXT_MAX = 40;

interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];

/**
 * callback_data 格式：`f:<动作>:<载荷>`。
 * 载荷可以是订阅 id、语言码或取消上下文；无载荷的动作写成 `f:<动作>`。
 * Telegram 限制 1-64 bytes，所以用 id 而不是 feed_url。
 */
export const CALLBACK_ACTION = {
  detail: "d",
  remove: "x",
  rename: "r",
  list: "l",
  /** /unsub 列表里点一下直接退订 */
  unsub: "u",
  /** 语言切换，载荷是语言码 */
  lang: "g",
  /** 取消，载荷是上下文：list / unsub / lang */
  cancel: "c",
} as const;

/** 取消按钮的上下文，决定取消后发哪句提示 */
export type CancelContext = "list" | "unsub" | "lang";

export function feedDetailCallback(id: number): string {
  return `f:${CALLBACK_ACTION.detail}:${id}`;
}

export function feedRemoveCallback(id: number): string {
  return `f:${CALLBACK_ACTION.remove}:${id}`;
}

export function feedRenameCallback(id: number): string {
  return `f:${CALLBACK_ACTION.rename}:${id}`;
}

export const FEED_LIST_CALLBACK = `f:${CALLBACK_ACTION.list}`;

/** /unsub 列表：点一下直接退订 */
export function unsubCallback(id: number): string {
  return `f:${CALLBACK_ACTION.unsub}:${id}`;
}

/** 语言切换按钮 */
export function langCallback(code: Language): string {
  return `f:${CALLBACK_ACTION.lang}:${code}`;
}

/** 取消按钮：带上下文，以便取消后发对应的提示 */
export function cancelCallback(context: CancelContext): string {
  return `f:${CALLBACK_ACTION.cancel}:${context}`;
}

/** Worker 跑在 UTC 上，统一按 UTC 展示，避免不同环境的时区差异 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function formatPubDate(pubDate?: string): string {
  if (!pubDate) return "";
  const time = new Date(pubDate);
  return Number.isNaN(time.getTime()) ? "" : formatTime(time.getTime());
}

function truncateButton(text: string): string {
  return text.length > BUTTON_TEXT_MAX ? `${text.slice(0, BUTTON_TEXT_MAX - 1)}…` : text;
}

/**
 * 文章推送卡片：
 * 📰 来源名 / 加粗标题 / 阅读全文 + 时间
 */
export function articleCard(item: FeedItem, rssName: string, lang: Language): string {
  const prefix = getMessage(lang, "article_prefix");
  const readMore = getMessage(lang, "article_read_more");
  const date = formatPubDate(item.pubDate);

  return joinV2([
    `${prefix} ${boldV2(rssName)}`,
    boldV2(item.title),
    `🔗 ${linkV2(readMore, item.link)}${date ? ` · ${escapeV2(date)}` : ""}`,
  ]);
}

/** 订阅详情卡 */
export function feedDetailCard(sub: RSSSubscription, lang: Language): string {
  const fetched = sub.last_fetch_time
    ? getMessage(lang, "detail_fetched", { time: formatTime(sub.last_fetch_time) })
    : getMessage(lang, "detail_never_fetched");

  // 注意：带日期的时间串里有 `-`，属于 MarkdownV2 保留字符，
  // 拼接进卡片前必须整体过 escapeV2，否则 editMessageText 会报 can't parse entities。
  return joinV2([
    `📰 ${boldV2(subscriptionName(sub))}`,
    [
      escapeV2(sub.feed_url),
      escapeV2(getMessage(lang, "detail_subscribed", { time: formatTime(sub.created_at) })),
      escapeV2(fetched),
    ].join("\n"),
  ]);
}

export function feedDetailKeyboard(sub: RSSSubscription, lang: Language): InlineKeyboard {
  const id = sub.id ?? 0;
  return [
    [
      { text: getMessage(lang, "cb_unsubscribe"), callback_data: feedRemoveCallback(id) },
      { text: getMessage(lang, "cb_rename"), callback_data: feedRenameCallback(id) },
    ],
    [{ text: getMessage(lang, "cb_back"), callback_data: FEED_LIST_CALLBACK }],
  ];
}

/** 订阅列表卡（点击按钮进入详情） */
export function feedListCard(subscriptions: RSSSubscription[], lang: Language): string {
  return joinV2([
    boldV2(getMessage(lang, "list_header", { count: subscriptions.length })),
    escapeV2(getMessage(lang, "list_hint")),
  ]);
}

export function feedListKeyboard(subscriptions: RSSSubscription[], lang: Language): InlineKeyboard {
  return [
    ...subscriptions.map((sub) => [
      {
        text: truncateButton(subscriptionName(sub)),
        callback_data: feedDetailCallback(sub.id ?? 0),
      },
    ]),
    [{ text: getMessage(lang, "cb_cancel"), callback_data: cancelCallback("list") }],
  ];
}

/** /unsub 列表卡（点击按钮直接退订） */
export function unsubListCard(subscriptions: RSSSubscription[], lang: Language): string {
  return joinV2([
    boldV2(getMessage(lang, "unsub_pick_header", { count: subscriptions.length })),
    escapeV2(getMessage(lang, "unsub_pick_hint")),
  ]);
}

export function unsubListKeyboard(subscriptions: RSSSubscription[], lang: Language): InlineKeyboard {
  return [
    ...subscriptions.map((sub) => [
      {
        text: truncateButton(subscriptionName(sub)),
        callback_data: unsubCallback(sub.id ?? 0),
      },
    ]),
    [{ text: getMessage(lang, "cb_cancel"), callback_data: cancelCallback("unsub") }],
  ];
}

/** /lang 无参数时的语言选择卡 */
export function languageCard(lang: Language): string {
  return joinV2([
    boldV2(getMessage(lang, "lang_picker_header")),
    escapeV2(getMessage(lang, "lang_current", { lang: getMessage(lang, `lang_name_${lang}`) })),
  ]);
}

export function languageKeyboard(lang: Language): InlineKeyboard {
  return [
    [
      { text: getMessage(lang, "lang_name_zh"), callback_data: langCallback("zh") },
      { text: getMessage(lang, "lang_name_en"), callback_data: langCallback("en") },
    ],
    [{ text: getMessage(lang, "cb_cancel"), callback_data: cancelCallback("lang") }],
  ];
}

/**
 * Telegram MarkdownV2 原语。
 *
 * 不用 `telegramify-markdown` 拼卡片的原因：卡片需要精确控制粗体/链接结构，
 * 而 telegramify 会把 `>` 一律转义成 `\>`（引用块会失效），不适合做结构化排版。
 * 命令回复等纯文本消息仍走 telegramify（见 tgapi.sendMessage）。
 */

// 官方要求转义的字符集：\_ * [ ] ( ) ~ ` > # + - = | { } . ! 以及 \ 本身
const V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** 把任意纯文本转成可安全放进 MarkdownV2 的内容 */
export function escapeV2(text: string): string {
  return text.replace(V2_SPECIAL, (char) => `\\${char}`);
}

/** 粗体。参数是纯文本，内部会自动转义 */
export function boldV2(text: string): string {
  return `*${escapeV2(text)}*`;
}

/** 行内链接。显示文本走转义，URL 只需转义 `)` 与 `\` */
export function linkV2(text: string, url: string): string {
  const safeUrl = url.replace(/[)\\]/g, (char) => `\\${char}`);
  return `[${escapeV2(text)}](${safeUrl})`;
}

/** 丢弃空块后用空行拼接，避免出现 Telegram 不允许的连续空行 */
export function joinV2(blocks: (string | undefined | null | false)[]): string {
  return blocks.filter((block): block is string => Boolean(block && block.trim())).join("\n\n");
}

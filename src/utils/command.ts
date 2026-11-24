interface ParsedCommand {
  /** 已剥离 `@botname` 后缀的命令，例如 `/sub` */
  command: string;
  /** 第一个参数，例如 RSS URL */
  arg: string;
  /** 第一个参数之后的全部内容（保留内部空格），例如订阅名 */
  rest: string;
}

/**
 * 解析 Telegram 消息文本。
 * - 群里发送的是 `/sub@YourBot url`，必须剥离 `@botname`，否则命令永远匹配不上
 * - `/sub url 我的 博客` 的 `rest` 是 `我的 博客`，允许名字带空格
 */
export function parseCommand(text: string | undefined): ParsedCommand {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { command: "", arg: "", rest: "" };

  const spaceIndex = trimmed.search(/\s/);
  const head = spaceIndex < 0 ? trimmed : trimmed.slice(0, spaceIndex);
  const tail = spaceIndex < 0 ? "" : trimmed.slice(spaceIndex + 1).trim();

  const command = head.startsWith("/") ? head.split("@")[0] : head;
  if (!tail) return { command, arg: "", rest: "" };

  const argEnd = tail.search(/\s/);
  if (argEnd < 0) return { command, arg: tail, rest: "" };
  return { command, arg: tail.slice(0, argEnd), rest: tail.slice(argEnd + 1).trim() };
}

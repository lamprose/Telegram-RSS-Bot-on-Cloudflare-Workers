import telegramifyMarkdown from "telegramify-markdown";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * 统一的 Bot API 调用入口。失败时打印方法名与错误描述，方便 `wrangler tail` 定位。
 * @throws 调用失败时抛出，交由调用方决定是否提示用户
 */
async function callApi<T = unknown>(botToken: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!response.ok || !data?.ok) {
    const description = data?.description ?? (await response.text().catch(() => ""));
    console.error(`Telegram API ${method} failed (HTTP ${response.status}): ${description}`);
    throw new Error(`${method} failed: ${description || response.status}`);
  }

  return data.result as T;
}

/**
 * 发送消息，正文按 Markdown 书写并经 telegramify-markdown 转成 MarkdownV2。
 * 用户输入的内容由 telegramify 负责转义，调用方可以直接拼 Markdown 语法。
 */
async function sendMessage(bot_token: string, chatId: number, text: string, options?: Record<string, any>) {
  try {
    return await callApi(bot_token, "sendMessage", {
      chat_id: chatId,
      text: telegramifyMarkdown(text, "escape"),
      parse_mode: options?.parse_mode || "MarkdownV2",
      ...options,
    });
  } catch (error) {
    console.error("sendMessage error:", error);
  }
}

/**
 * 直接发送已经拼好的 MarkdownV2 文本。
 * 用于卡片类消息：内容由 src/utils/markdown.ts 自行转义，不能再过一遍 telegramify。
 */
async function sendMarkdownV2(bot_token: string, chatId: number, text: string, options?: Record<string, any>) {
  try {
    return await callApi(bot_token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      ...options,
    });
  } catch (error) {
    console.error("sendMarkdownV2 error:", error);
  }
}

/** 编辑已发送的消息为新的 MarkdownV2 文本（回调按钮的详情/列表切换） */
async function editMarkdownV2(bot_token: string, chatId: number, messageId: number, text: string, options?: Record<string, any>) {
  return await callApi(bot_token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "MarkdownV2",
    ...options,
  });
}

/** 回应回调，不调会让客户端一直转圈 */
async function answerCallbackQuery(bot_token: string, callbackQueryId: string, text?: string) {
  try {
    return await callApi(bot_token, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  } catch (error) {
    console.error("answerCallbackQuery error:", error);
  }
}

/** 删除一条消息；超过 48 小时或已删除时 Telegram 会报错，由调用方处理 */
async function deleteMessage(bot_token: string, chatId: number, messageId: number) {
  return await callApi(bot_token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

/** 只改按钮不改正文，用于消息删不掉时“关闭”交互 */
async function editMessageReplyMarkup(bot_token: string, chatId: number, messageId: number, replyMarkup: unknown) {
  return await callApi(bot_token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

/**
 * 直接上传一段文本作为文件（用 multipart，不能走 callApi 的 JSON 通道）。
 * 注意不要手动设 Content-Type，浏览器/Workers 会自动带 boundary。
 */
async function sendDocument(
  bot_token: string,
  chatId: number,
  filename: string,
  content: string,
  options?: { caption?: string; contentType?: string },
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([content], { type: options?.contentType ?? "text/x-opml" }), filename);
  if (options?.caption) form.append("caption", options.caption);

  const response = await fetch(`https://api.telegram.org/bot${bot_token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as TelegramApiResponse<unknown> | null;
  if (!response.ok || !data?.ok) {
    const description = data?.description ?? `HTTP ${response.status}`;
    console.error(`Telegram API sendDocument failed: ${description}`);
    throw new Error(`sendDocument failed: ${description}`);
  }
  return data.result;
}

/**
 * 下载用户上传的文件。Telegram 只给 file_id，需要先 getFile 拿 file_path，
 * 再从 /file/bot<token>/<file_path> 拉取。
 */
async function downloadFile(bot_token: string, fileId: string): Promise<string> {
  const file = await callApi<{ file_path?: string }>(bot_token, "getFile", { file_id: fileId });
  if (!file?.file_path) {
    throw new Error("getFile 未返回 file_path");
  }

  const response = await fetch(`https://api.telegram.org/file/bot${bot_token}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`下载文件失败 HTTP ${response.status}`);
  }
  return await response.text();
}

export { sendMessage, sendMarkdownV2, editMarkdownV2, editMessageReplyMarkup, answerCallbackQuery, deleteMessage, sendDocument, downloadFile };

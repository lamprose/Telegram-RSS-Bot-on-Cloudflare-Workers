export type Language = "zh" | "en";

interface Messages {
  help: string;
  subscribe_success: string;
  subscribe_success_no_articles: string;
  subscribe_failed: string;
  unsubscribe_success: string;
  unsubscribe_failed: string;
  subscribe_updated: string;
  toast_unsubscribed: string;
  list_empty: string;
  list_header: string;
  list_hint: string;
  url_required: string;
  error_processing: string;
  article_prefix: string;
  article_read_more: string;
  cb_unsubscribe: string;
  cb_rename: string;
  cb_back: string;
  cb_cancel: string;
  detail_subscribed: string;
  detail_fetched: string;
  detail_never_fetched: string;
  feed_not_found: string;
  rename_prompt: string;
  rename_success: string;
  rename_cancelled: string;
  rename_expired: string;
  name_too_long: string;
  cancel_help: string;
  cancel_list: string;
  cancel_unsub: string;
  cancel_lang: string;
  unsub_pick_header: string;
  unsub_pick_hint: string;
  unsub_not_found: string;
  unsub_ambiguous: string;
  lang_picker_header: string;
  lang_current: string;
  lang_name_zh: string;
  lang_name_en: string;
  lang_switched: string;
  lang_invalid: string;
  export_empty: string;
  export_caption: string;
  export_failed: string;
  import_hint: string;
  import_invalid_file: string;
  import_no_feeds: string;
  import_result: string;
  import_failed: string;
  import_file_too_large: string;
}

const messages: Record<Language, Messages> = {
  zh: {
    help: `RSS Bot [仓库地址与部署说明](https://github.com/lxl66566/Telegram-RSS-Bot-on-Cloudflare-Workers)

/sub <rss_url> [名字] - 订阅一个 RSS 源，名字可缺省
/unsub [URL 或名字] - 取消订阅；不带参数则列出订阅供点选
/list - 查看订阅列表，点名字可重命名或退订
/start - 显示此帮助信息
/help - 显示此帮助信息
/lang [zh|en] - 切换语言；不带参数则弹出选择，输入框旁菜单同效
/cancel - 取消当前操作
/export - 导出订阅为 OPML 文件
/import - 导入 OPML 文件（发送文件即可）`,
    subscribe_success: "成功订阅 RSS 源：[{title}]({url})",
    subscribe_success_no_articles: "成功订阅 RSS 源：[{title}]({url})\n\n当前没有任何文章",
    subscribe_failed: "订阅失败：{error}",
    unsubscribe_success: "已取消订阅：{name}",
    unsubscribe_failed: "取消订阅失败：{error}",
    subscribe_updated: "已更新订阅：[{title}]({url})",
    toast_unsubscribed: "✅ 已取消订阅",
    list_empty: "还没有订阅任何 RSS 源\n\n用 /sub <rss_url> [名字] 添加一个",
    list_header: "📚 你的订阅（{count}）",
    list_hint: "点击下方按钮查看详情，可重命名或取消订阅。",
    url_required: "请提供 RSS 源的 URL",
    error_processing: "处理命令时发生错误，请稍后重试",
    article_prefix: "📰",
    article_read_more: "阅读全文",
    cb_unsubscribe: "🔕 取消订阅",
    cb_rename: "✏️ 重命名",
    cb_back: "⬅️ 返回列表",
    cb_cancel: "✖️ 取消",
    detail_subscribed: "📅 订阅于 {time}",
    detail_fetched: "🔄 最近抓取 {time}",
    detail_never_fetched: "🔄 尚未抓取过",
    feed_not_found: "找不到该订阅，可能已被删除",
    rename_prompt: "请直接发送新的名字（发送 /cancel 取消）",
    rename_success: "已重命名为「{name}」",
    rename_cancelled: "已取消重命名",
    rename_expired: "重命名请求已过期，请重新在 /list 中点击按钮",
    name_too_long: "名字过长，请控制在 {max} 个字符以内",
    cancel_help: "没有正在进行的操作",
    cancel_list: "已取消查看订阅列表",
    cancel_unsub: "已取消退订操作",
    cancel_lang: "已取消切换语言",
    unsub_pick_header: "🔕 选择要退订的订阅（{count}）",
    unsub_pick_hint: "点击按钮直接取消订阅。",
    unsub_not_found: "找不到该订阅：{query}",
    unsub_ambiguous: "有多个订阅叫「{name}」，请改用 URL 退订",
    lang_picker_header: "🌐 选择语言 / Select language",
    lang_current: "当前语言：{lang}",
    lang_name_zh: "中文",
    lang_name_en: "English",
    lang_switched: "已切换为中文",
    lang_invalid: "不支持该语言，可选：zh / en",
    export_empty: "你还没有订阅任何 RSS 源，没有可导出的内容",
    export_caption: "已导出 {count} 个订阅（OPML）",
    export_failed: "导出失败：{error}",
    import_hint: "把 OPML 文件直接发给我即可导入（支持 .opml / .xml）",
    import_invalid_file: "只支持 .opml / .xml 文件",
    import_no_feeds: "OPML 里没有找到任何 RSS 源",
    import_result: "导入完成：成功 {imported} 个，失败 {failed} 个，超出上限跳过 {skipped} 个",
    import_failed: "导入失败：{error}",
    import_file_too_large: "文件过大，上限 {max} MB",
  },
  en: {
    help: `RSS Bot [Repository & Deployment Guide](https://github.com/lxl66566/Telegram-RSS-Bot-on-Cloudflare-Workers)

/sub <rss_url> [name] - Subscribe to an RSS feed, name is optional
/unsub [URL or name] - Unsubscribe; no argument lists subscriptions to pick
/list - List subscriptions, tap a name to rename or unsubscribe
/start - Show this help message
/help - Show this help message
/lang [zh|en] - Switch language; no argument opens a picker (same as the menu button)
/cancel - Cancel the current operation
/export - Export subscriptions as an OPML file
/import - Import an OPML file (just send the file)`,
    subscribe_success: "Successfully subscribed to RSS feed: [{title}]({url})",
    subscribe_success_no_articles: "Successfully subscribed to RSS feed: [{title}]({url})\n\nNo articles available",
    subscribe_failed: "Subscription failed: {error}",
    unsubscribe_success: "Unsubscribed: {name}",
    unsubscribe_failed: "Unsubscribe failed: {error}",
    subscribe_updated: "Subscription updated: [{title}]({url})",
    toast_unsubscribed: "✅ Unsubscribed",
    list_empty: "No RSS feeds subscribed yet\n\nAdd one with /sub <rss_url> [name]",
    list_header: "📚 Your subscriptions ({count})",
    list_hint: "Tap a button below to view details, rename or unsubscribe.",
    url_required: "Please provide the RSS feed URL",
    error_processing: "Error processing command, please try again later",
    article_prefix: "📰",
    article_read_more: "Read more",
    cb_unsubscribe: "🔕 Unsubscribe",
    cb_rename: "✏️ Rename",
    cb_back: "⬅️ Back to list",
    cb_cancel: "✖️ Cancel",
    detail_subscribed: "📅 Subscribed {time}",
    detail_fetched: "🔄 Last fetched {time}",
    detail_never_fetched: "🔄 Not fetched yet",
    feed_not_found: "Subscription not found, it may have been deleted",
    rename_prompt: "Send the new name as a message (send /cancel to abort)",
    rename_success: "Renamed to \"{name}\"",
    rename_cancelled: "Rename cancelled",
    rename_expired: "Rename request expired, please tap the button in /list again",
    name_too_long: "Name too long, please keep it within {max} characters",
    cancel_help: "Nothing to cancel",
    cancel_list: "Subscription list closed",
    cancel_unsub: "Unsubscribe cancelled",
    cancel_lang: "Language switch cancelled",
    unsub_pick_header: "🔕 Pick a subscription to remove ({count})",
    unsub_pick_hint: "Tap a button to unsubscribe immediately.",
    unsub_not_found: "Subscription not found: {query}",
    unsub_ambiguous: "Multiple subscriptions are named \"{name}\", please unsubscribe by URL",
    lang_picker_header: "🌐 Select language / 选择语言",
    lang_current: "Current language: {lang}",
    lang_name_zh: "中文",
    lang_name_en: "English",
    lang_switched: "Language switched to English",
    lang_invalid: "Unsupported language, available: zh / en",
    export_empty: "You have no subscriptions to export",
    export_caption: "Exported {count} subscriptions (OPML)",
    export_failed: "Export failed: {error}",
    import_hint: "Send me an OPML file and I will import it (.opml / .xml)",
    import_invalid_file: "Only .opml / .xml files are supported",
    import_no_feeds: "No RSS feeds found in this OPML file",
    import_result: "Import finished: {imported} succeeded, {failed} failed, {skipped} skipped (limit reached)",
    import_failed: "Import failed: {error}",
    import_file_too_large: "File too large, limit is {max} MB",
  },
};

/**
 * 把 /lang 的参数归一化成受支持的语言（容许 zh-cn / en-US 这类写法），无法识别时返回 null。
 */
export function normalizeLanguage(input: string): Language | null {
  const value = input.trim().toLowerCase();
  if (value.startsWith("zh")) return "zh";
  if (value.startsWith("en")) return "en";
  return null;
}

/**
 * 取文案并替换占位符。
 * 用 split/join 而非 String.replace，避免用户输入里的 `$&` 之类被当成替换模式。
 */
export function getMessage(lang: Language, key: keyof Messages, params: Record<string, string | number> = {}): string {
  let message = messages[lang][key];
  for (const [name, value] of Object.entries(params)) {
    message = message.split(`{${name}}`).join(String(value));
  }
  return message;
}

# Telegram RSS Bot on Cloudflare Workers 开发指南

## 项目概览

基于 Cloudflare Workers + D1 的 Telegram RSS 订阅机器人：通过 Webhook 接收 Telegram 命令，通过 Cron Trigger 定时抓取 RSS 并向订阅者推送新文章。

## 技术栈

- 语言/运行时：TypeScript 5.7 / Cloudflare Workers（`compatibility_flags = ["nodejs_compat"]`）
- 存储：Cloudflare D1（SQLite），表结构见 `schema.sql`；用户语言另用 Cache API（`caches.default`）缓存
- 包管理：pnpm 9.15（`packageManager` 已锁定，勿改用 npm/yarn）
- 主要依赖：
  - `wrangler` 3.107 — 本地调试与部署，无独立构建步骤（直接 bundle `src/index.ts`）
  - `rss-parser` — RSS/Atom 解析
  - `telegramify-markdown` — 把 Markdown 转为 Telegram `MarkdownV2`
  - `@codebam/cf-workers-telegram-bot` — 仅用于 `TelegramMessage` 类型

## 常用命令

- 安装依赖：`pnpm i`
- 本地调试：`pnpm dev`（wrangler dev）
- 部署：`pnpm deploy`（`wrangler deploy && node scripts/set-commands.mjs`，worker 名 `telegram-rss-bot`）
- 单独同步命令菜单：`pnpm commands`（先 `getMyCommands` 比对，只按 `zh`/`en`/默认三层按需写）
- 强制刷新命令菜单：`pnpm commands --force`（跳过比对，`deleteMyCommands` + `setMyCommands`，用于客户端看不到命令时）
- 设置 bot token：`pnpm token`（wrangler secret put TELEGRAM_BOT_TOKEN）
- 生成绑定类型：`pnpm cf-typegen`（wrangler types）
- 查看线上日志：`wrangler tail telegram-rss-bot`
- 初始化远端数据库：`wrangler d1 execute telegram_rss_bot --file=./schema.sql --remote`
- 测试：`pnpm test` 脚本存在（vitest），但 **vitest 未列入 devDependencies 且仓库暂无测试文件**；`.gitignore` 中 `test*.*` 也排除了测试文件。当前改动靠 `wrangler dev` 手工验证。
- 无 lint / format 配置，改动前后可用 `npx tsc --noEmit` 做类型检查。

## 代码结构

```
src/index.ts             Worker 入口：fetch（Webhook + callback_query）、scheduled（Cron）
src/handlers/commands.ts CommandHandler：/start /help /sub /unsub /list /lang /cancel 与重命名输入
src/handlers/callbacks.ts CallbackHandler：/list 内联按钮的详情、退订、重命名、返回
src/utils/db.ts          Database：D1 查询封装 + 用户语言缓存 + pending_actions
src/utils/rss.ts         RSSUtil：抓取解析 feed（带内存缓存）
src/utils/card.ts        卡片渲染：文章卡、订阅详情卡、订阅列表卡 + 内联键盘
src/utils/markdown.ts   MarkdownV2 原语：escapeV2 / boldV2 / linkV2 / joinV2
src/utils/command.ts    parseCommand：剥离 @botname、拆出 arg 与 rest（名字可含空格）
src/utils/tgapi.ts      callApi 与 sendMessage / sendMarkdownV2 / editMarkdownV2 / answerCallbackQuery
src/utils/i18n.ts       zh/en 文案表与 getMessage
src/utils/bot-commands.json  Telegram 命令菜单的 zh/en 列表（bot-commands 唯一数据源）
scripts/set-commands.mjs 部署后同步命令菜单（getMyCommands 比对 + setMyCommands），供 pnpm commands / pnpm deploy 调用
schema.sql               建表语句（rss_subscriptions、user_settings、pending_actions）
migrations/*.sql         已部署库的手工迁移脚本（无迁移框架）
wrangler.toml            D1 绑定、UPDATE_INTERVAL 变量、cron 触发器
docs/README-zh_CN.md     中文文档（README.md 为英文版）
```

## 代码约定

- 类 + 构造函数注入依赖（`CommandHandler(db, rssUtil, token)`、`Database(env.DB)`），在 `fetch`/`scheduled` 中每次请求新建；不引入全局单例或 DI 框架。
- 命令分发用 `src/index.ts` 里的 `switch (parsed.command)`；**文本解析一律用 `parseCommand()`**（`src/utils/command.ts`），它负责剥离 `/sub@YourBot` 的 `@botname` 并拆出 `arg`（第一个参数）与 `rest`（其余全部，保留内部空格）。不要再手写 `text.split(" ")`。
- **两条发消息通道，不能混用**：
  - `sendMessage()` —— 传 Markdown 源码，内部用 `telegramify-markdown` 转义成 MarkdownV2。适合命令回复、含用户输入的文案。
  - `sendMarkdownV2()` / `editMarkdownV2()` —— 传**已经拼好的 MarkdownV2**，不再二次转义。卡片一律走这条，内容用 `src/utils/markdown.ts` 的 `escapeV2` 转义。混用会双重转义或漏转义。
- 所有 D1 访问集中在 `Database` 类，使用 `prepare().bind().run()/first()/all()`，不写内联 SQL 到 handler。
- 类型约定：D1 行类型用 snake_case 字段（`feed_url`、`last_item_guid`），接口定义在 `src/utils/db.ts`。
- 发送 Telegram 消息统一走 `tgapi.ts` 里的封装，不直接 `fetch` Telegram API；需要新方法时在 `tgapi.ts` 加薄封装并复用 `callApi()`（它统一打日志与抛错）。
- 文案硬编码在 `src/utils/i18n.ts` 的 `messages` 中，通过 `getMessage(lang, key, params)` 取用；新增文案必须同时补齐 `zh` 与 `en`（`Messages` interface 会强制校验）。
- 注释使用简体中文；命名、日志、类型保持英文。

## 注意事项

- **`rss-parser` 只能用 `parseString`，不要用 `parseURL`**：Workers 运行时不支持 `https.get`，`parseURL` 会抛 `[unenv] https.get is not implemented yet!`。
- **`UPDATE_INTERVAL` 与 cron 必须同步改**：`wrangler.toml` 中 `[vars] UPDATE_INTERVAL = 20`（分钟）和 `[triggers] crons = ["*/20 * * * *"]` 是一对，只改一处会导致抓取节奏与推送去重不一致。
- **部署前必须替换 `wrangler.toml` 的 `database_id`**，文件里已写明「不要使用此处的」；`TELEGRAM_BOT_TOKEN` 只能通过 secret 设置，不得写入 `[vars]` 或提交 `.dev.vars`。
- **`telegramify-markdown` 只适合纯文本消息，不适合卡片**：它会把 `>` 一律转成字面量 `\>`（引用块失效），也不给你控制粗体/链接结构的余地，所以卡片一律用 `src/utils/markdown.ts` 自己拼 MarkdownV2。测试新卡片时把输出直接贴进 bot 发一条验证。
- **拼进 MarkdownV2 的任何字符串都必须转义**，包括中文文案模板拼出来的时间串（`2026-11-23 10:45` 里的 `-` 是保留字符）。`boldV2` / `linkV2` 内部已转义，纯文本行必须显式 `escapeV2(...)`。漏一处就会 `can't parse entities`，而 `editMessageText` 失败后会退化发新消息、也失败，用户体验就是「按钮点了没反应」——排查时看 `wrangler tail` 里的 `editMessageText failed` 比看代码快。
- **回调处理器不能吞错**：`callbacks.ts` 的 `render()` 在「编辑失败 + 退化发送也失败」时会主动抛出，让外层 catch 用 `answerCallbackQuery` 弹出错误提示；否则失败是完全静默的。
- **命令列表和菜单按钮是两回事**：`setMyCommands` 只决定输入 `/` 时的候选；输入框旁边那个按钮由 `setChatMenuButton({menu_button:{type:"commands"}})` 控制，两者都在 `scripts/set-commands.mjs` 里同步。
- **「命令已注册但客户端输入 `/` 一条都不显示」的两个成因（已踩过，已修复，但当时未单独归因）**：
  1. **版本缓存**：命令列表缓存在客户端 `bot_info` 里，**只有版本号变化时才会重新拉取**。而 `set-commands.mjs` 默认「内容一致就跳过 `setMyCommands`」，导致版本号永远不变，客户端可以一直停在旧的空状态——此时 `getMyCommands` 看起来完全正常，客户端就是不显示。补救：`pnpm commands --force`（先 `deleteMyCommands` 再 `setMyCommands` 推进版本号），然后退出客户端重开。
  2. **空列表的窄 scope 覆盖**（见下条）。
  不要再把「服务端 getMyCommands 有数据」当成结论——它不能证明客户端能渲染。
- **空列表的窄 scope 会覆盖默认 scope**：`getMyCommands` 返回 `[]` 既可能是「没设过」也可能是「被设成了空」。如果有人给某个 chat / `all_private_chats` 设过空列表，该场景下就是一条命令都没有。排查时逐层查：
  ```
  getMyCommands({})                                        // 默认
  getMyCommands({scope:{type:'all_private_chats'}})         // 私聊层
  getMyCommands({scope:{type:'chat',chat_id:<你的user_id>}}) // 具体会话层
  ```
  需要清理时对同样参数调 `deleteMyCommands`。
- **排查「菜单不显示」的顺序**：先 `getMyCommands`（默认 scope）确认服务端有数据 → 逐层查 scope 覆盖 → `getChatMenuButton` 确认是 `commands` → 都不问题时 `pnpm commands --force` + 重启客户端 → 仍不行才是客户端版本/第三方客户端问题。
- 新增命令要同时改三处：`src/utils/bot-commands.json`（菜单）、`src/index.ts` 的 `switch`、`src/utils/i18n.ts` 的 `help` 文案。
- **OPML 导入受 Workers 子请求上限约束**：每个 feed 要发一次 fetch，免费版单请求上限 50 个子请求，所以 `MAX_IMPORT_FEEDS = 30`（还要留出 getFile / 下载文件 / 发消息的额度）。调大前先确认账户配额。
- **OPML 解析用正则而非 XML 解析器**：OPML 结构扁平，只提取 `<outline>` 上的 `xmlUrl` / `title` / `text`（属性名大小写不敏感，单双引号都支持），非 `http(s)` 的 xmlUrl 会被丢弃；导出走 `buildOpml`，两者已做往返测试。
- **导入时会把每个 feed 的当前最新一篇记为已读**（写 `last_item_guid`），避免一次导入就把历年归档全推给用户。
- **任何 `.opml` / `.xml` 文件发给 bot 都会触发导入**，不强制先发 `/import`；`/import` 只是提示文案。
- **内联按钮回调必须调 `answerCallbackQuery`**，否则客户端一直转圈；调用统一在 `CallbackHandler` 里，它同时做 `user_id` 归属校验。
- **`callback_data` 限 1-64 bytes**，所以用 `rss_subscriptions.id` 而不是 `feed_url`；格式 `f:<动作>:<载荷>`，动作定义在 `src/utils/card.ts` 的 `CALLBACK_ACTION`。载荷分三类：订阅 id（`d` 详情 / `x` 详情卡退订 / `r` 重命名 / `u` 直接退订）、语言码（`g:zh` / `g:en`）、取消上下文（`c:list` / `c:unsub` / `c:lang`）。`c` 与 `g` 必须在按数字 id 解析**之前**分流，否则 `Number("list")` 得到 `NaN` 会直接落到早退分支。无载荷动作只有 `f:l`（返回列表）。
- **不同入口的取消要发不同文案**：`cancelCallback(context)` 的上下文决定取消后发 `cancel_list` / `cancel_unsub` / `cancel_lang`。`/list` 点按钮进详情，`/unsub` 点按钮**直接退订**，两者卡片结构相同但回调不同（`f:d:<id>` vs `f:u:<id>`）。
- **`/lang` 不带参数是选择器，带参数才切换**：参数经 `normalizeLanguage()` 归一化（容许 `zh-CN`/`en-US`），无参数发 `languageCard` + `languageKeyboard`。
- **`answerCallbackQuery` 的提示文本最多 200 字符**，`callbacks.ts` 的 `toast()` 负责截断，直接塞长 URL 会整条调用失败。
- **订阅名可能为空**：数据库里 `name` 可为 NULL，展示一律走 `subscriptionName(sub)`（`src/utils/db.ts`），它回退到 `feed_title`。老数据需要跑迁移回填。
- **重命名是两段式交互**：点按钮 → 写 `pending_actions` → 用户下一条普通消息被 `handleFreeText()` 当成新名字。该状态 10 分钟后过期（`PENDING_TTL_MS`），`/cancel` 可清除。改这段路由时注意 `src/index.ts` 里非命令消息的分支。
- `schema.sql` 改动不会自动生效：新库直接 `wrangler d1 execute --file=./schema.sql`，**已部署的库要跑 `migrations/` 下对应脚本**。`ALTER TABLE ADD COLUMN` 非幂等，重复执行会报 `duplicate column name`，属预期行为。
- **去重依赖 `last_item_guid`**：定时任务用 `items.findIndex(item => item.guid === last_item_guid)` 定位旧文章，取 `slice(0, lastIndex)` 为新文章，成功后把 `items[0].guid` 写回。首次订阅（`last_item_guid` 为空）只推最新一条——改动推送逻辑时务必保持这个语义，否则会全量重推。
- **`schema.sql` 改动不会自动生效**，需要对远端/本地 D1 重新执行 `wrangler d1 execute`；目前没有迁移框架。
- **`Database` 中 `cacheUrl` 是硬编码域名**（Cache API 需要一个 URL 作为 key），改 worker 域名时需同步修改，否则语言缓存 key 与实际域名不符（功能不受影响但不直观）。
- **命令菜单靠 `setMyCommands` 同步，不在 Worker 运行时注册**：`pnpm deploy` 在 `wrangler deploy` 成功后才跑 `scripts/set-commands.mjs`；新增/改名命令必须同步改 `src/utils/bot-commands.json` 和 `src/index.ts` 的 `switch`，否则菜单里会出现点了没反应的命令。
- **同步前先 `getMyCommands` 比对，否则不发请求**：脚本把差异分为新增 / 描述变更 / 移除 / 顺序调整，四类都为空就跳过 `setMyCommands`。但 Telegram **没有“只新增一条”的接口**，`setMyCommands` 是整体覆盖，所以一旦有差异就把完整期望列表发上去——差异只决定“要不要发”和日志输出。
- **不要把这个注册逻辑塞进 `wrangler.toml` 的 `[build] command`**：`runCustomBuild()` 在 `wrangler dev` 与 `wrangler deploy` 之间共用，会随每次 dev 重建反复打 Telegram API。
- **注册脚本的 token 来自环境变量 `TELEGRAM_BOT_TOKEN` 或根目录 `.dev.vars`**：`wrangler secret` 存在 Cloudflare 侧、本地读不回来，所以没有 `.dev.vars` 时 `pnpm deploy` 会在部署成功后报错退出。
- `BotCommand.command` 只允许小写字母/数字/下划线、1-32 字符；`description` 必填 1-256 字符；单次最多 100 条。脚本会在请求前本地校验，改 JSON 后先看报错信息。
- `/help` 目前是 `/start` 的别名（Telegram 要求所有 bot 支持 Global Commands：`/start` `/help` `/settings`）；`/settings` 未实现，切语言仍是 `/lang`。
- 卡片消息**开启链接预览**（`sendMarkdownV2` / `editMarkdownV2` 不传 `link_preview_options`），文章卡的预览会挂在底部的“阅读全文”链接上；想要纯文字卡就在 `tgapi.ts` 里加 `link_preview_options: { is_disabled: true }`。
- `.cursorrules` 的内容实际是中文 README 的副本，并非真正的编码规则文件。
- 无 CI 配置（`.github/workflows` 不存在）；主干分支为 `main`，提交信息采用 Conventional Commits（见 `git log`，如 `feat: i18n and lang cache`）。

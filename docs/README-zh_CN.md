# Telegram RSS Bot on Cloudflare Workers

[English](../README.md) | 简体中文

一个使用 Cloudflare Workers 和 D1 数据库构建的 Telegram RSS 订阅机器人。免费，稳定。

demo: <https://t.me/atri_rss_bot>

## 命令列表

- `/sub <rss_url> [名字]` - 订阅 RSS 源，名字可缺省
- `/unsub [URL 或名字]` - 取消订阅；不带参数则列出订阅供点选
- `/list` - 列出订阅；点名字可重命名或退订
- `/export` - 导出订阅为 OPML 文件
- `/import` - 导入 OPML 文件（把文件发给 bot 即可）
- `/lang [zh|en]` - 切换语言；不带参数则弹出选择
- `/cancel` - 取消当前操作
- `/start` / `/help` - 查看帮助信息

## 部署说明

1. 前置步骤：注册 Cloudflare 账号，从 [Telegram](https://t.me/botfather) 注册 bot，获取 bot token
2. 克隆仓库
   ```sh
   git clone https://github.com/lxl66566/Telegram-RSS-Bot-on-Cloudflare-Workers.git
   cd Telegram-RSS-Bot-on-Cloudflare-Workers
   ```
3. 安装项目依赖
   ```sh
   pnpm i
   pnpm i wrangler -g
   ```
4. 部署项目（这里将 worker name 设置为 `telegram_rss_bot`，可自行修改）
   ```sh
   wrangler d1 create telegram_rss_bot                                  # 创建 d1 数据库
   # 然后将返回的 d1 database 信息填入 wrangler.toml 的 `[[d1_databases]]` 中
   wrangler d1 execute telegram_rss_bot --file=./schema.sql --remote    # 创建数据表
   wrangler deploy                                                      # 部署项目
   wrangler secret put TELEGRAM_BOT_TOKEN                               # 设置 bot token
   ```
5. 访问 `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>` 设置 webhook。`YOUR_WORKER_URL` 可以去 Cloudflare Dashboard 的 Workers 页面查看。
6. 如果部署完毕，运行时出现问题，可以 `wrangler tail telegram_rss_bot` 查看日志。

### 升级已有部署

不要跑 `schema.sql`，按顺序执行 `migrations/` 下的脚本，然后重新部署：

```sh
wrangler d1 execute telegram_rss_bot --file=./migrations/001_add_name_and_pending.sql --remote
wrangler deploy
```

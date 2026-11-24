-- 迁移 001：为订阅增加自定义名字，并新增待处理动作表
--
-- 已经部署过的库需要手工执行一次（新库直接用 schema.sql 即可，不用跑本文件）：
--   wrangler d1 execute telegram_rss_bot --file=./migrations/001_add_name_and_pending.sql --remote
--   wrangler d1 execute telegram_rss_bot --file=./migrations/001_add_name_and_pending.sql --local
--
-- 注意：D1 没有迁移框架，ALTER TABLE ADD COLUMN 不是幂等的，重复执行会报
-- "duplicate column name: name"，属预期行为。

ALTER TABLE rss_subscriptions ADD COLUMN name TEXT;

-- 老数据用 feed_title 回填，保证 /list 和推送卡片立刻有名字可显示
UPDATE rss_subscriptions
SET name = feed_title
WHERE name IS NULL OR TRIM(name) = '';

CREATE TABLE
  IF NOT EXISTS pending_actions (
    user_id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    sub_id INTEGER,
    created_at INTEGER NOT NULL
  );

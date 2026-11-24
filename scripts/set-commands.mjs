/**
 * 部署后把命令菜单同步到 Telegram。
 *
 * 用法：pnpm commands
 * token 来源优先级：环境变量 TELEGRAM_BOT_TOKEN > 项目根目录 .dev.vars
 * （wrangler secret 存在 Cloudflare 侧，本地读不回来，所以必须另有一份本地 token）
 *
 * 先用 getMyCommands 拉取线上现有命令做比对，完全一致就跳过 setMyCommands。
 *
 * 但「一致就跳过」有个副作用：命令版本号不变，缓存在旧状态的客户端不会刷新。
 * 如果客户端输入 `/` 看不到命令，用 `node scripts/set-commands.mjs --force` 强制删除重设。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS_FILE = resolve(root, "src/utils/bot-commands.json");
const MAX_COMMANDS = 100;
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;

function loadToken() {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    const content = readFileSync(resolve(root, ".dev.vars"), "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      if (line.slice(0, eq).trim() !== "TELEGRAM_BOT_TOKEN") continue;
      return line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // .dev.vars 不存在，落到下面统一报错
  }

  throw new Error(
    "未找到 TELEGRAM_BOT_TOKEN：请设置同名环境变量，或在项目根目录 .dev.vars 中写入 TELEGRAM_BOT_TOKEN=<token>（该文件已被 .gitignore 忽略）",
  );
}

export function validate(lang, commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error(`bot-commands.json 中 ${lang} 的命令列表为空`);
  }
  if (commands.length > MAX_COMMANDS) {
    throw new Error(`bot-commands.json 中 ${lang} 的命令数超过 ${MAX_COMMANDS} 条上限`);
  }
  const seen = new Set();
  for (const { command, description } of commands) {
    if (!COMMAND_PATTERN.test(command)) {
      throw new Error(`[${lang}] 命令 "${command}" 非法：只允许小写字母、数字、下划线，长度 1-32`);
    }
    if (seen.has(command)) {
      throw new Error(`[${lang}] 命令 "${command}" 重复`);
    }
    seen.add(command);
    if (typeof description !== "string" || description.length < 1 || description.length > 256) {
      throw new Error(`[${lang}] 命令 "${command}" 的 description 必须为 1-256 字符`);
    }
  }
}

/**
 * 比对线上与本地期望的命令列表。
 * 菜单展示顺序由数组顺序决定，所以顺序变化也算差异。
 */
export function diffCommands(current, desired) {
  const currentMap = new Map(current.map((item) => [item.command, item.description]));
  const desiredMap = new Map(desired.map((item) => [item.command, item.description]));

  const added = [...desiredMap.keys()].filter((command) => !currentMap.has(command));
  const updated = [...desiredMap.keys()].filter(
    (command) => currentMap.has(command) && currentMap.get(command) !== desiredMap.get(command),
  );
  const removed = [...currentMap.keys()].filter((command) => !desiredMap.has(command));
  const orderChanged =
    added.length === 0 &&
    updated.length === 0 &&
    removed.length === 0 &&
    current.map((item) => item.command).join("\u0000") !== desired.map((item) => item.command).join("\u0000");

  return {
    added,
    updated,
    removed,
    orderChanged,
    changed: added.length > 0 || updated.length > 0 || removed.length > 0 || orderChanged,
  };
}

function describeDiff(diff) {
  const parts = [];
  if (diff.added.length) parts.push(`新增 ${diff.added.map((c) => "/" + c).join(" ")}`);
  if (diff.updated.length) parts.push(`描述变更 ${diff.updated.map((c) => "/" + c).join(" ")}`);
  if (diff.removed.length) parts.push(`移除 ${diff.removed.map((c) => "/" + c).join(" ")}`);
  if (diff.orderChanged) parts.push("顺序调整");
  return parts.join("，");
}

async function callApi(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(`${method} 失败（HTTP ${response.status}）：${data?.description ?? "响应无法解析"}`);
  }
  return data.result;
}

async function main() {
  const token = loadToken();
  const table = JSON.parse(readFileSync(COMMANDS_FILE, "utf8"));
  // --force：跳过差异比对，直接 delete + set，把命令版本号推上去以刷新客户端缓存
  const force = process.argv.includes("--force");

  for (const [lang, commands] of Object.entries(table)) {
    validate(lang, commands);
  }

  // 三层目标：zh / en 各一份，再补一份默认（未匹配语言的用户回落到 zh）
  const targets = [
    ...Object.entries(table).map(([lang, commands]) => ({ label: lang, languageCode: lang, commands })),
    { label: "默认（回落 zh）", languageCode: undefined, commands: table.zh },
  ];

  for (const { label, languageCode, commands } of targets) {
    const payload = languageCode ? { language_code: languageCode } : {};

    if (force) {
      await callApi(token, "deleteMyCommands", payload);
      await callApi(token, "setMyCommands", languageCode ? { ...payload, commands } : { commands });
      console.log(`[${label}] --force：已删除并重设 ${commands.length} 条，命令版本号已推进`);
      continue;
    }

    const current = await callApi(token, "getMyCommands", payload);
    const diff = diffCommands(current, commands);

    if (!diff.changed) {
      console.log(`[${label}] 与线上一致（${commands.length} 条），跳过 setMyCommands`);
      continue;
    }

    // 注意：setMyCommands 是整体覆盖，没有「只新增一条」的接口，
    // 所以这里把完整期望列表发上去，差异只用于决定「要不要发」和日志。
    await callApi(token, "setMyCommands", languageCode ? { ...payload, commands } : { commands });
    console.log(`[${label}] 已同步 ${commands.length} 条命令：${describeDiff(diff)}`);
  }

  await syncMenuButton(token);
}

/**
 * 输入框旁边那个按钮由 setChatMenuButton 控制，和 setMyCommands 是两回事：
 * 命令列表只决定弹窗内容，菜单按钮得单独设成 commands 类型才会出现。
 */
async function syncMenuButton(token) {
  const current = await callApi(token, "getChatMenuButton", {});
  if (current?.type === "commands") {
    console.log("[菜单按钮] 已是 commands 类型，跳过 setChatMenuButton");
    return;
  }

  await callApi(token, "setChatMenuButton", { menu_button: { type: "commands" } });
  console.log(`[菜单按钮] 已从 ${current?.type ?? "未知"} 设为 commands`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

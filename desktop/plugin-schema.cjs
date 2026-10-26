"use strict";
const ICONS = [
  "spark",
  "drop",
  "clock",
  "bell",
  "check",
  "count",
  "note",
  "link",
  "heart",
  "star",
  "coffee",
];
const COLORS = ["blue", "purple", "pink", "mint", "amber", "gray"];
const KINDS = ["timer", "alarm", "counter", "checklist", "text", "links"];
function keys(o, allowed) {
  if (
    !o ||
    typeof o !== "object" ||
    Array.isArray(o) ||
    Object.keys(o).some((k) => !allowed.includes(k))
  )
    throw new Error("组件格式含有不支持的字段");
}
function str(s, max, min = 1) {
  if (
    typeof s !== "string" ||
    s.trim().length < min ||
    s.length > max ||
    /[\u0000-\u0008]/.test(s)
  )
    throw new Error("组件文字长度或格式无效");
  return s.trim();
}
function num(n, min, max) {
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("组件数值超出允许范围");
  return n;
}
function safeUrl(value) {
  const text = str(value, 2048),
    u = new URL(text);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("链接仅支持不含账号密码的 HTTP/HTTPS 地址");
  return u.href;
}
function validateManifest(raw) {
  if (Buffer.byteLength(JSON.stringify(raw) || "") > 32768)
    throw new Error("组件文件不能超过 32 KB");
  keys(raw, [
    "schemaVersion",
    "id",
    "name",
    "description",
    "icon",
    "color",
    "kind",
    "config",
  ]);
  if (raw.schemaVersion !== 1 || !/^[a-z][a-z0-9-]{2,47}$/.test(raw.id))
    throw new Error("组件版本或 ID 无效");
  if (
    !ICONS.includes(raw.icon) ||
    !COLORS.includes(raw.color) ||
    !KINDS.includes(raw.kind)
  )
    throw new Error("当前支持计时、闹钟、计数、清单、文字和链接组件");
  const m = {
    schemaVersion: 1,
    id: raw.id,
    name: str(raw.name, 24),
    description: str(raw.description, 140),
    icon: raw.icon,
    color: raw.color,
    kind: raw.kind,
    config: {},
  };
  const c = raw.config;
  if (m.kind === "timer") {
    keys(c, ["minutes", "repeat"]);
    if (typeof c.repeat !== "boolean") throw new Error("repeat 需要布尔值");
    m.config = { minutes: num(c.minutes, 1, 1440), repeat: c.repeat };
  }
  if (m.kind === "alarm") {
    keys(c, ["time"]);
    if (typeof c.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time))
      throw new Error("闹钟时间需要 HH:mm");
    m.config = { time: c.time };
  }
  if (m.kind === "counter") {
    keys(c, ["initial", "step", "min", "max"]);
    const min = num(c.min, -1000000, 1000000),
      max = num(c.max, min, 1000000);
    m.config = {
      initial: num(c.initial, min, max),
      step: num(c.step, 1, 10000),
      min,
      max,
    };
  }
  if (m.kind === "text") {
    keys(c, ["text"]);
    m.config = { text: str(c.text, 2000) };
  }
  if (m.kind === "checklist") {
    keys(c, ["items"]);
    if (!Array.isArray(c.items) || c.items.length < 1 || c.items.length > 30)
      throw new Error("清单需要 1–30 项");
    m.config = { items: c.items.map((x) => str(x, 100)) };
  }
  if (m.kind === "links") {
    keys(c, ["links"]);
    if (!Array.isArray(c.links) || c.links.length < 1 || c.links.length > 12)
      throw new Error("链接需要 1–12 项");
    m.config = {
      links: c.links.map((x) => {
        keys(x, ["label", "url"]);
        return { label: str(x.label, 40), url: safeUrl(x.url) };
      }),
    };
  }
  return m;
}
function parseManifest(text) {
  if (typeof text !== "string" || text.length > 40000)
    throw new Error("AI 返回的组件内容过大或为空");
  text = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("AI 没有返回有效的组件 JSON，请调整需求后重试");
  }
  if (raw && typeof raw.error === "string" && Object.keys(raw).length === 1)
    throw new Error(raw.error.slice(0, 240));
  return validateManifest(raw);
}
module.exports = {
  validateManifest,
  parseManifest,
  safeUrl,
  ICONS,
  COLORS,
  KINDS,
};

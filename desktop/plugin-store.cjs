"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { validateManifest } = require("./plugin-schema.cjs");
function nextAlarm(time, now) {
  const [h, m] = time.split(":").map(Number),
    d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (+d <= now) d.setDate(d.getDate() + 1);
  return +d;
}
function initial(m) {
  return {
    active: false,
    deadline: null,
    remaining: m.kind === "timer" ? m.config.minutes * 60000 : 0,
    count: m.kind === "counter" ? m.config.initial : 0,
    checked: [],
    alert: false,
  };
}
function createPluginStore({
  file,
  now = () => Date.now(),
  onChange,
  onNotice,
} = {}) {
  let entries = [],
    error = "";
  try {
    if (file && fs.existsSync(file)) {
      if (fs.statSync(file).size > 4e6) throw Error();
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        data.version !== 1 ||
        !Array.isArray(data.entries) ||
        data.entries.length > 40
      )
        throw Error();
      entries = data.entries.map((e) => {
        const manifest = validateManifest(e.manifest),
          previous = e.previous ? validateManifest(e.previous) : null;
        if (previous && previous.id !== manifest.id) throw Error();
        const r = e.runtime;
        if (
          !r ||
          typeof r.active !== "boolean" ||
          (r.deadline !== null && !Number.isFinite(r.deadline)) ||
          !Number.isFinite(r.remaining) ||
          r.remaining < 0 ||
          !Number.isFinite(r.count) ||
          !Array.isArray(r.checked) ||
          r.checked.some((n) => !Number.isInteger(n) || n < 0 || n >= 30)
        )
          throw Error();
        return {
          manifest,
          previous,
          runtime: { ...initial(manifest), ...r },
          isNew: e.isNew === true,
          updatedAt: Number(e.updatedAt) || 0,
        };
      });
      if (new Set(entries.map((e) => e.manifest.id)).size !== entries.length)
        throw Error();
    }
  } catch {
    entries = [];
    error = "DIY 组件文件无法读取，已保留原文件；暂不能保存更改";
  }
  const state = () => ({
    entries: structuredClone(entries).map((e) => ({
      ...e,
      runtime: {
        ...e.runtime,
        remaining:
          e.runtime.active && e.manifest.kind === "timer"
            ? Math.max(0, e.runtime.deadline - now())
            : e.runtime.remaining,
      },
    })),
    error,
    now: now(),
  });
  function commit(change) {
    if (error) throw new Error(error);
    const next = structuredClone(entries),
      notices = [];
    change(next, notices);
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file + ".tmp",
        JSON.stringify({ version: 1, entries: next }),
        "utf8",
      );
      fs.renameSync(file + ".tmp", file);
    }
    entries = next;
    onChange?.(state());
    for (const n of notices) onNotice?.(n);
    return state();
  }
  const find = (list, id) => {
    const e = list.find((e) => e.manifest.id === id);
    if (!e) throw new Error("组件不存在");
    return e;
  };
  return {
    getState: state,
    install(value, target = null) {
      const manifest = validateManifest(value);
      return commit((list) => {
        const old = list.find((e) => e.manifest.id === manifest.id);
        if (target && target !== manifest.id)
          throw new Error("更新必须保留组件 ID");
        if (old && !target)
          throw new Error("组件 ID 已存在，请从该组件选择修改");
        if (target && !old) throw new Error("要更新的组件已被移除");
        if (!old && list.length >= 40)
          throw new Error("最多安装 40 个 DIY 组件");
        const entry = {
          manifest,
          previous: old?.manifest || null,
          runtime: initial(manifest),
          isNew: true,
          updatedAt: now(),
        };
        if (old) list[list.indexOf(old)] = entry;
        else list.push(entry);
      });
    },
    action(id, op, arg) {
      return commit((list) => {
        const e = find(list, id),
          m = e.manifest,
          r = e.runtime;
        if (op === "seen") {
          e.isNew = false;
          r.alert = false;
          return;
        }
        if (op === "remove") {
          list.splice(list.indexOf(e), 1);
          return;
        }
        if (op === "rollback") {
          if (!e.previous) throw new Error("没有上一版");
          [e.manifest, e.previous] = [e.previous, e.manifest];
          e.runtime = initial(e.manifest);
          e.isNew = true;
          return;
        }
        if (op === "reset") {
          e.runtime = initial(m);
          return;
        }
        if (op === "toggle" && ["timer", "alarm"].includes(m.kind)) {
          if (r.active) {
            if (m.kind === "timer")
              r.remaining = Math.max(0, r.deadline - now());
            r.active = false;
            r.deadline = null;
          } else {
            r.active = true;
            r.alert = false;
            r.deadline =
              m.kind === "alarm"
                ? nextAlarm(m.config.time, now())
                : now() + (r.remaining || m.config.minutes * 60000);
          }
          return;
        }
        if (op === "count" && m.kind === "counter" && [-1, 1].includes(arg)) {
          r.count = Math.max(
            m.config.min,
            Math.min(m.config.max, r.count + arg * m.config.step),
          );
          return;
        }
        if (
          op === "check" &&
          m.kind === "checklist" &&
          Number.isInteger(arg) &&
          arg >= 0 &&
          arg < m.config.items.length
        ) {
          r.checked = r.checked.includes(arg)
            ? r.checked.filter((i) => i !== arg)
            : [...r.checked, arg];
          return;
        }
        throw new Error("这个组件不支持此操作");
      });
    },
    tick() {
      if (
        error ||
        !entries.some((e) => e.runtime.active && e.runtime.deadline <= now())
      )
        return state();
      return commit((list, notices) => {
        for (const e of list) {
          const r = e.runtime,
            m = e.manifest;
          if (!r.active || r.deadline > now()) continue;
          r.alert = true;
          notices.push({
            id: m.id,
            title: m.name,
            body:
              m.kind === "alarm"
                ? `${m.config.time} 的提醒到了`
                : m.description,
          });
          if (m.kind === "alarm") r.deadline = nextAlarm(m.config.time, now());
          else if (m.kind === "timer" && m.config.repeat)
            r.deadline = now() + m.config.minutes * 60000;
          else {
            r.active = false;
            r.deadline = null;
            r.remaining = 0;
          }
        }
      });
    },
  };
}
module.exports = { createPluginStore, nextAlarm };

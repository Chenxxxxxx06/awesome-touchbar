"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const CATALOG = [
  ["ai", "AI 工具", "本机状态与额度"],
  ["music", "音乐", "歌曲、歌词与进度"],
  ["notices", "提醒中心", "待办、专注和 AI 提醒"],
  ["todo", "待办事项", "记下下一件事"],
  ["focus", "专注计时", "开始一段专注"],
  ["brightnessDown", "降低亮度", "每次降低 2%"],
  ["brightness", "亮度", "展开亮度滑块"],
  ["brightnessUp", "提高亮度", "每次提高 2%"],
  ["volumeDown", "降低音量", "每次降低 2%"],
  ["volume", "音量", "展开音量滑块"],
  ["volumeUp", "提高音量", "每次提高 2%"],
  ["mute", "静音", "切换静音"],
  ["previous", "上一首", "媒体快捷键"],
  ["playPause", "播放 / 暂停", "媒体快捷键"],
  ["next", "下一首", "媒体快捷键"],
  ["desktop", "显示桌面", "切换桌面显示"],
  ["tasks", "任务视图", "查看打开的窗口"],
  ["explorer", "文件管理器", "打开文件管理器"],
].map(([id, name, description]) => ({ id, name, description }));
const IDS = CATALOG.map((x) => x.id);
const copy = (value) => structuredClone(value);
function layout(
  order = IDS,
  pinned = ["ai", "music", "notices", "brightness", "volume", "mute"],
  visible = IDS,
) {
  return {
    order: [...order, ...IDS.filter((id) => !order.includes(id))],
    pinned: [...pinned],
    hidden: IDS.filter((id) => !visible.includes(id)),
  };
}
const BUILTINS = [
  { id: "default", name: "原布局", layout: layout() },
  {
    id: "work",
    name: "工作",
    layout: layout(
      [
        "ai",
        "todo",
        "focus",
        "notices",
        "explorer",
        "tasks",
        "desktop",
        "music",
        "brightness",
        "volume",
        "mute",
      ],
      ["ai", "todo", "focus", "notices"],
      [
        "ai",
        "todo",
        "focus",
        "notices",
        "explorer",
        "tasks",
        "desktop",
        "music",
        "brightness",
        "volume",
        "mute",
      ],
    ),
  },
  {
    id: "music",
    name: "听歌",
    layout: layout(
      [
        "music",
        "previous",
        "playPause",
        "next",
        "volume",
        "mute",
        "ai",
        "notices",
        "brightness",
      ],
      ["music", "previous", "playPause", "next", "volume"],
      [
        "music",
        "previous",
        "playPause",
        "next",
        "volume",
        "mute",
        "ai",
        "notices",
        "brightness",
      ],
    ),
  },
  {
    id: "minimal",
    name: "极简",
    layout: layout(
      [
        "ai",
        "music",
        "todo",
        "focus",
        "notices",
        "brightness",
        "volume",
        "mute",
      ],
      ["ai", "music", "volume"],
      [
        "ai",
        "music",
        "todo",
        "focus",
        "notices",
        "brightness",
        "volume",
        "mute",
      ],
    ),
  },
];
function validateLayout(value, ids = IDS) {
  if (
    !value ||
    !Array.isArray(value.order) ||
    !Array.isArray(value.hidden) ||
    !Array.isArray(value.pinned)
  )
    throw new Error("布局格式无效");
  for (const key of ["order", "hidden", "pinned"])
    if (
      value[key].length > ids.length ||
      new Set(value[key]).size !== value[key].length ||
      value[key].some((id) => !ids.includes(id))
    )
      throw new Error("布局包含重复或未知组件");
  if (value.order.length !== ids.length) throw new Error("布局缺少组件");
  if (value.pinned.some((id) => value.hidden.includes(id)))
    throw new Error("隐藏组件不能同时固定");
  // Pinned order follows the same user-controlled order as the expanded bar.
  return {
    order: [...value.order],
    hidden: [...value.hidden],
    pinned: value.order.filter((id) => value.pinned.includes(id)),
  };
}
function createWidgets({ file, onChange, catalog = [] } = {}) {
  let extras = catalog,
    ids = [...IDS, ...extras.map((x) => x.id)];
  function reconcile(value) {
    if (
      !value ||
      !["order", "hidden", "pinned"].every(
        (k) =>
          Array.isArray(value[k]) &&
          new Set(value[k]).size === value[k].length &&
          value[k].length <= 60 &&
          value[k].every(
            (id) =>
              IDS.includes(id) ||
              id === "diy" ||
              /^plugin:[a-z][a-z0-9-]{2,47}$/.test(id),
          ),
      )
    )
      throw new Error("Invalid saved widget layout");
    if (IDS.some((id) => !value.order.includes(id)))
      throw new Error("Missing built-in widgets");
    return validateLayout(
      {
        order: [
          ...value.order.filter((id) => ids.includes(id)),
          ...ids.filter((id) => !value.order.includes(id)),
        ],
        hidden: value.hidden.filter((id) => ids.includes(id)),
        pinned: value.pinned.filter((id) => ids.includes(id)),
      },
      ids,
    );
  }
  let saved = {
      version: 1,
      revision: 0,
      activePreset: "default",
      layout: layout(),
      presets: [],
    },
    draft = null,
    error = "";
  try {
    if (file && fs.existsSync(file)) {
      if (fs.statSync(file).size > 100000) throw new Error("Too large");
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        value.version !== 1 ||
        !Number.isInteger(value.revision) ||
        !Array.isArray(value.presets) ||
        value.presets.length > 12
      )
        throw new Error("Invalid store");
      // Keep saved dynamic IDs until the installed catalog is reconciled during startup.
      if (!catalog.length && Array.isArray(value.layout?.order)) {
        extras = value.layout.order
          .filter(
            (id) => id === "diy" || /^plugin:[a-z][a-z0-9-]{2,47}$/.test(id),
          )
          .map((id) => ({ id, name: id, description: "" }));
        ids = [...IDS, ...extras.map((x) => x.id)];
      }
      const presets = value.presets.map((p) => {
        if (
          typeof p.id !== "string" ||
          !p.id.startsWith("custom-") ||
          typeof p.name !== "string" ||
          !p.name.trim() ||
          p.name.length > 24
        )
          throw new Error("Invalid preset");
        return { id: p.id, name: p.name, layout: reconcile(p.layout) };
      });
      if (new Set(presets.map((p) => p.id)).size !== presets.length)
        throw new Error("Duplicate preset");
      saved = {
        version: 1,
        revision: value.revision,
        activePreset:
          typeof value.activePreset === "string"
            ? value.activePreset
            : "custom",
        layout: reconcile(value.layout),
        presets,
      };
    }
  } catch {
    error = "布局文件无法读取，已保留原文件；暂不能保存修改";
  }
  saved.layout = reconcile(saved.layout);
  function state() {
    const current = draft || saved;
    return {
      ...copy(current),
      editing: !!draft,
      error,
      catalog: copy([...CATALOG, ...extras]),
      builtins: copy(
        BUILTINS.map((p) => ({ ...p, layout: reconcile(p.layout) })),
      ),
    };
  }
  function publish() {
    const value = state();
    onChange?.(value);
    return value;
  }
  function persist(next) {
    if (error) throw new Error(error);
    const value = { ...copy(next), revision: saved.revision + 1 };
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2), "utf8");
      fs.renameSync(file + ".tmp", file);
    }
    saved = value;
    draft = null;
    return publish();
  }
  return {
    getState: state,
    setCatalog(value) {
      extras = copy(value);
      ids = [...IDS, ...extras.map((x) => x.id)];
      saved.layout = reconcile(saved.layout);
      saved.presets = saved.presets.map((p) => ({
        ...p,
        layout: reconcile(p.layout),
      }));
      if (draft) {
        draft.layout = reconcile(draft.layout);
        draft.presets = draft.presets.map((p) => ({
          ...p,
          layout: reconcile(p.layout),
        }));
      }
      return publish();
    },
    begin() {
      if (!draft) draft = copy(saved);
      return publish();
    },
    preview(value) {
      if (!draft) throw new Error("请先进入编辑模式");
      draft.layout = validateLayout(value, ids);
      draft.activePreset = "custom";
      return publish();
    },
    applyPreset(id) {
      const preset = [...BUILTINS, ...(draft || saved).presets].find(
        (p) => p.id === id,
      );
      if (!preset) throw new Error("预设不存在");
      const next = {
        ...copy(draft || saved),
        layout: reconcile(preset.layout),
        activePreset: id,
      };
      if (draft) {
        draft = next;
        return publish();
      }
      return persist(next);
    },
    savePreset(name) {
      if (!draft) throw new Error("请先进入编辑模式");
      if (typeof name !== "string" || !name.trim() || name.trim().length > 24)
        throw new Error("请输入 1–24 字的预设名称");
      name = name.trim();
      if ([...BUILTINS, ...draft.presets].some((p) => p.name === name))
        throw new Error("这个名称已存在，请换个名称");
      if (draft.presets.length >= 12)
        throw new Error("最多保存 12 个自定义预设");
      const preset = {
        id: "custom-" + randomUUID(),
        name,
        layout: copy(draft.layout),
      };
      draft.presets.push(preset);
      draft.activePreset = preset.id;
      return publish();
    },
    deletePreset(id) {
      if (!draft) throw new Error("请先进入编辑模式");
      if (!draft.presets.some((p) => p.id === id))
        throw new Error("只能删除自定义预设");
      draft.presets = draft.presets.filter((p) => p.id !== id);
      if (draft.activePreset === id) draft.activePreset = "custom";
      return publish();
    },
    commit() {
      if (!draft) return state();
      return persist(draft);
    },
    cancel() {
      draft = null;
      return publish();
    },
  };
}
module.exports = { createWidgets, validateLayout, CATALOG, BUILTINS };

"use strict";
(() => {
  const api = window.touchbar;
  const paths = {
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    drop: "M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z",
    clock: "M12 7v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    bell: "M6 10a6 6 0 0 1 12 0v6l2 2H4l2-2ZM10 21h4",
    check: "m5 12 5 5L20 6",
    count: "M9 3 7 21M17 3l-2 18M3 9h18M2 15h18",
    note: "M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5",
    link: "m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
    heart: "M12 20 4 12C-2 5 8 0 12 7c4-7 14-2 8 5Z",
    star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
    coffee:
      "M4 7h12v8a5 5 0 0 1-10 0V7M16 8h2a3 3 0 0 1 0 6h-2M3 21h17M8 2v2M12 2v2",
  };
  let root,
    callbacks,
    state = { entries: [], tools: [], job: { status: "idle" } },
    view = "choose",
    target = null,
    selected = "",
    model = "",
    request = "",
    visible = false,
    lastInstalled = "",
    timer,
    removing = false;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function icon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", paths[kind] || paths.spark);
    svg.append(p);
    return svg;
  }
  function button(label, text, click, cls = "d-button") {
    const b = el("button", cls, text);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", click);
    return b;
  }
  function error(e) {
    const status = root.querySelector(".d-status");
    if (status) status.textContent = e.message || "操作未完成";
    else root.append(el("span", "d-status", e.message || "操作未完成"));
  }
  async function action(op, arg) {
    try {
      await api.pluginAction(target, op, arg);
    } catch (e) {
      error(e);
    }
  }
  function close() {
    callbacks.onClose();
  }
  function showPanel(next, id = null) {
    view = next;
    target = id;
    removing = false;
    callbacks.onOpen();
    render();
  }
  function chooseTool(id) {
    selected = id;
    view = "compose";
    render();
    root.querySelector(".d-request")?.focus();
  }
  function receive(next) {
    state = next;
    for (const e of state.entries) {
      const b = document.querySelector(
        `[data-widget="plugin:${e.manifest.id}"]`,
      );
      if (b) {
        b.querySelector(".plugin-new")?.toggleAttribute(
          "hidden",
          !e.isNew && !e.runtime.alert,
        );
        b.dataset.alert = String(e.runtime.alert);
      }
    }
    callbacks.onState?.(state);
    if (
      state.job.status === "installed" &&
      lastInstalled !==
        state.job.id +
          state.entries.find((e) => e.manifest.id === state.job.id)?.updatedAt
    ) {
      lastInstalled =
        state.job.id +
        state.entries.find((e) => e.manifest.id === state.job.id)?.updatedAt;
      request = "";
      if (visible && ["choose", "compose", "progress"].includes(view))
        callbacks.onInstalled();
    }
    if (visible && view === "plugin" && root.dataset.view === "plugin") {
      const entry = state.entries.find((e) => e.manifest.id === target);
      const key = JSON.stringify(
        entry && { ...entry, runtime: { ...entry.runtime, remaining: 0 } },
      );
      if (root.dataset.snapshot === key) {
        if (entry?.manifest.kind === "timer") {
          const value = root.querySelector(".d-value");
          if (value) value.textContent = formatTime(entry.runtime.remaining);
        }
        return;
      }
      root.dataset.snapshot = key;
    }
    if (visible) render();
  }
  function render() {
    if (!root || !visible) return;
    // Preserve composition/selection while incoming status snapshots refresh.
    if (
      view === "compose" &&
      root.dataset.view === "compose" &&
      !["generating", "validating", "cancelling"].includes(state.job.status)
    )
      return;
    if (
      ["generating", "validating", "cancelling"].includes(state.job.status) &&
      ["choose", "compose", "progress"].includes(view)
    )
      view = "progress";
    root.replaceChildren();
    root.dataset.view = view;
    root.append(
      button(
        "返回",
        "‹",
        () => {
          if (view === "choose" || view === "plugin") close();
          else {
            view = target ? "plugin" : "choose";
            render();
          }
        },
        "d-back",
      ),
    );
    if (view === "choose") {
      root.append(el("span", "d-heading", "DIY 工坊"));
      for (const tool of state.tools) {
        const b = button(
          "使用 " + tool.name,
          "",
          () => chooseTool(tool.id),
          "d-tool",
        );
        b.title = tool.name + " · " + tool.status;
        const img = el("img");
        img.src =
          "../assets/brands/" +
          (tool.id === "pi" ? "pi.svg" : tool.id + ".png");
        img.alt = "";
        b.append(img, el("span", "", tool.name));
        root.append(b);
      }
      if (!state.tools.length)
        root.append(
          el(
            "span",
            "d-status",
            state.scanning ? "正在检测本机 AI…" : "未检测到兼容的 AI CLI",
          ),
        );
      root.append(
        button("重新检测 AI", "↻", () => api.refreshDIY().catch(error)),
        button("导入社区组件", "导入", () => api.importPlugin().catch(error)),
        button("浏览社区组件", "社区", () => api.openCommunity().catch(error)),
      );
      if (["failed", "cancelled"].includes(state.job.status))
        root.append(el("span", "d-status", state.job.message));
    } else if (view === "compose") {
      const tool = state.tools.find((t) => t.id === selected);
      root.append(
        button("重新选择 AI", tool?.name || "选择 AI", () => {
          view = "choose";
          render();
        }),
      );
      const modelInput = el("input", "d-model");
      modelInput.placeholder = "模型：默认 / 填 ID";
      modelInput.value = model;
      modelInput.maxLength = 120;
      modelInput.setAttribute("aria-label", "模型 ID，留空使用默认模型");
      modelInput.addEventListener("input", () => (model = modelInput.value));
      root.append(modelInput);
      const input = el("input", "d-request");
      input.placeholder = target
        ? "描述你想怎样修改这个组件…"
        : "说个想法，比如：每小时提醒我喝水…";
      input.value = request;
      input.maxLength = 4000;
      input.setAttribute("aria-label", "组件需求");
      input.addEventListener("input", () => (request = input.value));
      const submit = async () => {
        if (!request.trim()) return;
        try {
          await api.startDIY({
            toolId: selected,
            model: model.trim(),
            request,
            targetId: target,
          });
          view = "progress";
          render();
        } catch (e) {
          error(e);
        }
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          submit();
        }
      });
      root.append(
        input,
        button("生成组件", "生成 ↗", submit, "d-button d-primary"),
      );
      root.append(
        button(
          "打开完整输入框",
          "↗",
          () =>
            api
              .openDIYComposer({
                toolId: selected,
                model,
                request,
                targetId: target,
              })
              .catch(error),
          "d-button d-compose-popout",
        ),
      );
    } else if (view === "progress") {
      root.append(
        el("span", "d-spinner", "✧"),
        el("span", "d-status", state.job.message),
      );
      if (["generating", "validating", "cancelling"].includes(state.job.status))
        root.append(
          button("取消生成", "取消", () => api.cancelDIY().catch(error)),
        );
      else
        root.append(
          button("重新编辑需求", "重试", () => {
            view = "compose";
            root.dataset.view = "";
            render();
          }),
        );
    } else {
      const entry = state.entries.find((e) => e.manifest.id === target);
      if (!entry) {
        close();
        return;
      }
      const m = entry.manifest,
        r = entry.runtime;
      const title = el("span", "d-plugin-title");
      title.append(icon(m.icon), el("strong", "", m.name));
      title.dataset.color = m.color;
      root.append(title);
      if (view === "manage") {
        if (state.tools.length)
          root.append(
            button("用 AI 修改组件", "修改", () => {
              request = "";
              view = "choose";
              render();
            }),
          );
        root.append(
          button("导出组件用于分享", "导出", () =>
            api.exportPlugin(target).catch(error),
          ),
          button("浏览社区与 PR 流程", "社区", () =>
            api.openCommunity().catch(error),
          ),
        );
        if (entry.previous)
          root.append(
            button("恢复上一版组件", "回退", () => action("rollback")),
          );
        root.append(
          button(
            "移除组件",
            removing ? "确定移除？" : "移除",
            () => {
              if (removing) action("remove");
              else {
                removing = true;
                render();
              }
            },
            "d-button d-danger",
          ),
        );
      } else {
        if (m.kind === "timer" || m.kind === "alarm") {
          const status = el(
            "span",
            "d-value",
            m.kind === "alarm" ? m.config.time : formatTime(r.remaining),
          );
          status.title = m.description;
          root.append(status);
          root.append(
            button(
              r.active ? "暂停提醒" : "开始提醒",
              r.active ? "Ⅱ" : "▶",
              () => action("toggle"),
            ),
            button("重置组件", "↺", () => action("reset")),
          );
          root.append(
            el(
              "span",
              "d-status",
              m.kind === "alarm"
                ? r.active
                  ? "每天 · 已启用"
                  : "每天 · 未启用"
                : r.alert
                  ? "时间到了"
                  : r.active
                    ? "计时中"
                    : m.config.repeat
                      ? "循环提醒 · 已暂停"
                      : "已暂停",
            ),
          );
        } else if (m.kind === "counter") {
          root.append(
            button("减少计数", "−", () => action("count", -1)),
            el("span", "d-value", r.count),
            button("增加计数", "+", () => action("count", 1)),
            button("重置组件", "↺", () => action("reset")),
          );
        } else if (m.kind === "checklist") {
          const list = el("div", "d-content");
          m.config.items.forEach((text, i) => {
            const b = button(
              text,
              (r.checked.includes(i) ? "✓ " : "○ ") + text,
              () => action("check", i),
              "d-check",
            );
            b.setAttribute("aria-pressed", String(r.checked.includes(i)));
            list.append(b);
          });
          root.append(list);
        } else if (m.kind === "text") {
          root.append(el("div", "d-content d-text", m.config.text));
        } else if (m.kind === "links") {
          const list = el("div", "d-content");
          m.config.links.forEach((link, i) =>
            list.append(
              button(link.label, link.label + " ↗", () =>
                api.openPluginLink(target, i).catch(error),
              ),
            ),
          );
          root.append(list);
        }
        root.append(
          button("管理这个组件", "⋯", () => {
            view = "manage";
            render();
          }),
        );
      }
    }
  }
  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return (
      String(Math.floor(s / 60)).padStart(2, "0") +
      ":" +
      String(s % 60).padStart(2, "0")
    );
  }
  window.diyView = {
    mount(node, cb) {
      root = node;
      callbacks = cb;
      api.onDIY(receive);
      api.getDIY().then(receive).catch(error);
      api.refreshDIY().catch(error);
      timer = setInterval(() => {
        if (visible && view === "plugin")
          api
            .getDIY()
            .then(receive)
            .catch(() => {});
      }, 1000);
    },
    createButton(meta) {
      const b = button(
        meta.name,
        "",
        () => {
          if (meta.id === "diy") showPanel("choose");
          else {
            showPanel("plugin", meta.id.slice(7));
            action("seen");
          }
        },
        "key diy-launch",
      );
      b.dataset.color = meta.color;
      b.append(icon(meta.icon));
      if (meta.id !== "diy") {
        const badge = el("span", "plugin-new", "NEW");
        const entry = state.entries.find(
          (e) => "plugin:" + e.manifest.id === meta.id,
        );
        badge.hidden = !entry?.isNew && !entry?.runtime.alert;
        b.append(badge);
      }
      return b;
    },
    openPlugin(id) {
      if (state.entries.some((e) => e.manifest.id === id)) {
        showPanel("plugin", id);
        action("seen");
      }
    },
    show(value) {
      if (visible === value) return;
      visible = value;
      root.hidden = !value;
      if (value) {
        root.dataset.view = "";
        render();
      }
    },
    back() {
      if (view === "plugin" || view === "choose") {
        close();
        return;
      }
      view = target ? "plugin" : "choose";
      root.dataset.view = "";
      render();
    },
    dispose() {
      clearInterval(timer);
    },
  };
})();

"use strict";
(() => {
  const api = window.touchbar;
  window.widgetLayout = function mount({ onChange, onEdit }) {
    const track = document.querySelector(".component-track");
    const viewport = document.querySelector("#components");
    const pins = document.querySelector(".compact-controls");
    const customize = document.querySelector("#customize-button");
    const q = (selector) => document.querySelector(selector);
    const items = {
      ai: q("#ai-button"),
      music: q("#music-button"),
      notices: q("#notice-button"),
      todo: q("#todo-button"),
      focus: q("#focus-button"),
      brightnessDown: q('[data-adjust="brightness"][data-step="-1"]'),
      brightness: q('[data-adjust="brightness"]:not([data-step])'),
      brightnessUp: q('[data-adjust="brightness"][data-step="1"]'),
      volumeDown: q('[data-adjust="volume"][data-step="-1"]'),
      volume: q('[data-adjust="volume"]:not([data-step])'),
      volumeUp: q('[data-adjust="volume"][data-step="1"]'),
      mute: q("[data-mute]"),
      previous: q('[data-action="mediaPrevious"]'),
      playPause: q('[data-action="mediaPlayPause"]'),
      next: q('[data-action="mediaNext"]'),
      desktop: q('[data-action="showDesktop"]'),
      tasks: q('[data-action="taskView"]'),
      explorer: q('[data-action="openExplorer"]'),
    };
    const compact = {
      brightness: q("#brightness-button"),
      volume: q("#volume-button"),
      mute: q("#mute-button"),
    };
    for (const [id, button] of [
      ...Object.entries(items),
      ...Object.entries(compact),
    ])
      button.dataset.widget = id;
    let state,
      signature = "",
      gesture,
      holdTimer,
      suppressUntil = 0,
      openPending = false,
      pinWheel;
    const vertical = () => document.body.dataset.orientation === "vertical";
    function report(error) {
      customize.title = String(error?.message || "无法保存布局，请重试");
    }
    function accept(next) {
      const entering = next.editing && !state?.editing;
      state = next;
      for (const meta of next.catalog)
        if (
          !items[meta.id] ||
          ((meta.id === "diy" || meta.id.startsWith("plugin:")) &&
            items[meta.id].dataset.meta !== JSON.stringify(meta))
        ) {
          const node = window.diyView?.createButton(meta);
          if (node) {
            if (items[meta.id]) items[meta.id].replaceWith(node);
            else track.append(node);
            items[meta.id] = node;
            node.dataset.widget = meta.id;
            node.dataset.meta = JSON.stringify(meta);
          }
        }
      for (const id of Object.keys(items))
        if (!next.catalog.some((meta) => meta.id === id)) {
          items[id].remove();
          delete items[id];
        }
      signature = "";
      document.body.dataset.widgetEditing = String(next.editing);
      customize.textContent = next.editing ? "✓" : "⋯";
      customize.setAttribute(
        "aria-label",
        next.editing ? "完成组件编辑" : "自定义组件",
      );
      customize.title = next.editing
        ? "完成并保存 · Esc 取消"
        : "自定义组件 · 也可以长按图标";
      if (entering) onEdit();
      onChange();
    }
    function open() {
      if (openPending) return;
      openPending = true;
      api
        .openWidgets()
        .catch(report)
        .finally(() => {
          openPending = false;
        });
    }
    customize.addEventListener("click", () =>
      state?.editing ? api.finishWidgets(true).catch(report) : open(),
    );
    function layout({ browsing, detail }) {
      if (!state) return;
      const key = JSON.stringify([
        state.layout,
        state.editing,
        browsing,
        detail,
      ]);
      if (key === signature) return;
      signature = key;
      const { order, hidden, pinned } = state.layout;
      const launchers = [
        "ai",
        "music",
        "notices",
        "todo",
        "focus",
        ...order.filter((id) => id === "diy" || id.startsWith("plugin:")),
      ];
      const compactIds = browsing
        ? []
        : order.filter(
            (id) =>
              !hidden.includes(id) &&
              (pinned.includes(id) || id === detail) &&
              (!detail || launchers.includes(id)),
          );
      for (const id of order) {
        if (!items[id]) continue;
        const button = items[id],
          inPins = compactIds.includes(id) && !compact[id];
        button.hidden = state.editing ? false : hidden.includes(id);
        button.classList.toggle("component", !inPins);
        button.dataset.widgetHidden = String(hidden.includes(id));
        button.dataset.widgetPinned = String(pinned.includes(id));
        const parent = inPins ? pins : track;
        parent.append(button);
        if (compact[id]) compact[id].hidden = !compactIds.includes(id);
      }
      for (const id of compactIds) pins.append(compact[id] || items[id]);
      pins.hidden = compactIds.length === 0;
      viewport.setAttribute(
        "aria-label",
        state.editing
          ? "编辑组件：拖动排序，Esc 取消"
          : "全部组件：滚轮浏览，Shift 加滚轮可在任意按钮上浏览",
      );
    }
    function browse(event, target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const primary =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      const unit =
        event.deltaMode === 1
          ? 32
          : event.deltaMode === 2
            ? vertical()
              ? target.clientHeight
              : target.clientWidth
            : 1;
      if (vertical()) target.scrollTop -= primary * unit;
      else target.scrollLeft -= primary * unit;
    }
    document.addEventListener(
      "wheel",
      (event) => {
        if (state?.editing) {
          browse(event, viewport);
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
          pinWheel = null;
          return;
        }
        const now = performance.now();
        if (
          pinWheel &&
          (now - pinWheel.time > 350 ||
            Math.hypot(
              event.clientX - pinWheel.x,
              event.clientY - pinWheel.y,
            ) >= 3)
        )
          pinWheel = null;
        if (
          pins.contains(event.target) &&
          (pinWheel ||
            event.shiftKey ||
            ![
              "volume",
              "brightness",
              "volumeDown",
              "volumeUp",
              "brightnessDown",
              "brightnessUp",
            ].includes(event.target.closest("[data-widget]")?.dataset.widget))
        ) {
          pinWheel = { time: now, x: event.clientX, y: event.clientY };
          browse(event, pins);
        }
      },
      { capture: true, passive: false },
    );
    document.addEventListener(
      "click",
      (event) => {
        if (
          (state?.editing && event.target.closest("[data-widget], .expand")) ||
          (performance.now() < suppressUntil &&
            event.target.closest("[data-widget]"))
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (!state?.editing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          api.finishWidgets(false).catch(report);
        } else if (
          event.target.closest("[data-widget]") &&
          ["Enter", " "].includes(event.key)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        const button = event.target.closest("[data-widget]");
        if (!button || event.button !== 0) return;
        gesture = {
          button,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          held: false,
          editing: !!state?.editing,
        };
        if (state?.editing) {
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          button.dataset.dragging = "true";
        } else
          holdTimer = setTimeout(() => {
            if (!gesture) return;
            gesture.held = true;
            suppressUntil = performance.now() + 1500;
            open();
          }, 520);
      },
      true,
    );
    document.addEventListener(
      "pointermove",
      (event) => {
        if (
          pinWheel &&
          Math.hypot(event.clientX - pinWheel.x, event.clientY - pinWheel.y) >=
            3
        )
          pinWheel = null;
        if (!gesture) return;
        if (
          Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5
        ) {
          gesture.moved = true;
          clearTimeout(holdTimer);
        }
        if (!state?.editing || !gesture.editing || !gesture.moved) return;
        const rect = viewport.getBoundingClientRect(),
          pos = vertical() ? event.clientY : event.clientX;
        const start = vertical() ? rect.top : rect.left,
          end = vertical() ? rect.bottom : rect.right;
        const delta = pos < start + 25 ? -16 : pos > end - 25 ? 16 : 0;
        if (vertical()) viewport.scrollTop += delta;
        else viewport.scrollLeft += delta;
        const other = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest("[data-widget]");
        if (!other || other === gesture.button || other.parentElement !== track)
          return;
        const box = other.getBoundingClientRect();
        const after =
          pos >
          (vertical() ? box.top + box.height / 2 : box.left + box.width / 2);
        track.insertBefore(gesture.button, after ? other.nextSibling : other);
      },
      true,
    );
    function release(event) {
      clearTimeout(holdTimer);
      if (!gesture) return;
      const current = gesture;
      gesture = null;
      delete current.button.dataset.dragging;
      if (current.held || current.moved || current.editing)
        suppressUntil = performance.now() + 700;
      if (
        current.editing &&
        current.moved &&
        state?.editing &&
        event.type === "pointerup"
      ) {
        const order = [...track.children]
          .map((el) => el.dataset.widget)
          .filter(Boolean);
        api.previewWidgets({ ...state.layout, order }).catch((error) => {
          signature = "";
          onChange();
          report(error);
        });
      } else if (current.editing && current.moved) {
        signature = "";
        onChange();
      }
    }
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    pins.addEventListener("focusin", (event) =>
      event.target.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    const unsubscribe = api.onWidgets(accept);
    api
      .getWidgets()
      .then((next) => {
        if (!state) accept(next);
      })
      .catch(report);
    return {
      layout,
      editing: () => !!state?.editing,
      visible: (id) => !state?.layout.hidden.includes(id),
      dispose: () => {
        clearTimeout(holdTimer);
        unsubscribe();
      },
    };
  };
})();

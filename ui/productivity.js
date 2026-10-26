'use strict';
(() => {
  const api = window.touchbar;
  let root, options, mode = null, state = null, selected = 0, completed = false, busy = false, error = '', signature = '', timer, clock, alive = true, receivedAt = performance.now();
  const el = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const icons = {
    '‹': '<path d="m14 5-7 7 7 7"/>', '›': '<path d="m10 5 7 7-7 7"/>',
    '✓': '<path d="m5 12 4 4L19 6"/>', '○': '<circle cx="12" cy="12" r="8"/>',
    '+': '<path d="M12 5v14M5 12h14"/>', '×': '<path d="m7 7 10 10M17 7 7 17"/>',
    '☷': '<path d="M10 6h10M10 12h10M10 18h10M4 6h1M4 12h1M4 18h1"/>',
    'Ⅱ': '<path d="M9 6v12M15 6v12"/>', '▶': '<path d="m9 5 10 7-10 7z"/>',
    '↺': '<path d="M5 9a8 8 0 1 1-1 6M5 3v6h6"/>',
    '▣': '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    '◷': '<circle cx="12" cy="12" r="8"/><path d="M12 7v5h5"/>',
    '✦': '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  };
  function icon(symbol) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true'); node.innerHTML = icons[symbol] || icons['○']; return node;
  }
  function button(symbol, label, action, cls = '') {
    const node = el('button', 'p-button ' + cls); node.append(icon(symbol)); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.disabled = busy;
    node.addEventListener('click', action); return node;
  }
  const date = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const duration = ms => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  async function act(op, payload = {}) {
    if (busy) return;
    busy = true; error = ''; render(true);
    try { state = await api.productivityAction(op, payload); receivedAt = performance.now(); options.onState(state); }
    catch (e) { error = String(e.message || '操作未完成').replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally { busy = false; render(true); }
  }
  async function editTodo(id = null) {
    try { await api.openTodoEditor(id); }
    catch { error = '待办编辑器无法打开'; render(true); }
  }
  function step(delta) { selected += delta; render(true); }
  function todoView() {
    const list = state.todos.filter(t => t.done === completed);
    selected = Math.max(0, Math.min(selected, list.length - 1));
    const item = list[selected];
    const filter = button(completed ? '✓' : '☷', completed ? '查看未完成待办' : '查看已完成待办', () => { completed = !completed; selected = 0; render(true); }, 'p-filter');
    filter.setAttribute('aria-pressed', String(completed));
    const content = el('div', 'p-todo-content');
    if (item) {
      content.append(button(item.done ? '✓' : '○', item.done ? '恢复待办' : '完成待办', () => act('todo.toggle', { id: item.id }), 'p-check'));
      const copy = el('button', 'p-copy'); copy.type = 'button'; copy.title = `${item.text}${item.dueAt ? '\n提醒：' + date(item.dueAt) : ''}\n点击编辑`; copy.setAttribute('aria-label', '编辑待办');
      copy.append(el('span', 'p-title', item.text), el('span', 'p-subtitle', item.done ? '已完成' : item.dueAt ? (item.dueAt <= Date.now() ? '已到时间 · ' : '') + date(item.dueAt) : '未设置提醒'));
      copy.addEventListener('click', () => editTodo(item.id)); content.append(copy);
    } else content.append(el('span', 'p-empty', completed ? '还没有已完成事项' : '把下一件事，记在这里'));
    const counter = el('span', 'p-counter', `${list.length ? selected + 1 : 0}/${list.length}`);
    root.append(filter, content, button('‹', '上一条待办', () => step(-1)), counter, button('›', '下一条待办', () => step(1)), button('+', '添加待办', () => editTodo(), 'p-add'));
    if (item) root.append(button('×', '删除当前待办', () => act('todo.delete', { id: item.id }), 'p-delete'));
  }
  function updateClock() {
    if (!state) return;
    const remaining = state.focus.status === 'running' ? Math.max(0, state.focus.remainingMs - (performance.now() - receivedAt)) : state.focus.remainingMs;
    const output = root?.querySelector('.p-clock'); if (output) output.textContent = duration(remaining);
    const ring = root?.querySelector('.p-focus-ring'); if (ring) ring.style.setProperty('--progress', `${100 * (1 - remaining / state.focus.durationMs)}%`);
  }
  function focusView() {
    const f = state.focus;
    const ring = el('span', 'p-focus-ring'); const ringIcon = el('span', 'p-focus-glyph'); ringIcon.append(icon('◷')); ring.append(ringIcon);
    const clockCopy = el('div', 'p-focus-copy');
    clockCopy.append(el('span', 'p-clock', '25:00'), el('span', 'p-subtitle', ({ idle: '准备开始', running: '专注中', paused: '已暂停', completed: '完成了 · 休息一下' })[f.status]));
    const durationInput = el('input', 'p-duration'); durationInput.type = 'number'; durationInput.min = '1'; durationInput.max = '180'; durationInput.step = '1'; durationInput.value = String(f.durationMs / 60000); durationInput.setAttribute('aria-label', '专注分钟数'); durationInput.title = '专注时间：1–180 分钟'; durationInput.disabled = busy || ['running', 'paused'].includes(f.status);
    const presets = el('div', 'p-presets'); presets.setAttribute('aria-label', '专注时间预设');
    for (const value of [15, 25, 45]) {
      const preset = el('button', 'p-preset', String(value)); preset.type = 'button'; preset.title = value + ' 分钟'; preset.setAttribute('aria-label', value + ' 分钟'); preset.disabled = durationInput.disabled;
      preset.setAttribute('aria-pressed', String(value === Number(durationInput.value)));
      preset.addEventListener('click', () => { durationInput.value = String(value); for (const other of presets.children) other.setAttribute('aria-pressed', String(other === preset)); }); presets.append(preset);
    }
    durationInput.addEventListener('input', () => { for (const preset of presets.children) preset.setAttribute('aria-pressed', String(preset.textContent === durationInput.value)); });
    const action = f.status === 'running' ? 'focus.pause' : f.status === 'paused' ? 'focus.resume' : 'focus.start';
    const start = button(f.status === 'running' ? 'Ⅱ' : '▶', f.status === 'running' ? '暂停专注' : f.status === 'paused' ? '继续专注' : '开始专注', () => act(action, { minutes: Number(durationInput.value) }), 'p-start');
    root.append(ring, clockCopy, durationInput, el('span', 'p-unit', '分钟'), presets, start, button('↺', '重置专注计时', () => act('focus.reset')));
    const tally = el('span', 'p-counter', `已完成 ${f.completed} 次`); tally.title = '累计完成的专注次数'; root.append(tally); updateClock();
  }
  function noticeView() {
    const list = state.notices;
    selected = Math.max(0, Math.min(selected, list.length - 1)); const item = list[selected];
    const content = el('div', 'p-notice-content');
    if (item) {
      const glyph = el('span', 'p-notice-glyph'); glyph.append(icon(({ todo: '✓', focus: '◷', ai: '✦', diy: '✦' })[item.kind])); glyph.dataset.kind = item.kind;
      const copy = el('button', 'p-copy'); copy.type = 'button'; copy.title = item.body + '\n' + date(item.createdAt); copy.setAttribute('aria-label', '查看提醒来源');
      copy.append(el('span', 'p-title', item.title), el('span', 'p-subtitle', item.body));
      copy.addEventListener('click', async () => { await act('notice.read', { id: item.id }); options.onNavigate(item.kind === 'diy' ? 'plugin:' + item.targetId : item.kind === 'todo' ? 'todo' : item.kind === 'focus' ? 'focus' : 'ai'); });
      content.append(glyph, copy); if (!item.read) content.append(el('span', 'p-unread'));
    } else {
      const copy = el('div', 'p-copy'); copy.append(el('span', 'p-title', '暂时没有提醒'), el('span', 'p-subtitle', '待办 · 专注 · DIY · AI 状态提醒')); content.append(copy);
    }
    root.append(content, button('‹', '上一条提醒', () => step(-1)), el('span', 'p-counter', `${list.length ? selected + 1 : 0}/${list.length}`), button('›', '下一条提醒', () => step(1)), button('✓', '全部标为已读', () => act('notice.readAll')));
    if (item) root.append(button('×', '删除当前提醒', () => act('notice.delete', { id: item.id })));
    const desktop = button('▣', state.settings.desktop ? '关闭桌面静音通知' : '开启桌面静音通知', () => act('settings.desktop', { enabled: !state.settings.desktop })); desktop.setAttribute('aria-pressed', String(state.settings.desktop)); root.append(desktop);
    root.title = '当前提醒来源：本组件的待办、专注和 AI 状态。未读取其他软件的系统通知。';
  }
  function render(force = false) {
    if (!root) return; root.hidden = !mode;
    if (!mode) return;
    const key = JSON.stringify([mode, state?.todos, state?.notices, state?.settings, state?.focus?.status, state?.focus?.durationMs, state?.focus?.completed, error, state?.error, busy, selected, completed]);
    if (!force && key === signature) { updateClock(); return; } signature = key;
    root.replaceChildren(); root.dataset.view = mode; root.title = '';
    root.append(button('‹', '返回组件', options.onClose, 'p-close'));
    const section = el('span', 'p-section-label', ({todo:'待办',focus:'专注',notices:'提醒'})[mode]); root.append(section);
    if (!state) { root.append(el('span', 'p-empty', '正在读取…')); return; }
    if (error || state.error) { const message = el('button', 'p-error', error || state.error); message.title = message.textContent; message.addEventListener('click', () => { error = ''; void refresh(); }); root.append(message); }
    if (mode === 'todo') todoView(); else if (mode === 'focus') focusView(); else noticeView();
    if (state.error) for (const input of root.querySelectorAll('button:not(.p-close), input, select')) input.disabled = true;
  }
  async function refresh() {
    if (!alive || !api?.getProductivity) return;
    try { state = await api.getProductivity(); receivedAt = performance.now(); options?.onState(state); render(); }
    catch { error = '本地数据读取失败，点击重试'; render(); }
  }
  window.productivityView = {
    mount(panel, callbacks) {
      root = panel; options = callbacks;
      root.addEventListener('wheel', event => {
        event.stopPropagation();
        if (!mode || event.target.matches('input, select')) return;
        event.preventDefault(); if (mode !== 'focus' && Math.abs(event.deltaY) > 0) step(event.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      api?.onProductivity?.(next => { state = next; receivedAt = performance.now(); options.onState(state); render(); });
      async function poll() { await refresh(); if (alive) timer = setTimeout(poll, 1000); }
      void poll(); clock = setInterval(updateClock, 250);
    },
    show(next) { if (next !== mode) { selected = 0; error = ''; signature = ''; } mode = next; render(); },
    refresh,
    dispose() { alive = false; clearTimeout(timer); clearInterval(clock); },
  };
})();

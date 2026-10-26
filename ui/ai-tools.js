'use strict';
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const POLL_MS = 10000;
  const QUOTA_FRESH_MS = 15 * 60 * 1000;
  const statusText = { running: '运行中', recent: '近期活动', idle: '空闲', unknown: '状态未知' };
  const shortStatus = { running: '运行', recent: '近期', idle: '空闲', unknown: '未知' };
  let root;
  let options = {};
  let opened = false;
  let selectedId = null;
  let state = null;
  let failure = false;
  let pending = null;
  let timer;

  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const text = (value, limit = 160) => typeof value === 'string' ? value.slice(0, limit) : '';
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function svgNode(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }
  function compact(value) {
    if (number(value) === null) return '—';
    if (value >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(value).toLocaleString('en-US');
  }
  function quotaInfo(tool) {
    const quota = tool.quota;
    const used = number(quota?.usedPercent);
    const remaining = number(quota?.remainingPercent);
    const known = used !== null && used <= 100 && remaining !== null && remaining <= 100;
    const age = Date.now() - Date.parse(quota?.updatedAt || '');
    const resetPending = !quota?.resetAt || (Number.isFinite(Date.parse(quota.resetAt)) && Date.parse(quota.resetAt) > Date.now());
    const fresh = known && Number.isFinite(age) && age >= -60000 && age <= QUOTA_FRESH_MS && resetPending;
    return { quota, known, fresh, used, remaining, warning: fresh && used >= 95 ? 'critical' : fresh && used >= 80 ? 'low' : '' };
  }
  function timestamp(value) {
    const time = new Date(value);
    if (!Number.isFinite(time.getTime())) return '更新时间未知';
    return time.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const brandIcons = { codex: 'codex.png', claude: 'claude.png', pi: 'pi.svg' };
  function icon(tool) {
    const tile = el('span', 'ai-brand-tile');
    tile.dataset.brand = Object.hasOwn(brandIcons, tool.id) ? tool.id : 'unknown';
    const file = brandIcons[tool.id];
    if (file) {
      const image = el('img', 'ai-tool-icon');
      image.src = '../assets/brands/' + file;
      image.alt = '';
      image.draggable = false;
      tile.append(image);
    } else tile.append(el('span', 'ai-brand-initial', text(tool.name, 1) || 'AI'));
    return tile;
  }
  function quotaRing(tool) {
    const info = quotaInfo(tool);
    const wrap = el('span', 'ai-quota-ring');
    wrap.dataset.known = String(info.known);
    wrap.dataset.fresh = String(info.fresh);
    if (info.warning) wrap.dataset.warning = info.warning;
    wrap.setAttribute('role', 'img');
    const label = info.known
      ? `剩余 ${Math.round(info.remaining)}%，已使用 ${Math.round(info.used)}%${info.fresh ? '' : '（非实时快照）'}；${text(info.quota.source)}；更新于 ${timestamp(info.quota.updatedAt)}`
      : '额度未知：此工具没有提供可读取的剩余额度';
    wrap.title = label;
    wrap.setAttribute('aria-label', label);
    if (!info.known) {
      wrap.append(el('span', 'ai-quota-unknown', '—'));
      return wrap;
    }
    const graphic = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    graphic.append(svgNode('circle', { class: 'ai-ring-track', cx: '12', cy: '12', r: '9.2' }));
    if (info.known) {
      const circumference = 2 * Math.PI * 9.2;
      graphic.append(svgNode('circle', { class: 'ai-ring-progress', cx: '12', cy: '12', r: '9.2', 'stroke-dasharray': `${circumference * info.remaining / 100} ${circumference}`, transform: 'rotate(-90 12 12)' }));
    }
    const value = svgNode('text', { x: '12', y: '14.6', 'text-anchor': 'middle' });
    value.textContent = info.known ? String(Math.round(info.remaining)) : '—';
    graphic.append(value);
    wrap.append(graphic);
    return wrap;
  }
  function status(tool, compactOnly = false) {
    const kind = Object.hasOwn(statusText, tool.status) ? tool.status : 'unknown';
    const line = el('span', 'ai-tool-status');
    line.dataset.status = kind;
    line.append(el('i', 'ai-status-dot'));
    line.append(el('span', compactOnly ? '' : 'ai-status-full', compactOnly ? shortStatus[kind] : statusText[kind]));
    if (!compactOnly) line.append(el('span', 'ai-status-short', shortStatus[kind]));
    return line;
  }
  function warning(tool) {
    const info = quotaInfo(tool);
    if (!info.warning) return null;
    const node = el('span', 'ai-inline-warning', info.warning === 'critical' ? '即将用尽' : '余量偏低');
    node.dataset.warning = info.warning;
    return node;
  }
  function toolCard(tool) {
    const card = el('button', 'ai-tool-card');
    card.type = 'button';
    card.dataset.toolId = tool.id;
    card.dataset.brand = Object.hasOwn(brandIcons, tool.id) ? tool.id : 'unknown';
    card.dataset.focus = 'tool:' + tool.id;
    const label = text(tool.name) || text(tool.id);
    card.setAttribute('aria-label', `${label} · ${statusText[tool.status] || statusText.unknown} · 查看 Token 活动与任务`);
    card.title = [label + (tool.provider ? ' · ' + text(tool.provider) : ''), statusText[tool.status] || statusText.unknown,
      tool.task ? text(tool.task, 240) : '未读取到当前任务', '今日 Token：' + (number(tool.todayTokens) === null ? '未知' : tool.todayTokens.toLocaleString('en-US')), text(tool.note)].filter(Boolean).join('\n');
    card.append(icon(tool));
    const copy = el('span', 'ai-card-copy');
    copy.append(el('span', 'ai-tool-name', label));
    const summary = el('span', 'ai-card-summary');
    summary.append(status(tool));
    const alert = warning(tool);
    if (alert) summary.append(alert);

    copy.append(summary);
    const allowance = el('span', 'ai-card-allowance');
    const info = quotaInfo(tool);
    allowance.append(el('span', 'ai-quota-caption', info.known ? (info.fresh ? '剩余' : '快照') : '额度未知'), quotaRing(tool));
    card.append(copy, allowance);
    card.addEventListener('click', () => { selectedId = tool.id; render(); });
    return card;
  }
  function dateKey(value) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  function activityDays(tool) {
    const anchor = Date.parse(state?.updatedAt || '');
    const today = dateKey(Number.isFinite(anchor) ? new Date(anchor) : new Date());
    const finalDay = new Date(today + 'T12:00:00+08:00');
    const amounts = new Map();
    for (const entry of Array.isArray(tool.activity) ? tool.activity : []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(entry?.date) && number(entry.tokens) !== null) amounts.set(entry.date, (amounts.get(entry.date) || 0) + entry.tokens);
    }
    const days = [];
    for (let offset = 13; offset >= 0; offset--) {
      const date = dateKey(new Date(finalDay.getTime() - offset * 86400000));
      days.push({ date, tokens: amounts.has(date) ? amounts.get(date) : null });
    }
    return days;
  }
  function heatmap(tool, days) {
    const map = el('div', 'ai-heatmap');
    map.setAttribute('role', 'img');
    map.setAttribute('aria-label', '最近 14 天的 Token 活动，颜色越亮表示记录的 Token 越多；灰格表示没有读取到记录。统计覆盖以本地已读数据为准');
    map.title = 'Token 活动 · 最近 14 天\n统计覆盖以本地已读数据为准；灰格表示未读取到记录，悬停格子查看日期和 Token 数';
    const max = Math.max(1, ...days.map(day => day.tokens || 0));
    for (const day of days) {
      const cell = el('span', 'ai-day');
      const value = day.tokens;
      cell.dataset.level = String(value === null || value <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(value / max) * 4))));
      cell.dataset.date = day.date;
      cell.title = day.date + ' · ' + (value === null ? '未读取到 Token 记录' : Math.round(value).toLocaleString('en-US') + ' tokens');
      map.append(cell);
    }
    return map;
  }
  function metric(label, value, key) {
    const node = el('div', 'ai-metric');
    node.dataset.metric = key;
    node.title = label + ' Token：' + (number(value) === null ? '未读取到数据' : Math.round(value).toLocaleString('en-US'));
    const output = el('span', 'ai-metric-value', compact(value));
    output.dataset.metric = key;
    const caption = el('span', 'ai-metric-label', label);
    if (key === 'total' && state?.partial) {
      const coverage = el('span', 'ai-coverage', '部分');
      coverage.title = '仅统计当前已读取的本地记录，未覆盖全部历史使用量';
      caption.append(coverage);
      node.title += '；部分记录：未覆盖全部历史使用量';
    }
    node.append(caption, output);
    return node;
  }
  function detail(tool) {
    const panel = el('div', 'ai-detail');
    panel.dataset.toolId = tool.id;
    panel.dataset.brand = Object.hasOwn(brandIcons, tool.id) ? tool.id : 'unknown';
    const backButton = el('button', 'ai-back');
    backButton.type = 'button';
    backButton.dataset.focus = 'back';
    backButton.setAttribute('aria-label', '返回 AI 工具列表');
    backButton.title = '返回 AI 工具列表';
    const arrow = svgNode('svg', { viewBox: '0 0 12 20', 'aria-hidden': 'true' });
    arrow.append(svgNode('path', { d: 'm8 4-5 6 5 6' }));
    backButton.append(arrow);
    backButton.addEventListener('click', back);
    const identity = el('div', 'ai-detail-identity');
    identity.title = text(tool.name) + (tool.provider ? ' · ' + text(tool.provider) : '');
    const identityCopy = el('span', 'ai-identity-copy');
    identityCopy.append(el('span', 'ai-detail-name', text(tool.name)), status(tool));
    identity.append(icon(tool), identityCopy);
    const days = activityDays(tool);
    const week = days.slice(-7).some(day => day.tokens !== null) ? days.slice(-7).reduce((sum, day) => sum + (day.tokens || 0), 0) : null;
    const metrics = el('div', 'ai-metrics');
    metrics.append(metric('今日 Token', tool.todayTokens, 'today'), metric('近 7 天', week, 'week'), metric('已读累计', tool.totalTokens, 'total'));
    const task = el('div', 'ai-task');
    task.title = [tool.task ? text(tool.task, 400) : '未读取到当前任务', tool.taskUpdatedAt ? '任务更新于 ' + timestamp(tool.taskUpdatedAt) : '', text(tool.note), '来源：' + text(tool.source), '数据更新于 ' + timestamp(state?.updatedAt)].filter(Boolean).join('\n');
    task.append(el('span', 'ai-task-caption', tool.status === 'running' ? '当前任务' : '最近任务'));
    task.append(el('span', 'ai-task-text', tool.task ? text(tool.task, 400) : '暂未读取到任务'));
    task.append(el('span', 'ai-task-short', tool.task ? text(tool.task, 12) : '暂无任务'));
    const quota = el('div', 'ai-detail-quota');
    quota.append(quotaRing(tool));
    const alert = warning(tool);
    if (alert) quota.append(alert);
    const activity = el('div', 'ai-activity');
    activity.append(el('span', 'ai-activity-label', '近 14 天'), heatmap(tool, days));
    panel.append(backButton, identity, metrics, activity, task, quota);
    return panel;
  }
  function message(label, subtitle, retry = false) {
    const wrap = el('div', 'ai-message');
    wrap.setAttribute('role', 'status');
    wrap.title = label + (subtitle ? ' · ' + subtitle : '');
    const copy = el('div', 'ai-message-copy');
    copy.append(el('span', 'ai-message-title', label));
    if (subtitle) copy.append(el('span', 'ai-message-subtitle', subtitle));
    wrap.append(copy);
    if (retry) {
      const button = el('button', 'ai-retry', '刷新');
      button.type = 'button';
      button.setAttribute('aria-label', '重新读取 AI 工具状态');
      button.disabled = pending !== null;
      button.addEventListener('click', refresh);
      wrap.append(button);
    }
    return wrap;
  }
  function render() {
    if (!root || !opened) return;
    const activeFocus = root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const previous = root.querySelector('.ai-overview, .ai-detail');
    const previousKey = previous?.classList.contains('ai-detail') ? 'detail:' + previous.dataset.toolId : previous ? 'overview' : null;
    const scroll = previous ? { key: previousKey, left: previous.scrollLeft, top: previous.scrollTop } : null;
    root.replaceChildren();
    root.dataset.stale = String(failure);
    if (!state) {
      root.append(message(failure ? '读取失败' : '读取中', failure ? '点击刷新重新读取本机记录' : '正在发现本机 AI 工具', failure));
      return;
    }
    const tools = state.tools.filter(tool => tool && typeof tool.id === 'string');
    if (!tools.length) {
      selectedId = null;
      root.append(message('尚未发现', '未找到支持的本地 AI 使用记录', true));
      return;
    }
    const selected = tools.find(tool => tool.id === selectedId);
    if (selected) root.append(detail(selected));
    else {
      selectedId = null;
      const overview = el('div', 'ai-overview');
      overview.setAttribute('aria-label', '本机 AI 工具');
      for (const tool of tools) overview.append(toolCard(tool));
      root.append(overview);
    }
    if (failure) {
      const stale = el('button', 'ai-stale', '!');
      stale.type = 'button';
      stale.title = '刷新失败；显示上次读取的数据，更新于 ' + timestamp(state.updatedAt) + '。点击重试';
      stale.setAttribute('aria-label', stale.title);
      stale.addEventListener('click', refresh);
      root.append(stale);
    }
    const viewport = root.querySelector('.ai-overview, .ai-detail');
    const viewKey = viewport?.classList.contains('ai-detail') ? 'detail:' + viewport.dataset.toolId : viewport ? 'overview' : null;
    // Refreshing a view preserves its position; entering another view starts at
    // its beginning so the back button never inherits an off-screen offset.
    if (scroll && viewport && scroll.key === viewKey) { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; }
    if (activeFocus) [...root.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === activeFocus)?.focus({ preventScroll: true });
  }
  async function refresh() {
    if (!root) return null;
    if (pending) return pending;
    clearTimeout(timer);
    pending = Promise.resolve().then(async () => {
      try {
        if (typeof window.touchbar?.getAIState !== 'function') throw new Error('AI bridge unavailable');
        const next = await window.touchbar.getAIState();
        if (!next || !Array.isArray(next.tools)) throw new Error('Invalid AI state');
        state = next;
        failure = false;
        if (typeof options.onState === 'function') { try { options.onState(next); } catch { /* Badge callbacks cannot break the activity view. */ } }
        return next;
      } catch {
        failure = true;
        if (typeof options.onState === 'function') { try { options.onState(null); } catch { /* Clear stale entry alerts even when refresh fails. */ } }
        return null;
      } finally {
        pending = null;
        render();
        if (opened) timer = setTimeout(refresh, POLL_MS);
      }
    });
    return pending;
  }
  function mount(node, callbacks = {}) {
    if (root && root !== node) throw new Error('AI view already mounted');
    if (root) return;
    root = node;
    options = callbacks;
    root.classList.add('ai-panel');
    root.hidden = true;
    root.setAttribute('aria-label', 'AI 工具活动');
    root.addEventListener('wheel', event => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      const viewport = root.querySelector('.ai-overview, .ai-detail');
      if (!viewport) return;
      const vertical = document.body.dataset.orientation === 'vertical';
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      const factor = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? (vertical ? viewport.clientHeight : viewport.clientWidth) : 1;
      if (vertical) viewport.scrollTop -= delta * factor;
      else viewport.scrollLeft -= delta * factor;
    }, { passive: false });
  }
  function open() {
    if (!root) return;
    if (!opened) selectedId = null;
    opened = true;
    root.hidden = false;
    render();
    refresh();
  }
  function close() {
    opened = false;
    clearTimeout(timer);
    if (root) root.hidden = true;
  }
  function back() {
    if (!opened) return false;
    if (selectedId !== null) { selectedId = null; render(); }
    else { close(); if (typeof options.onClose === 'function') options.onClose(); }
    return true;
  }
  window.aiToolsView = Object.freeze({ mount, open, close, isOpen: () => opened, refresh, back });
})();

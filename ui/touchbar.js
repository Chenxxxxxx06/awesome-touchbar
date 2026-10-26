'use strict';
(() => {
  const api = window.touchbar;
  const aiView = window.aiToolsView;
  const aiPanel = document.querySelector('#ai-panel');
  const aiButton = document.querySelector('#ai-button');
  let aiOpen = false;
  let musicOpen = false;
  let diyOpen = false;
  const diyView = window.diyView;
  let productivityOpen = null;
  const productivityView = window.productivityView;
  const noticeButton = document.querySelector('#notice-button');
  const todoButton = document.querySelector('#todo-button');
  const focusButton = document.querySelector('#focus-button');
  const musicView = window.musicView;
  const musicButton = document.querySelector('#music-button');
  let aiStatusTimer;
  let aiStatusPending = false;
  const components = document.querySelector('#components');
  const componentTrack = document.querySelector('.component-track');
  const adjustmentButtons = [...document.querySelectorAll('[data-adjust]')];
  const muteButtons = [...document.querySelectorAll('[data-mute]')];
  let expanded = false;
  let widgets;
  const wheelRemainder = { brightness: 0, volume: 0 };
  let wheelKind = null;
  let wheelTime = 0;
  let wheelRoute = null;
  const feedbackTimers = new WeakMap();
  const panel = document.querySelector('#adjustment');
  const slider = document.querySelector('#adjustment-slider');
  const output = document.querySelector('#adjustment-value');
  const sliderControls = document.querySelector('.slider-controls');
  const status = document.querySelector('.control-status');
  const feedback = document.querySelector('.control-feedback');
  const retryButton = document.querySelector('.retry-control');
  const brightnessButton = document.querySelector('#brightness-button');
  const volumeButton = document.querySelector('#volume-button');
  const muteButton = document.querySelector('#mute-button');
  const expandButton = document.querySelector('.expand');
  const closeButton = document.querySelector('.close-adjustment');
  const escapeButton = document.querySelector('.escape');
  let state = { audio: { available: false, volume: null, muted: null, deviceId: null }, brightness: { available: false, value: null } };
  let loading = true;
  let refreshing = false;
  const lastKnown = { volume: null, brightness: null };
  let mode = null;
  let pointerEditing = false;
  let editingValue = null;
  let stateRevision = 0;
  let interactingTimer;
  let queueTimer;
  let sending = false;
  let sequence = 0;
  let audioGeneration = 0;
  let audioNeedsGesture = false;
  const queued = [];
  const desired = {};
  const newest = {};
  const errors = {};
  const labels = { volume: '音量', brightness: '亮度' };
  const validPercent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

  function applyLayout(layout) {
    const vertical = layout.orientation === 'vertical';
    document.body.dataset.orientation = vertical ? 'vertical' : 'horizontal';
    document.body.dataset.edge = layout.edge;
    slider.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    components.scrollLeft = 0;
    components.scrollTop = 0;
    render();
  }

  function invalidateAudio() {
    audioGeneration++;
    wheelRemainder.volume = 0;
    for (let index = queued.length - 1; index >= 0; index--) {
      if (queued[index].kind !== 'brightness') queued.splice(index, 1);
    }
    delete desired.volume;
    delete desired.muted;
    delete errors.volume;
    delete errors.muted;
    audioNeedsGesture = true;
    if (mode === 'volume') {
      pointerEditing = false;
      editingValue = null;
    }
  }

  function oldAudioRequest(request) {
    return request.kind !== 'brightness' &&
      (request.deviceId !== state.audio.deviceId || request.audioGeneration !== audioGeneration);
  }

  function acceptState(next) {
    if (!next || typeof next !== 'object') return;
    const audio = next.audio || {};
    const brightness = next.brightness || {};
    const deviceId = typeof audio.deviceId === 'string' && audio.deviceId.length > 0 ? audio.deviceId : null;
    if (state.audio.deviceId && state.audio.deviceId !== deviceId) invalidateAudio();
    state = {
      audio: { available: audio.available === true && deviceId !== null && validPercent(audio.volume) && typeof audio.muted === 'boolean', volume: validPercent(audio.volume) ? audio.volume : null, muted: typeof audio.muted === 'boolean' ? audio.muted : null, deviceId },
      brightness: { available: brightness.available === true && validPercent(brightness.value), value: validPercent(brightness.value) ? brightness.value : null },
    };
    if (state.audio.available) lastKnown.volume = state.audio.volume;
    if (state.brightness.available) lastKnown.brightness = state.brightness.value;
    loading = false;
    render();
  }

  function showInteraction() {
    clearTimeout(interactingTimer);
    panel.dataset.interacting = 'true';
    interactingTimer = setTimeout(() => { if (!pointerEditing) panel.dataset.interacting = 'false'; }, 900);
  }

  function render() {
    const muted = desired.muted ?? state.audio.muted;
    muteButton.disabled = loading || !state.audio.available;
    muteButton.setAttribute('aria-pressed', String(muted === true));
    muteButton.setAttribute('aria-label', muted === true ? '取消静音' : '静音');
    muteButton.title = state.audio.available ? (muted ? '取消静音' : '静音') : (loading ? '正在读取音量' : '没有可用的音频设备');
    // The entry always means volume; the separate mute key alone shows mute state.
    brightnessButton.title = loading ? '正在读取亮度' : (state.brightness.available ? '亮度' : '此屏幕暂不支持亮度调节');
    volumeButton.title = state.audio.available ? (muted ? '音量（当前静音）' : '音量') : (loading ? '正在读取音量' : '没有可用的音频设备');
    brightnessButton.setAttribute('aria-expanded', String(mode === 'brightness'));
    volumeButton.setAttribute('aria-expanded', String(mode === 'volume'));
    document.body.dataset.expanded = String(expanded);
    components.hidden = !expanded || mode !== null || aiOpen || musicOpen || diyOpen || !!productivityOpen;
    document.body.dataset.productivityOpen = String(!!productivityOpen);
    productivityView?.show(productivityOpen);
    noticeButton.setAttribute('aria-expanded', String(productivityOpen === 'notices'));
    widgets?.layout({ browsing: !components.hidden, detail: diyOpen ? 'diy' : aiOpen ? 'ai' : musicOpen ? 'music' : productivityOpen });
    diyView?.show(diyOpen);
    document.body.dataset.diyOpen = String(diyOpen);
    document.body.dataset.musicOpen = String(musicOpen);
    musicButton.setAttribute('aria-expanded', String(musicOpen));
    musicView?.show(!mode && !aiOpen && !productivityOpen && !diyOpen && !widgets?.editing() && widgets?.visible('music') !== false && (!expanded || musicOpen), musicOpen);
    document.body.dataset.aiOpen = String(aiOpen);
    aiButton.setAttribute('aria-expanded', String(aiOpen));
    expandButton.setAttribute('aria-expanded', String(expanded));
    expandButton.setAttribute('aria-label', expanded ? '收起组件' : '展开组件');
    expandButton.title = expanded ? '收起组件 · 滚轮浏览组件' : '展开组件';
    expandButton.querySelector('path').setAttribute('d', expanded ? 'm4 4 5 6-5 6' : 'm8 4-5 6 5 6');
    for (const button of adjustmentButtons) {
      const kind = button.dataset.adjust;
      const available = kind === 'volume' ? state.audio.available : state.brightness.available;
      const value = desired[kind] ?? (kind === 'volume' ? state.audio.volume : state.brightness.value);
      button.disabled = !widgets?.editing() && (loading || refreshing || !available);
      const hint = kind === 'volume' && audioNeedsGesture ? '点击音量确认新设备' : '滚轮调节；Shift + 滚轮浏览';
      button.title = `${button.getAttribute('aria-label')} · ${available ? Math.round(value) + '%' : '不可用'} · ${hint}`;
    }
    for (const button of muteButtons) {
      button.disabled = !widgets?.editing() && muteButton.disabled;
      button.setAttribute('aria-pressed', String(muted === true));
      button.setAttribute('aria-label', muted === true ? '取消静音' : '静音');
      button.title = muteButton.title;
    }
    panel.hidden = mode === null;
    if (!mode) return;
    panel.dataset.mode = mode;
    panel.setAttribute('aria-label', labels[mode] + '调节');
    slider.setAttribute('aria-label', labels[mode]);
    document.querySelector('.brightness-symbol').toggleAttribute('hidden', mode !== 'brightness');
    document.querySelector('.volume-symbol').toggleAttribute('hidden', mode !== 'volume');
    const available = mode === 'volume' ? state.audio.available : state.brightness.available;
    const error = errors[mode] || (mode === 'volume' && errors.muted);
    const deviceChanged = mode === 'volume' && audioNeedsGesture;
    const message = loading || refreshing ? '读取中…' : !available ? (mode === 'brightness' ? '此屏幕暂不支持亮度调节' : '没有可用的音频设备') : deviceChanged ? '音频设备已切换，请重新调节' : error ? '调节失败，请重试' : '';
    feedback.hidden = message === '';
    panel.dataset.status = String(message !== '');
    status.textContent = message;
    status.title = message;
    retryButton.title = message ? message + '；点击重新读取状态' : '重新读取状态';
    retryButton.setAttribute('aria-label', retryButton.title);
    retryButton.disabled = loading || refreshing || sending;
    retryButton.querySelector('.retry-label').textContent = loading || refreshing ? '稍候' : '重试';
    sliderControls.hidden = !available && !validPercent(lastKnown[mode]);
    slider.disabled = loading || refreshing || !available || !!error || deviceChanged;
    let value = desired[mode] ?? (mode === 'volume' ? state.audio.volume : state.brightness.value) ?? lastKnown[mode];
    if (pointerEditing && editingValue !== null) value = editingValue;
    if (!validPercent(value)) value = 0;
    value = Math.round(value);
    slider.value = String(value);
    slider.style.setProperty('--level', value + '%');
    slider.setAttribute('aria-valuetext', (!available || error ? '上次读取到 ' : '') + value + '%');
    output.value = value + '%';
  }

  function open(nextMode) {
    diyOpen = false;
    productivityOpen = null;
    musicOpen = false;
    if (aiOpen) closeAi();
    wheelRoute = null;
    pointerEditing = false;
    editingValue = null;
    mode = nextMode;
    if (nextMode) {
      delete errors[nextMode];
      if (nextMode === 'volume') { delete errors.muted; audioNeedsGesture = false; }
    }
    render();
  }

  function queueWrite(kind, value) {
    if (widgets?.editing()) return;
    if (kind !== 'brightness' && (!state.audio.available || !state.audio.deviceId || audioNeedsGesture)) return;
    const id = ++sequence;
    desired[kind] = value;
    newest[kind] = id;
    delete errors[kind];
    // Only adjacent updates of the same kind coalesce, preserving mute/volume ordering.
    if (queued.length && queued[queued.length - 1].kind === kind) queued.pop();
    queued.push({ kind, value, id, ...(kind === 'brightness' ? {} : { deviceId: state.audio.deviceId, audioGeneration }) });
    render();
    if (!sending && !queueTimer) queueTimer = setTimeout(flushQueue, 60);
  }

  async function flushQueue() {
    clearTimeout(queueTimer);
    queueTimer = undefined;
    if (sending || queued.length === 0) return;
    sending = true;
    const request = queued.shift();
    try {
      if (oldAudioRequest(request)) return;
      const methods = { volume: 'setVolume', brightness: 'setBrightness', muted: 'setMuted' };
      const method = methods[request.kind];
      if (!api || typeof api[method] !== 'function') throw new Error('Control unavailable');
      const next = request.kind === 'brightness'
        ? await api[method](request.value)
        : await api[method](request.value, request.deviceId);
      if (oldAudioRequest(request)) return;
      const section = request.kind === 'brightness' ? next?.brightness : next?.audio;
      if (!section || section.available !== true || section.error) {
        if (next) acceptState(next);
        throw new Error('Control not applied');
      }
      if (newest[request.kind] === request.id) delete desired[request.kind];
      acceptState(next);
    } catch {
      if (oldAudioRequest(request)) return;
      // Do not leave a simulated successful value on a failed system write.
      for (let index = queued.length - 1; index >= 0; index--) {
        if (queued[index].kind === request.kind) queued.splice(index, 1);
      }
      delete desired[request.kind];
      errors[request.kind] = true;
      pointerEditing = false;
      editingValue = null;
      for (const button of document.querySelectorAll('[data-wheel-value]')) {
        clearTimeout(feedbackTimers.get(button));
        delete button.dataset.wheelValue;
      }
      // Wheel errors must be visible even when the inline panel was closed.
      if (aiOpen) closeAi();
      mode = request.kind === 'muted' ? 'volume' : request.kind;
      render();
    } finally {
      sending = false;
      render();
      if (queued.length) queueTimer = setTimeout(flushQueue, 60);
    }
  }

  async function refreshControls() {
    if (refreshing || sending || !api || typeof api.getControls !== 'function') return;
    // Retry means read again, never replay failed or queued setting changes.
    clearTimeout(queueTimer);
    queueTimer = undefined;
    queued.length = 0;
    for (const key of Object.keys(desired)) delete desired[key];
    pointerEditing = false;
    editingValue = null;
    refreshing = true;
    render();
    const revision = stateRevision;
    try {
      const next = await api.getControls();
      if (revision === stateRevision) acceptState(next);
      for (const key of Object.keys(errors)) delete errors[key];
      if (state.audio.available) audioNeedsGesture = false;
    } catch {
      loading = false;
      if (mode) errors[mode] = true;
    } finally {
      refreshing = false;
      render();
    }
  }
  retryButton.addEventListener('click', refreshControls);

  brightnessButton.addEventListener('click', () => open(mode === 'brightness' ? null : 'brightness'));
  volumeButton.addEventListener('click', () => open(mode === 'volume' ? null : 'volume'));
  expandButton.addEventListener('click', () => {
    expanded = !expanded;
    open(null);
    components.scrollLeft = 0;
    components.scrollTop = 0;
  });
  closeButton.addEventListener('click', () => open(null));
  function escape() {
    if (widgets?.editing()) { api.finishWidgets(false).catch(() => {}); return; }
    if (diyOpen) { diyView?.back(); return; }
    if (productivityOpen) { productivityOpen = null; render(); return; }
    if (musicOpen) { musicOpen = false; render(); return; }
    if (aiOpen) { aiView.back(); return; }
    if (mode) open(null);
    else { expanded = false; render(); }
  }
  escapeButton.addEventListener('click', escape);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (mode || expanded || aiOpen || musicOpen || diyOpen || productivityOpen)) { event.preventDefault(); escape(); }
  });
  function toggleMute() {
    if (!state.audio.available || loading) return;
    // A new explicit button click acknowledges the currently displayed output device.
    audioNeedsGesture = false;
    queueWrite('muted', !(desired.muted ?? state.audio.muted));
  }
  muteButton.addEventListener('click', toggleMute);
  for (const button of muteButtons) button.addEventListener('click', toggleMute);
  slider.addEventListener('pointerdown', () => {
    pointerEditing = true;
    editingValue = Number(slider.value);
    showInteraction();
  });
  slider.addEventListener('input', () => {
    if (!mode || slider.disabled) return;
    const value = Number(slider.value);
    if (!validPercent(value)) return;
    editingValue = pointerEditing ? value : null;
    showInteraction();
    queueWrite(mode, value);
  });
  function finishEditing() {
    if (!pointerEditing) return;
    pointerEditing = false;
    editingValue = null;
    showInteraction();
    flushQueue();
    render();
  }
  window.addEventListener('pointerup', finishEditing);
  window.addEventListener('pointercancel', finishEditing);
  window.addEventListener('blur', finishEditing);
  slider.addEventListener('change', () => { flushQueue(); });


  function flashValue(button, value) {
    if (!button) return;
    clearTimeout(feedbackTimers.get(button));
    button.dataset.wheelValue = Math.round(value) + '%';
    feedbackTimers.set(button, setTimeout(() => delete button.dataset.wheelValue, 1000));
  }

  function adjustBy(kind, change, button) {
    const available = kind === 'volume' ? state.audio.available : state.brightness.available;
    if (loading || refreshing || pointerEditing || !available || errors[kind] ||
        (kind === 'volume' && (audioNeedsGesture || errors.muted))) return;
    const value = desired[kind] ?? (kind === 'volume' ? state.audio.volume : state.brightness.value);
    if (!validPercent(value)) return;
    const next = Math.min(100, Math.max(0, value + change));
    flashValue(button, next);
    showInteraction();
    if (next !== value) queueWrite(kind, next);
  }

  for (const button of adjustmentButtons) {
    button.addEventListener('click', () => {
      const kind = button.dataset.adjust;
      if (button.dataset.step) {
        // A fresh click is explicit acknowledgement of the currently shown device.
        if (kind === 'volume') audioNeedsGesture = false;
        adjustBy(kind, Number(button.dataset.step) * 2, button);
      } else open(kind);
    });
  }

  for (const button of document.querySelectorAll('[data-action]')) {
    const originalTitle = button.title;
    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      delete button.dataset.failed;
      try {
        if (typeof api?.runAction !== 'function') throw new Error('Unavailable');
        await api.runAction(button.dataset.action);
        button.title = originalTitle;
      } catch {
        button.dataset.failed = 'true';
        button.title = originalTitle + '：操作未完成，请松开修饰键后重试';
      } finally { button.setAttribute('aria-busy', 'false'); }
    });
  }

  function browseComponents(event) {
    if (!expanded || mode || aiOpen || components.hidden) return;
    event.preventDefault();
    const vertical = document.body.dataset.orientation === 'vertical';
    const primary = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? (vertical ? components.clientHeight : components.clientWidth) : 1;
    // Wheel up reveals later components: the contents move left/up.
    const delta = -primary * unit;
    const fits = vertical ? components.scrollHeight <= components.clientHeight + 1 : components.scrollWidth <= components.clientWidth + 1;
    components.dataset.scrollHint = fits ? '已显示全部组件' : '';
    clearTimeout(components._hintTimer);
    components._hintTimer = setTimeout(() => { delete components.dataset.scrollHint; }, 1100);
    if (vertical) components.scrollTop += delta;
    else components.scrollLeft += delta;
  }

  // Keep a continuous wheel gesture on its original job. Scrolling a volume
  // button underneath a stationary pointer must never turn navigation into audio.
  document.addEventListener('pointermove', event => {
    if (wheelRoute && Math.hypot(event.clientX - wheelRoute.x, event.clientY - wheelRoute.y) >= 3)
      wheelRoute = null;
  });
  document.querySelector('.touch-bar').addEventListener('wheel', event => {
    if (diyOpen && document.querySelector('#diy-panel').contains(event.target)) { wheelRoute = null; return; }
    if (aiOpen && aiPanel.contains(event.target)) { wheelRoute = null; return; }
    if (event.ctrlKey || event.metaKey || event.altKey) { wheelRoute = null; return; }
    const now = performance.now();
    const moved = wheelRoute && Math.hypot(event.clientX - wheelRoute.x, event.clientY - wheelRoute.y) >= 3;
    if (!wheelRoute || now - wheelRoute.time > 350 || moved) {
      const button = event.target.closest('button');
      let kind = button?.dataset.adjust;
      if (button === brightnessButton) kind = 'brightness';
      if (button === volumeButton) kind = 'volume';
      if (event.target === slider) kind = mode;
      wheelRoute = { kind: event.shiftKey || !kind ? 'browse' : kind, button,
        slider: event.target === slider, time: now, x: event.clientX, y: event.clientY };
      wheelRemainder.volume = wheelRemainder.brightness = 0;
    }
    wheelRoute.time = now;
    // Shift can always choose browsing; releasing it does not change that gesture.
    if (event.shiftKey) wheelRoute.kind = 'browse';
    if (wheelRoute.kind === 'browse') { browseComponents(event); return; }
    event.preventDefault();
    if (!event.deltaY || (wheelRoute.slider && slider.disabled)) return;
    const kind = wheelRoute.kind;
    if (wheelKind !== kind || now - wheelTime > 350 || Math.sign(wheelRemainder[kind]) !== Math.sign(-event.deltaY)) wheelRemainder[kind] = 0;
    wheelKind = kind;
    wheelTime = now;
    const units = event.deltaMode === 1 ? event.deltaY / 3 : event.deltaMode === 2 ? event.deltaY : event.deltaY / 100;
    wheelRemainder[kind] += -units;
    const steps = Math.trunc(wheelRemainder[kind]);
    if (!steps) return;
    wheelRemainder[kind] -= steps;
    adjustBy(kind, Math.max(-3, Math.min(3, steps)) * 2, wheelRoute.button);
  }, { passive: false });

  componentTrack.addEventListener('focusin', event => {
    if (expanded && !mode) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });


  function updateAiBadge(next) {
    const now = Date.now();
    const limited = (next?.tools || []).filter(tool => {
      const quota = tool.quota;
      return quota && Number.isFinite(quota.usedPercent) && quota.usedPercent >= 80 &&
        Number.isFinite(Date.parse(quota.updatedAt)) && now - Date.parse(quota.updatedAt) >= -60000 && now - Date.parse(quota.updatedAt) <= 15 * 60000 &&
        (!quota.resetAt || Date.parse(quota.resetAt) > now);
    });
    aiButton.querySelector('.ai-alert-dot').hidden = limited.length === 0;
    aiButton.dataset.alert = limited.some(tool => tool.quota.usedPercent >= 95) ? 'critical' : limited.length ? 'low' : '';
    aiButton.title = limited.length
      ? '额度提醒：' + limited.map(tool => tool.name + ' 剩余 ' + Math.round(tool.quota.remainingPercent) + '%').join('；')
      : 'AI 工具：本机状态与 Token 活动';
  }

  function openProductivity(view) {
    if (!['todo', 'focus', 'notices'].includes(view)) return;
    open(null); productivityOpen = view; render();
  }
  productivityView?.mount(document.querySelector('#productivity-panel'), {
    onClose: () => { productivityOpen = null; render(); },
    onNavigate: view => { if (view.startsWith('plugin:')) { diyView?.openPlugin(view.slice(7)); return; } if (view === 'ai') aiButton.click(); else openProductivity(view); },
    onState: state => {
      noticeButton.querySelector('.productivity-dot').hidden = !state.unread;
      noticeButton.title = state.unread ? `提醒中心 · ${state.unread} 条未读` : '提醒中心';
      todoButton.querySelector('.productivity-dot').hidden = !state.notices.some(n => n.kind === 'todo' && !n.read);
      focusButton.querySelector('.productivity-dot').hidden = !state.notices.some(n => n.kind === 'focus' && !n.read);
      focusButton.dataset.running = String(state.focus.status === 'running');
      focusButton.title = state.focus.status === 'running' ? `专注中 · 剩余 ${Math.ceil(state.focus.remainingMs / 60000)} 分钟` : '专注计时';
      todoButton.title = `待办事项 · ${state.todos.filter(t => !t.done).length} 条未完成`;
    },
  });
  todoButton.addEventListener('click', () => openProductivity('todo'));
  focusButton.addEventListener('click', () => openProductivity('focus'));
  noticeButton.addEventListener('click', () => { if (productivityOpen === 'notices') { productivityOpen = null; render(); } else openProductivity('notices'); });
  api?.onProductivityOpen?.(openProductivity);

  function openMusic() {
    open(null);
    musicOpen = true;
    render();
  }
  musicView?.mount(document.querySelector('#music-panel'), {
    onOpen: openMusic,
    onClose: () => { musicOpen = false; render(); },
  });
  musicButton.addEventListener('click', () => {
    if (musicOpen) { musicOpen = false; render(); }
    else openMusic();
  });

  function closeAi() {
    aiOpen = false;
    aiView?.close();
    wheelRoute = null;
    render();
  }
  aiView?.mount(aiPanel, { onClose: closeAi, onState: updateAiBadge });
  aiButton.addEventListener('click', () => {
    if (aiOpen) { closeAi(); return; }
    open(null);
    aiOpen = true;
    render();
    aiView?.open();
  });
  // Background reminders only read the backend's local, cached snapshot.
  async function refreshAiBadge() {
    if (!aiOpen && !aiStatusPending && typeof api?.getAIState === 'function') {
      aiStatusPending = true;
      try { updateAiBadge(await api.getAIState()); } catch { updateAiBadge(null); }
      finally { aiStatusPending = false; }
    }
    aiStatusTimer = setTimeout(refreshAiBadge, 60000);
  }
  aiStatusTimer = setTimeout(refreshAiBadge, 3000);
  window.addEventListener('beforeunload', () => { clearTimeout(aiStatusTimer); aiView?.close(); musicView?.dispose(); productivityView?.dispose(); widgets?.dispose(); diyView?.dispose(); });

  diyView?.mount(document.querySelector('#diy-panel'), {
    onOpen: () => { open(null); diyOpen = true; render(); },
    onClose: () => { diyOpen = false; render(); },
    onInstalled: () => { expanded = true; open(null); setTimeout(() => { if (expanded && !diyOpen) { components.scrollLeft = components.scrollWidth; components.scrollTop = components.scrollHeight; } }, 100); },
  });
  widgets = window.widgetLayout?.({
    onChange: render,
    onEdit: () => {
      clearTimeout(queueTimer); queueTimer = undefined; queued.length = 0;
      for (const key of Object.keys(desired)) delete desired[key];
      expanded = true; open(null);
    },
  });

  // Initialization and external system updates are strictly read-only.
  if (api) {
    if (typeof api.onLayout === 'function') api.onLayout(applyLayout);
    if (typeof api.getLayout === 'function') api.getLayout().then(applyLayout).catch(() => {});
    if (typeof api.onControls === 'function') api.onControls(next => { stateRevision++; acceptState(next); });
    if (typeof api.getControls === 'function') {
      const revision = stateRevision;
      api.getControls().then(next => { if (revision === stateRevision) acceptState(next); }).catch(() => { loading = false; render(); });
    } else loading = false;
  } else loading = false;
  render();
})();

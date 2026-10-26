'use strict';
(() => {
  const api = window.touchbar;
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
  let lastMode = 'volume';
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
    render();
  }

  function invalidateAudio() {
    audioGeneration++;
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
    expandButton.setAttribute('aria-expanded', String(mode !== null));
    expandButton.setAttribute('aria-label', mode ? '收起调节' : '展开调节');
    expandButton.querySelector('path').setAttribute('d', mode ? 'm4 4 5 6-5 6' : 'm8 4-5 6 5 6');
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
    pointerEditing = false;
    editingValue = null;
    mode = nextMode;
    if (nextMode) {
      lastMode = nextMode;
      delete errors[nextMode];
      if (nextMode === 'volume') { delete errors.muted; audioNeedsGesture = false; }
    }
    render();
  }

  function queueWrite(kind, value) {
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
      if (request.kind === 'muted') mode = 'volume';
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
  expandButton.addEventListener('click', () => open(mode ? null : lastMode));
  closeButton.addEventListener('click', () => open(null));
  escapeButton.addEventListener('click', () => open(null));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mode) { event.preventDefault(); open(null); }
  });
  muteButton.addEventListener('click', () => {
    if (!state.audio.available || loading) return;
    // A new explicit button click acknowledges the currently displayed output device.
    audioNeedsGesture = false;
    queueWrite('muted', !(desired.muted ?? state.audio.muted));
  });
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

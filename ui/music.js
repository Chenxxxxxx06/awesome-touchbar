'use strict';
(() => {
  const api = window.touchbar;
  let root, onOpen, tracks = [], selected = null, pinned = null, snapshotAt = 0;
  let allowed = true, detailed = false, reading = false, alive = true, seeking = false, editing = null;
  let lyrics = { status: 'missing', lines: [] }, lyricToken = null, lyricGeneration = 0, error = '', timer, clock;
  const time = n => `${Math.floor(Math.max(0, n) / 60)}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, '0')}`;
  const create = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text) el.textContent = text; return el; };
  let summary, title, lyric, progress, slider, stamp, source, importer, close;
  function position() {
    if (!selected) return 0;
    const elapsed = selected.playing ? Math.min(5, (performance.now() - snapshotAt) / 1000) * (selected.rate ?? 1) : 0;
    return Math.min(selected.duration, Math.max(0, selected.position + elapsed));
  }
  function updateText() {
    if (!root || root.hidden) return;
    const value = editing ? Number(slider.value) : position();
    if (!editing) slider.value = String(value);
    slider.style.setProperty('--music-level', `${selected?.duration > 0 ? value / selected.duration * 100 : 0}%`);
    stamp.textContent = `${time(value)} / ${time(selected?.duration || 0)}`;
    slider.setAttribute('aria-valuetext', stamp.textContent);
    const messages = { loading: '正在匹配歌词…', offline: '歌词暂时无法连接 · 可导入 LRC', unsynced: '暂无逐句歌词 · 可导入 LRC', missing: '未找到歌词 · 可导入 LRC', instrumental: '纯音乐' };
    let line = '';
    for (const item of lyrics.lines || []) { if (item.time > value) break; line = item.text; }
    const text = error || (!selected ? '未检测到媒体 · 请开启播放器系统媒体控制' : lyrics.status === 'synced' ? line || '♪ 等待第一句' : messages[lyrics.status] || '');
    if (lyric.textContent !== text) lyric.textContent = text;
    lyric.title = text + (lyrics.source ? ` · ${lyrics.source}` : '');
    root.dataset.playing = String(!!selected?.playing);
  }
  function render() {
    if (!root) return;
    root.hidden = !allowed || (!detailed && !selected);
    root.dataset.detailed = String(detailed);
    title.textContent = selected ? `${selected.title || '未知歌曲'}${selected.artist ? ' · ' + selected.artist : ''}` : '音乐';
    title.title = selected ? `${title.textContent} · ${selected.source}` : '未读取到媒体会话。请在播放器中开启系统媒体控制 / SMTC；Bilibili 等网页需浏览器和网页提供媒体信息。';
    progress.hidden = !detailed || !selected;
    source.hidden = !detailed || tracks.length < 2;
    importer.hidden = !detailed || !selected;
    close.hidden = !detailed;
    slider.disabled = !selected?.seekable || seeking;
    slider.min = String(selected?.minSeek || 0);
    slider.max = String(selected?.maxSeek || selected?.duration || 1);
    slider.title = selected?.seekable ? '点击或拖动进度；松手后跳转' : '此播放器未开放进度调节';
    slider.setAttribute('aria-orientation', document.body.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal');
    const signature = JSON.stringify(tracks.map(t => [t.token, t.title, t.source]));
    if (source.dataset.signature !== signature) {
      source.replaceChildren();
      for (const t of tracks) { const o = document.createElement('option'); o.value = t.token; o.textContent = `${t.title || '未知歌曲'} · ${t.source}`; source.append(o); }
      source.dataset.signature = signature;
    }
    source.value = selected?.token || '';
    updateText();
    if (allowed && selected && lyricToken !== selected.token) void loadLyrics();
  }
  async function loadLyrics(force = false) {
    if (!selected || (!force && lyricToken === selected.token)) return;
    const token = selected.token, generation = ++lyricGeneration;
    lyricToken = token; lyrics = { status: 'loading', lines: [] }; updateText();
    try {
      const next = await api.getMusicLyrics(token);
      if (alive && selected?.token === token && generation === lyricGeneration) lyrics = next;
    } catch { if (generation === lyricGeneration) lyrics = { status: 'offline', lines: [] }; }
    updateText();
  }
  async function refresh() {
    if (!alive || reading || !api?.getMusicState) return;
    reading = true;
    try {
      const state = await api.getMusicState();
      if (!alive) return;
      tracks = Array.isArray(state.sessions) ? state.sessions : [];
      const next = tracks.find(t => t.token === pinned) || tracks.find(t => t.current && t.playing) || tracks.find(t => t.playing) || tracks.find(t => t.current) || tracks[0] || null;
      if (next?.token !== selected?.token) {
        editing = null; lyricToken = null; lyricGeneration++; lyrics = { status: 'missing', lines: [] }; error = '';
        if (!tracks.some(t => t.token === pinned)) pinned = null;
      }
      selected = next; snapshotAt = performance.now();
      render();
    } catch {
      tracks = []; selected = null; editing = null; lyricToken = null; lyricGeneration++;
      error = '暂未读取到播放器 · 请确认已开启系统媒体控制'; render();
    } finally { reading = false; }
  }
  function begin() { if (!editing && selected && !slider.disabled) editing = { token: selected.token }; }
  async function seek() {
    const gesture = editing; editing = null;
    if (!gesture || gesture.token !== selected?.token || seeking || slider.disabled) { updateText(); return; }
    const value = Number(slider.value), token = gesture.token;
    seeking = true; error = ''; render();
    try {
      await api.seekMusic(token, value);
      if (selected?.token === token) { selected.position = value; snapshotAt = performance.now(); }
    } catch { if (selected?.token === token) error = '播放器未接受跳转 · 请重新调节'; }
    finally { seeking = false; render(); setTimeout(refresh, 400); }
  }
  window.musicView = {
    mount(panel, callbacks) {
      root = panel; onOpen = callbacks.onOpen;
      close = create('button', 'music-close', '‹'); close.type = 'button'; close.title = '收起音乐'; close.setAttribute('aria-label', '收起音乐'); close.addEventListener('click', callbacks.onClose);
      summary = create('button', 'music-summary'); summary.type = 'button'; summary.setAttribute('aria-label', '显示音乐进度');
      const note = create('span', 'music-note'); note.setAttribute('aria-hidden', 'true'); const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); glyph.setAttribute('viewBox', '0 0 24 24'); glyph.innerHTML = '<path d="M9 4v12.2a3.5 2.6 0 1 0 2 2.3V8.3l8-1.8v7.7a3.5 2.6 0 1 0 2 2.3V1.3L9 4z"/>'; note.append(glyph);
      const text = create('span', 'music-copy'); title = create('span', 'music-title'); lyric = create('span', 'music-lyric'); text.append(title, lyric); summary.append(note, text);
      summary.addEventListener('click', () => { if (!detailed) onOpen(); else if (lyrics.status === 'offline') void loadLyrics(true); });
      progress = create('div', 'music-progress'); slider = create('input', 'music-slider'); slider.type = 'range'; slider.step = '0.1'; slider.setAttribute('aria-label', '音乐播放进度');
      stamp = create('span', 'music-time'); progress.append(slider, stamp);
      slider.addEventListener('pointerdown', begin);
      slider.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) begin(); });
      slider.addEventListener('input', () => { if (editing) updateText(); });
      slider.addEventListener('change', seek);
      const cancel = () => { editing = null; updateText(); };
      slider.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
      source = create('select', 'music-source'); source.title = '选择播放器'; source.setAttribute('aria-label', '选择播放器');
      source.addEventListener('change', () => { pinned = source.value; editing = null; void refresh(); });
      importer = create('button', 'music-import', 'LRC'); importer.type = 'button'; importer.title = '导入当前歌曲的 LRC 歌词'; importer.setAttribute('aria-label', importer.title);
      importer.addEventListener('click', async () => {
        if (!selected || importer.disabled) return;
        const token = selected.token; importer.disabled = true;
        try { const result = await api.importMusicLyrics(token); if (result && token === selected?.token) { lyricGeneration++; lyrics = result; lyricToken = token; error = ''; } }
        catch { error = 'LRC 导入失败，请选择带时间戳的歌词文件'; }
        finally { importer.disabled = false; updateText(); }
      });
      root.append(close, summary, progress, source, importer);
      root.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
      new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['data-orientation'] });
      async function poll() { await refresh(); if (alive) timer = setTimeout(poll, 1500); }
      void poll(); clock = setInterval(updateText, 200);
      render();
    },
    show(visible, detail) { allowed = visible; detailed = detail; if (!visible) editing = null; render(); },
    refresh,
    dispose() { alive = false; clearTimeout(timer); clearInterval(clock); lyricGeneration++; },
  };
})();

'use strict';
(() => {
  const api = window.widgetsEditor, $ = selector => document.querySelector(selector);
  let state, pending = false, dragId;
  const rowNodes = new Map();
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; }
  function button(label, text, click, className) { const el = element('button', className, text); el.type = 'button'; el.setAttribute('aria-label', label); el.title = label; el.addEventListener('click', click); return el; }
  async function run(action) {
    if (pending) return;
    pending = true;
    try { const next = await action(); if (next) render(next); $('#status').textContent = '实时预览 · 完成后保存'; $('#status').dataset.error = 'false'; }
    catch (error) { $('#status').textContent = error.message.replace(/^.*Error: /, ''); $('#status').dataset.error = 'true'; }
    finally { pending = false; }
  }
  function preview(change) { run(() => api.preview(change(structuredClone(state.layout)))); }
  function move(id, target) {
    preview(layout => { const from = layout.order.indexOf(id); layout.order.splice(from, 1); layout.order.splice(Math.max(0, Math.min(target, layout.order.length)), 0, id); return layout; });
  }
  function render(next) {
    state = next;
    if (!$('#builtins').children.length) for (const preset of next.builtins) {
      const el = button(preset.id === 'default' ? '恢复原布局' : preset.name + '布局', preset.name, () => run(() => api.preset(preset.id))); el.dataset.preset = preset.id; $('#builtins').append(el);
    }
    for (const el of $('#builtins').children) el.setAttribute('aria-pressed', String(el.dataset.preset === next.activePreset));
    const optionsKey = JSON.stringify(next.presets.map(p => [p.id, p.name]));
    if ($('#custom').dataset.options !== optionsKey) {
      $('#custom').replaceChildren(new Option('已保存的布局', ''));
      for (const p of next.presets) $('#custom').add(new Option(p.name, p.id));
      $('#custom').dataset.options = optionsKey;
    }
    $('#custom').value = next.presets.some(p => p.id === next.activePreset) ? next.activePreset : '';
    $('#delete').disabled = !$('#custom').value;
    for (const [id, node] of rowNodes) if (!next.catalog.some(item => item.id === id)) { node.remove(); rowNodes.delete(id); }
    for (const id of next.layout.order) {
      const item = next.catalog.find(x => x.id === id);
      let row = rowNodes.get(id);
      if (!row) {
        row = element('div', 'row'); row.dataset.id = id; row.draggable = true; row.setAttribute('role', 'listitem');
        const name = element('div', 'name'); name.append(element('strong', '', item.name), element('small', '', item.description));
        const steps = element('div', 'steps'); steps.append(button('上移' + item.name, '▴', () => move(id, state.layout.order.indexOf(id) - 1)), button('下移' + item.name, '▾', () => move(id, state.layout.order.indexOf(id) + 1)));
        const shown = button('显示' + item.name, '✓', () => preview(l => { if (l.hidden.includes(id)) l.hidden = l.hidden.filter(x => x !== id); else { l.hidden.push(id); l.pinned = l.pinned.filter(x => x !== id); } return l; }), 'toggle visible');
        const pin = button('固定' + item.name, '◆', () => preview(l => { l.hidden = l.hidden.filter(x => x !== id); if (l.pinned.includes(id)) l.pinned = l.pinned.filter(x => x !== id); else l.pinned.push(id); return l; }), 'toggle pin');
        row.append(element('span', 'handle', '⠿'), name, steps, shown, pin);
        row.addEventListener('dragstart', event => { dragId = id; row.classList.add('dragging'); event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragover', event => { if (dragId && dragId !== id) { event.preventDefault(); row.classList.add('drop'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', event => { event.preventDefault(); row.classList.remove('drop'); if (dragId && dragId !== id) move(dragId, state.layout.order.indexOf(id)); });
        row.addEventListener('dragend', () => { dragId = null; for (const el of rowNodes.values()) el.classList.remove('dragging', 'drop'); });
        rowNodes.set(id, row);
      }
      row.querySelector('.name strong').textContent = item.name; row.querySelector('.name small').textContent = item.description;
      row.dataset.hidden = String(next.layout.hidden.includes(id));
      row.querySelector('.visible').setAttribute('aria-pressed', String(!next.layout.hidden.includes(id)));
      row.querySelector('.pin').setAttribute('aria-pressed', String(next.layout.pinned.includes(id)));
      const steps = row.querySelectorAll('.steps button'); steps[0].disabled = next.layout.order[0] === id; steps[1].disabled = next.layout.order.at(-1) === id;
    }
    // Avoid moving focused controls or scroll positions for visibility/pin changes.
    const focused = document.activeElement;
    if ([...$('#widgets').children].map(el => el.dataset.id).join() !== next.layout.order.join()) for (const id of next.layout.order) $('#widgets').append(rowNodes.get(id));
    if (focused && focused.isConnected && focused !== document.activeElement) focused.focus({ preventScroll: true });
    if (next.error) { $('#status').textContent = next.error; $('#status').dataset.error = 'true'; $('#done').disabled = true; }
  }
  $('#custom').addEventListener('change', () => { if ($('#custom').value) run(() => api.preset($('#custom').value)); });
  $('#delete').addEventListener('click', () => { const id = $('#custom').value; if (id) run(() => api.deletePreset(id)); });
  $('#save-preset').addEventListener('submit', event => { event.preventDefault(); run(async () => { const next = await api.savePreset($('#preset-name').value); $('#preset-name').value = ''; return next; }); });
  for (const id of ['close', 'cancel']) $('#' + id).addEventListener('click', () => run(() => api.finish(false)));
  $('#done').addEventListener('click', () => run(() => api.finish(true)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); run(() => api.finish(false)); } });
  api.onChange(render); api.get().then(next => { if (!state) render(next); }).catch(error => { $('#status').textContent = error.message; });
})();

'use strict';
(() => {
  const api = window.todoEditor, text = document.querySelector('#text'), due = document.querySelector('#due'), message = document.querySelector('#message'), save = document.querySelector('#save');
  let editing = null;
  function localInput(value) { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  api.getDraft().then(draft => { editing = draft.id; text.value = draft.text; if (draft.dueAt) due.value = localInput(draft.dueAt); document.querySelector('#heading').textContent = editing ? '编辑待办' : '记下一件事'; text.focus(); }).catch(() => { message.textContent = '无法读取这条待办'; message.dataset.error = 'true'; save.disabled = true; });
  document.querySelector('#cancel').addEventListener('click', () => api.close());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') api.close(); });
  document.querySelector('#clear-due').addEventListener('click', () => { due.value = ''; });
  for (const button of document.querySelectorAll('[data-minutes]')) button.addEventListener('click', () => { due.value = localInput(Date.now() + Number(button.dataset.minutes) * 60000); });
  document.querySelector('#editor').addEventListener('submit', async e => {
    e.preventDefault(); if (save.disabled) return;
    const dueAt = due.value ? new Date(due.value).getTime() : null;
    if (dueAt !== null && !Number.isFinite(dueAt)) { message.textContent = '请选择有效的提醒时间'; return; }
    save.disabled = true;
    try { await api.save({ text: text.value, dueAt }); }
    catch (error) { message.textContent = String(error.message).replace(/^Error invoking remote method '[^']+': Error: /, ''); message.dataset.error = 'true'; save.disabled = false; }
  });
})();

'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const normalize = s => String(s || '').normalize('NFKC').trim().toLocaleLowerCase();
function trackKey(track) { return createHash('sha256').update(JSON.stringify([normalize(track.title), normalize(track.artist), normalize(track.album), Math.round(track.duration || 0)])).digest('hex'); }
function parseLrc(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('LRC 文件过大');
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const times = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const value = line.replace(/\[[^\]]*\]/g, '').replace(/<\d[^>]*>/g, '').trim().slice(0, 500);
    if (!value) continue;
    for (const t of times) lines.push({ time: Math.max(0, Number(t[1]) * 60 + Number(t[2]) + Number('0.' + (t[3] || '0')) + offset), text: value });
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 10000);
}
function createLyrics({ directory, fetch: fetcher = globalThis.fetch, mock = false } = {}) {
  const cache = new Map(), pending = new Map(), controllers = new Set();
  let disposed = false;
  async function load(track) {
    const key = trackKey(track), saved = cache.get(key);
    if (saved && Date.now() < saved.expires) return saved.result;
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      let result;
      try {
        if (directory) {
          const file = path.join(directory, key + '.lrc');
          if ((await fs.stat(file)).size <= 1024 * 1024) {
            const lines = parseLrc(await fs.readFile(file, 'utf8'));
            if (lines.length) result = { status: 'synced', source: '本地 LRC', lines };
          }
        }
      } catch {}
      if (!result && !mock && !disposed && track.title && track.artist && track.duration > 0) {
        const controller = new AbortController(); controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          const url = new URL('https://lrclib.net/api/get');
          for (const [name, value] of Object.entries({ track_name: track.title, artist_name: track.artist, album_name: track.album || '', duration: Math.round(track.duration) })) url.searchParams.set(name, String(value));
          const response = await fetcher(url, { signal: controller.signal, redirect: 'error', headers: { 'User-Agent': 'AwesomeTouchBar/0.6 (Windows music widget)' } });
          if (response.status === 404) result = { status: 'missing', lines: [] };
          else {
            if (!response.ok) throw new Error('Lyrics request failed');
            const reader = response.body.getReader(); let size = 0; const chunks = [];
            try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('Lyrics too large'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const exact = normalize(data.trackName) === normalize(track.title) && normalize(data.artistName) === normalize(track.artist) && Math.abs(Number(data.duration) - track.duration) <= 2;
            if (!exact) result = { status: 'missing', lines: [] };
            else if (data.instrumental) result = { status: 'instrumental', lines: [], source: 'LRCLIB' };
            else {
              const lines = parseLrc(data.syncedLyrics || '');
              result = { status: lines.length ? 'synced' : data.plainLyrics ? 'unsynced' : 'missing', lines, source: 'LRCLIB' };
            }
          }
        } catch { result = { status: 'offline', lines: [] }; }
        finally { clearTimeout(timeout); controllers.delete(controller); }
      }
      result ||= { status: 'missing', lines: [] };
      cache.set(key, { result, expires: Date.now() + (result.status === 'offline' ? 30000 : 3600000) });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return result;
    })().finally(() => pending.delete(key));
    pending.set(key, work); return work;
  }
  return {
    load,
    async import(track, text) {
      const lines = parseLrc(text);
      if (!lines.length) throw new Error('文件中没有带时间戳的歌词');
      const key = trackKey(track), result = { status: 'synced', source: '本地 LRC', lines };
      if (directory) { await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, key + '.lrc'), text, 'utf8'); }
      // Wait for a pending lookup so it cannot overwrite the imported lyrics.
      if (pending.has(key)) await pending.get(key);
      cache.set(key, { result, expires: Infinity }); return result;
    },
    dispose() { disposed = true; for (const c of controllers) c.abort(); cache.clear(); },
  };
}
module.exports = { parseLrc, trackKey, createLyrics };

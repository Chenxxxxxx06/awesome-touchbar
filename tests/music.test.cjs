'use strict';
// Each unit test selects a mock or injected helper; isolate the CI-wide default.
delete process.env.TOUCH_BAR_CONTROLS_MODE;
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMusic } = require('../desktop/music.cjs');
const { parseLrc, createLyrics, trackKey } = require('../desktop/lyrics.cjs');
const token = 'a'.repeat(64);
const track = { token, title: 'Fixture Track', artist: 'Fixture Artist', album: 'Fixture Album', duration: 180, position: 12, seekable: true, minSeek: 0, maxSeek: 180 };
test('LRC timestamps, repeated tags, offsets and enhanced timestamps', () => {
  assert.deepEqual(parseLrc('[offset:-500]\n[00:02.50][00:04.005]One\n[00:01]Two\n[ar:test]\n[00:05]<00:05.00>Three'), [{ time: .5, text: 'Two' }, { time: 2, text: 'One' }, { time: 3.505, text: 'One' }, { time: 4.5, text: 'Three' }]);
  assert.deepEqual(parseLrc('plain lyrics without timing'), []);
});
test('seek is track-bound and validates range; mock never invokes native helper', async () => {
  const music = createMusic({ mode: 'mock', mockState: { sessions: [structuredClone(track)] }, spawn() { throw new Error('Native helper forbidden'); } });
  await assert.rejects(music.seek('b'.repeat(64), 30));
  for (const value of [NaN, Infinity, -1, 181, '30']) await assert.rejects(music.seek(token, value));
  await music.seek(token, 45); assert.equal((await music.getState()).sessions[0].position, 45);
  music.dispose();
});
test('read-only and unknown modes reject seeks without spawning', async () => {
  for (const mode of ['readonly', 'typo']) {
    const music = createMusic({ mode, spawn() { throw new Error('Must not spawn'); } });
    await assert.rejects(music.seek(token, 45), /Read-only/); music.dispose();
  }
});
test('mock controls force media mock even when live requested', async () => {
  const old = process.env.TOUCH_BAR_CONTROLS_MODE; process.env.TOUCH_BAR_CONTROLS_MODE = 'mock';
  try { const m = createMusic({ mode: 'live', spawn() { throw new Error('Native forbidden'); } }); assert.deepEqual((await m.getState()).sessions, []); m.dispose(); }
  finally { if (old === undefined) delete process.env.TOUCH_BAR_CONTROLS_MODE; else process.env.TOUCH_BAR_CONTROLS_MODE = old; }
});
test('lyrics exact match is cached and only song metadata is sent', async () => {
  let calls = 0;
  const service = createLyrics({ fetch: async (url, options) => {
    calls++; assert.equal(url.origin, 'https://lrclib.net'); assert.equal(options.redirect, 'error');
    assert.deepEqual([...url.searchParams.keys()], ['track_name', 'artist_name', 'album_name', 'duration']);
    return new Response(JSON.stringify({ trackName: track.title, artistName: track.artist, duration: 180, syncedLyrics: '[00:00]Fixture line' }));
  } });
  assert.equal((await service.load(track)).status, 'synced'); await service.load(track); assert.equal(calls, 1); service.dispose();
});
test('wrong versions, unsynced lyrics, offline and instrumental states stay honest', async () => {
  for (const [data, expected] of [[{ duration: 200 }, 'missing'], [{ plainLyrics: 'plain' }, 'unsynced'], [{ instrumental: true }, 'instrumental']]) {
    const service = createLyrics({ fetch: async () => new Response(JSON.stringify({ trackName: track.title, artistName: track.artist, duration: 180, ...data })) });
    assert.equal((await service.load(track)).status, expected); service.dispose();
  }
  const failed = createLyrics({ fetch: async () => { throw new Error('offline'); } });
  assert.equal((await failed.load(track)).status, 'offline'); failed.dispose();
});
test('local LRC wins over lookup and track keys do not contain raw metadata', async () => {
  const service = createLyrics({ mock: true, fetch() { throw new Error('Network forbidden'); } });
  assert.match(trackKey(track), /^[a-f0-9]{64}$/);
  await assert.rejects(service.import(track, 'plain'));
  await service.import(track, '[00:01]Imported fixture');
  assert.equal((await service.load(track)).source, '本地 LRC'); service.dispose();
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createControls } = require('../desktop/controls.cjs');
const initial = () => ({ audio: { available: true, deviceId: 'mock-default', volume: 25, muted: true }, brightness: { available: true, value: 60 } });
function fakeHelper({ noReply = false, externalChange = false } = {}) {
  const calls = [];
  let fakeState = initial();
  let simultaneous = 0;
  let maximum = 0;
  let launches = 0;
  let killed = 0;
  const factory = (_file, args, options) => {
    launches++;
    calls.push({ args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    child.stdin = new Writable({ write(data, _encoding, next) {
      const request = JSON.parse(data.toString()); calls.push(request);
      simultaneous++; maximum = Math.max(maximum, simultaneous);
      if (noReply) { next(); return; }
      setTimeout(() => {
        if (['setVolume', 'setMuted'].includes(request.op) && request.deviceId !== fakeState.audio.deviceId) {
          child.stdout.write(JSON.stringify({ id: request.id, ok: false, error: '音频输出设备已变化，请重新调整', state: fakeState }) + '\n');
          simultaneous--; next(); return;
        }
        if (request.op === 'setVolume') fakeState.audio.volume = request.value;
        if (request.op === 'setMuted') fakeState.audio.muted = request.value;
        if (request.op === 'setBrightness') fakeState.brightness.value = request.value;
        if (externalChange && calls.filter(item => item.op === 'get').length > 1) fakeState.audio.volume = 17;
        child.stdout.write(JSON.stringify({ id: request.id, ok: true, state: fakeState }) + '\n');
        simultaneous--; next();
      }, 3);
    } });
    child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0); });
    child.kill = () => { killed++; child.exitCode = 1; child.emit('exit', 1); return true; };
    return child;
  };
  return { factory, calls, switchDevice() { fakeState.audio = { available: true, deviceId: 'mock-new', volume: 7, muted: false }; }, get state() { return JSON.parse(JSON.stringify(fakeState)); }, get launches() { return launches; }, get maximum() { return maximum; }, get killed() { return killed; } };
}

test('mock writes never spawn a hardware helper and do not implicitly unmute', async () => {
  let spawns = 0;
  const updates = [];
  const controls = createControls({ mode: 'mock', mockState: initial(), spawn: () => { spawns++; throw new Error('Hardware must not be touched'); }, onChange: value => updates.push(value) });
  assert.deepEqual(await controls.getState(), initial());
  await controls.setVolume(73, 'mock-default');
  assert.equal((await controls.getState()).audio.muted, true);
  await controls.setMuted(false, 'mock-default');
  assert.equal((await controls.getState()).audio.volume, 73);
  await controls.setBrightness(42);
  assert.equal((await controls.getState()).brightness.value, 42);
  const copy = await controls.getState(); copy.audio.volume = 99;
  assert.equal((await controls.getState()).audio.volume, 73);
  assert.equal(updates.length, 3); assert.equal(spawns, 0);
  controls.dispose();
  await assert.rejects(controls.getState(), /已关闭/);
});

test('all setters reject malformed or out-of-range data without side effects', async () => {
  const controls = createControls({ mode: 'mock', mockState: initial() });
  for (const value of [null, undefined, true, '50', NaN, Infinity, -1, 100.01, {}, []]) {
    await assert.rejects(controls.setVolume(value), /0 到 100/);
    await assert.rejects(controls.setBrightness(value), /0 到 100/);
  }
  for (const value of [0, 1, 'true', null, {}, undefined]) await assert.rejects(controls.setMuted(value), /布尔/);
  assert.deepEqual(await controls.getState(), initial()); controls.dispose();
});

test('readonly and unknown modes reject writes before any helper command', async () => {
  for (const mode of ['readonly', 'readolny']) {
    const fake = fakeHelper();
    const controls = createControls({ mode, spawn: fake.factory, pollIntervalMs: 0 });
    await assert.rejects(controls.setVolume(100), /READ_ONLY/);
    await assert.rejects(controls.setMuted(false, 'mock-default'), /READ_ONLY/);
    await assert.rejects(controls.setBrightness(100), /READ_ONLY/);
    assert.equal(fake.launches, 0);
    assert.deepEqual(await controls.getState(), initial());
    assert.deepEqual(fake.calls[0].args, ['--read-only']);
    assert.equal(fake.calls[0].options.shell, false);
    assert.equal(fake.calls[0].options.windowsHide, true);
    assert.deepEqual(fake.calls.filter(item => item.op).map(item => item.op), ['get']); controls.dispose();
  }
});

test('simulated native requests are serialized and return authoritative state', async () => {
  const fake = fakeHelper();
  const controls = createControls({ mode: 'live', spawn: fake.factory, pollIntervalMs: 0 });
  // live here uses an injected in-memory process, never the executable.
  const reads = await Promise.all([controls.getState(), controls.getState()]);
  assert.deepEqual(reads[0], reads[1]);
  const writes = await Promise.all([controls.setVolume(30, 'mock-default'), controls.setVolume(35, 'mock-default'), controls.setMuted(false, 'mock-default'), controls.setBrightness(42)]);
  assert.equal(writes[0].audio.volume, 30); assert.equal(writes[1].audio.volume, 35);
  assert.equal(writes[2].audio.muted, false); assert.equal(writes[3].brightness.value, 42);
  assert.equal(fake.maximum, 1);
  assert.deepEqual(fake.calls[0].args, ['--allow-write']);
  assert.deepEqual(fake.calls.filter(item => item.op).map(item => item.op), ['get', 'setVolume', 'setVolume', 'setMuted', 'setBrightness']); controls.dispose();
});

test('external audio changes are read back without sending setters', async () => {
  const fake = fakeHelper({ externalChange: true });
  let observed;
  const changed = new Promise(resolve => { observed = resolve; });
  const controls = createControls({ mode: 'readonly', spawn: fake.factory, pollIntervalMs: 10, onChange: state => { if (state.audio.volume === 17) observed(); } });
  await controls.getState();
  const timeout = setTimeout(() => observed(new Error('poll failed')), 1000);
  const result = await changed; clearTimeout(timeout);
  assert.equal(result, undefined);
  assert.equal((await controls.getState()).audio.volume, 17);
  assert.ok(fake.calls.filter(item => item.op).every(item => item.op === 'get')); controls.dispose();
});

test('unresponsive helper is terminated and unavailable state is reported', async () => {
  const fake = fakeHelper({ noReply: true });
  const controls = createControls({ mode: 'readonly', spawn: fake.factory, pollIntervalMs: 0, timeoutMs: 25 });
  const keepAlive = setTimeout(() => {}, 1000);
  const state = await controls.getState(); clearTimeout(keepAlive);
  assert.equal(state.audio.available, false); assert.match(state.audio.error, /超时/);
  assert.equal(fake.killed, 1); controls.dispose();
});

test('unavailable hardware stays unavailable instead of pretending to change', async () => {
  const controls = createControls({ mode: 'mock', mockState: { audio: { available: false, error: '无音频设备' }, brightness: { available: false, error: '外接屏未提供接口' } } });
  await assert.rejects(controls.setVolume(20, 'mock-default'), /无音频/);
  await assert.rejects(controls.setMuted(false, 'mock-default'), /无音频/);
  await assert.rejects(controls.setBrightness(50), /外接屏/);
  assert.equal((await controls.getState()).audio.volume, null); controls.dispose();
});
test('compiled helper defaults to readonly before dispatch, without issuing device setters', { skip: process.platform !== 'win32' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const executable = path.join(__dirname, '..', 'native', 'bin', 'TouchBar.Controls.exe');
  if (!fs.existsSync(executable)) throw new Error('Build native helper before testing on Windows');
  // This deliberately unknown operation cannot adjust a device even if a guard regresses.
  const input = JSON.stringify({ id: 1, op: 'probe-write-guard', value: 0 }) + '\n';
  for (const args of [[], ['--read-only']]) {
    const result = spawnSync(executable, args, { input, encoding: 'utf8', windowsHide: true, shell: false, timeout: 3000 });
    assert.equal(result.status, 0);
    const reply = JSON.parse(result.stdout.trim());
    assert.equal(reply.ok, false); assert.match(reply.error, /READ_ONLY/);
  }
});

test('missing or malformed audio device IDs never start or write a helper', async () => {
  const fake = fakeHelper();
  const controls = createControls({ mode: 'live', spawn: fake.factory, pollIntervalMs: 0 });
  for (const id of [undefined, null, '', '   ', 1, true, {}, 'a'.repeat(257), 'bad\0id']) {
    await assert.rejects(controls.setVolume(20, id), /设备标识/);
    await assert.rejects(controls.setMuted(false, id), /设备标识/);
  }
  assert.equal(fake.launches, 0); controls.dispose();
});

test('queued writes keep the original device ID and cannot change a new default device', async () => {
  const fake = fakeHelper();
  let observed;
  const controls = createControls({ mode: 'live', spawn: fake.factory, pollIntervalMs: 0, onChange: state => { observed = state; } });
  const initialState = await controls.getState();
  const originalDevice = initialState.audio.deviceId;
  const volume = controls.setVolume(80, originalDevice).catch(error => {
    assert.equal(observed.audio.deviceId, 'mock-new', 'new state is published before rejection reaches the UI');
    throw error;
  });
  const muted = controls.setMuted(true, originalDevice);
  fake.switchDevice();
  const results = await Promise.allSettled([volume, muted]);
  assert.ok(results.every(result => result.status === 'rejected' && /设备已变化/.test(result.reason.message)));
  assert.deepEqual(fake.state.audio, { available: true, deviceId: 'mock-new', volume: 7, muted: false });
  const writes = fake.calls.filter(call => ['setVolume', 'setMuted'].includes(call.op));
  assert.ok(writes.every(call => call.deviceId === 'mock-default'));
  const fresh = await controls.getState();
  assert.equal(fresh.audio.deviceId, 'mock-new');
  await controls.setVolume(8, fresh.audio.deviceId);
  assert.equal(fake.state.audio.volume, 8);
  controls.dispose();
});

test('mock also rejects stale device IDs without modifying its current state', async () => {
  const controls = createControls({ mode: 'mock', mockState: initial() });
  await assert.rejects(controls.setVolume(95, 'old-headphones'), /设备已变化/);
  await assert.rejects(controls.setMuted(false, 'old-headphones'), /设备已变化/);
  assert.deepEqual(await controls.getState(), initial()); controls.dispose();
});

test('expanded actions are allowlisted and mock never synthesizes system input', async () => {
  const { CONTROL_ACTIONS } = require('../desktop/controls.cjs');
  let launches = 0;
  const actions = [];
  const controls = createControls({ mode: 'mock', mockState: initial(), spawn: () => { launches++; throw new Error('No real helper allowed'); }, onMockAction: action => actions.push(action) });
  for (const action of CONTROL_ACTIONS) assert.deepEqual(await controls.runAction(action), initial());
  assert.deepEqual(actions, CONTROL_ACTIONS);
  assert.equal(launches, 0);
  assert.deepEqual(await controls.getState(), initial());
  for (const action of [null, undefined, true, 0, {}, [], '', 'volumeUp', 'powershell', 'mediaNext; exit', '__proto__'])
    await assert.rejects(controls.runAction(action), /未知组件操作/);
  assert.equal(actions.length, CONTROL_ACTIONS.length);
  controls.dispose();
  await assert.rejects(controls.runAction('openExplorer'), /已关闭/);
});

test('readonly or misspelled mode rejects actions before spawning a helper', async () => {
  for (const mode of ['readonly', 'readolny']) {
    const fake = fakeHelper();
    const controls = createControls({ mode, spawn: fake.factory });
    await assert.rejects(controls.runAction('mediaPlayPause'), /READ_ONLY/);
    assert.equal(fake.launches, 0);
    controls.dispose();
  }
});

test('simulated native actions serialize through the fixed helper without shell arguments', async () => {
  const fake = fakeHelper();
  const controls = createControls({ mode: 'live', spawn: fake.factory, pollIntervalMs: 0 });
  await assert.rejects(controls.runAction('calc.exe'), /未知组件操作/);
  assert.equal(fake.launches, 0);
  const results = await Promise.all([controls.runAction('showDesktop'), controls.runAction('mediaNext'), controls.getState()]);
  assert.ok(results.every(state => state.audio.volume === 25 && state.audio.muted));
  assert.equal(fake.maximum, 1);
  assert.equal(fake.calls[0].options.shell, false);
  assert.deepEqual(fake.calls.filter(call => call.op).map(call => [call.op, call.value]), [['runAction', 'showDesktop'], ['runAction', 'mediaNext'], ['get', undefined]]);
  controls.dispose();
});

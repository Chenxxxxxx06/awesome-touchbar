'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const copy = value => JSON.parse(JSON.stringify(value));
const CONTROL_ACTIONS = Object.freeze(['mediaPrevious', 'mediaPlayPause', 'mediaNext', 'showDesktop', 'taskView', 'openExplorer']);
function actionName(value) {
  if (typeof value !== 'string' || !CONTROL_ACTIONS.includes(value)) throw new TypeError('未知组件操作');
  return value;
}
const unavailable = message => ({
  audio: { available: false, deviceId: null, volume: null, muted: null, error: message },
  brightness: { available: false, value: null, error: message },
});
function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    throw new TypeError('设置值必须是 0 到 100 的数字');
  return Math.round(value * 10) / 10;
}
function deviceToken(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0'))
    throw new TypeError('缺少有效的音频设备标识，请重新打开调节');
  return value;
}
function helperPath() {
  // Only a fixed, packaged executable is launched. Renderer input never becomes a command.
  let packaged = false;
  try { packaged = Boolean(require('electron').app?.isPackaged); } catch { /* Node unit tests. */ }
  return packaged
    ? path.join(process.resourcesPath, 'native', 'TouchBar.Controls.exe')
    : path.join(__dirname, '..', 'native', 'bin', 'TouchBar.Controls.exe');
}
function validateState(value) {
  if (!value || typeof value.audio?.available !== 'boolean' || typeof value.brightness?.available !== 'boolean')
    throw new Error('系统控制程序返回无效状态');
  const audio = value.audio.available
    ? { available: true, deviceId: deviceToken(value.audio.deviceId), volume: percent(value.audio.volume), muted: value.audio.muted }
    : { available: false, deviceId: null, volume: null, muted: null, error: String(value.audio.error || '音频输出不可用').slice(0, 160) };
  if (audio.available && typeof audio.muted !== 'boolean') throw new Error('系统控制程序返回无效静音状态');
  const brightness = value.brightness.available
    ? { available: true, value: percent(value.brightness.value) }
    : { available: false, value: null, error: String(value.brightness.error || '屏幕亮度不可用').slice(0, 160) };
  return { audio, brightness };
}
function createControls(options = {}) {
  const requestedMode = options.mode ?? process.env.TOUCH_BAR_CONTROLS_MODE ?? 'live';
  // A misspelled testing mode must fail closed rather than enable writes.
  const mode = ['live', 'readonly', 'mock'].includes(requestedMode) ? requestedMode : 'readonly';
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  let state = mode === 'mock'
    ? validateState(options.mockState || { audio: { available: true, deviceId: 'mock-default', volume: 25, muted: false }, brightness: { available: true, value: 60 } })
    : unavailable('正在读取系统控制状态');
  let disposed = false;
  let child;
  let pending;
  let readPromise;
  let interval;
  let queue = Promise.resolve();
  let queued = 0;
  let sequence = 0;
  const timeout = options.timeoutMs ?? 6000;
  const pollInterval = options.pollIntervalMs ?? 1200;

  function publish(next) {
    if (disposed) return copy(state);
    const changed = JSON.stringify(state) !== JSON.stringify(next);
    state = validateState(next);
    if (changed) { try { onChange(copy(state)); } catch { /* Consumer callbacks cannot break device access. */ } }
    return copy(state);
  }
  function assertOpen() { if (disposed) throw new Error('系统控制服务已关闭'); }
  function failProcess(process, message) {
    if (child !== process) return;
    child = undefined;
    if (pending) {
      const current = pending; pending = undefined;
      clearTimeout(current.timer); current.reject(new Error(message));
    }
    if (!disposed) publish(unavailable(message));
  }
  function ensureChild() {
    if (child) return child;
    if (process.platform !== 'win32' && !options.spawn) throw new Error('系统控制仅支持 Windows');
    const executable = options.executablePath || helperPath();
    if (!options.spawn && !fs.existsSync(executable)) throw new Error('系统控制组件未构建，请运行 pnpm build:native');
    const processChild = (options.spawn || spawn)(executable, [mode === 'live' ? '--allow-write' : '--read-only'], {
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = processChild;
    const lines = readline.createInterface({ input: processChild.stdout });
    lines.on('line', line => {
      if (child !== processChild || !pending) return;
      let response;
      try {
        if (line.length > 16384) throw new Error();
        response = JSON.parse(line);
      } catch { failProcess(processChild, '系统控制组件返回无效数据'); processChild.kill(); return; }
      if (response.id !== pending.id) return;
      const current = pending; pending = undefined; clearTimeout(current.timer);
      if (!response.ok) {
        // A rejected device-bound write publishes the new default before callers handle the error.
        if (response.state) {
          try { publish(validateState(response.state)); }
          catch { publish(unavailable('系统控制组件返回无效状态')); }
        }
        current.reject(new Error(String(response.error || '系统设置未成功').slice(0, 160))); return;
      }
      try { current.resolve(publish(validateState(response.state))); }
      catch (error) { current.reject(error); }
    });
    processChild.stderr.on('data', () => {}); // Never expose environment or device diagnostics in the UI.
    processChild.stdin.on('error', () => failProcess(processChild, '系统控制组件连接中断'));
    processChild.on('error', () => failProcess(processChild, '系统控制组件启动失败'));
    processChild.on('exit', () => { lines.close(); failProcess(processChild, '系统控制组件已退出'); });
    return processChild;
  }
  function nativeRequest(op, value, deviceId) {
    assertOpen();
    const processChild = ensureChild();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        failProcess(processChild, '系统控制响应超时，请稍后重试');
        processChild.kill(); // Only this service's own unresponsive helper is terminated.
      }, timeout);
      timer.unref?.();
      pending = { id, resolve, reject, timer };
      try {
        processChild.stdin.write(JSON.stringify({ id, op, ...(value === undefined ? {} : { value }), ...(deviceId === undefined ? {} : { deviceId }) }) + '\n', error => {
          if (error) failProcess(processChild, '系统控制组件连接中断');
        });
      } catch { failProcess(processChild, '系统控制组件连接中断'); }
    });
  }
  function enqueue(task) {
    queued++;
    const result = queue.then(() => { assertOpen(); return task(); });
    queue = result.catch(() => {}).finally(() => { queued--; });
    return result;
  }
  function startPolling() {
    if (interval || !pollInterval || mode === 'mock' || disposed) return;
    interval = setInterval(() => {
      if (!pending && !readPromise && !queued) getState().catch(() => {});
    }, pollInterval);
    interval.unref?.();
  }
  async function getState() {
    assertOpen();
    if (mode === 'mock') return copy(state);
    startPolling();
    if (!readPromise) {
      readPromise = enqueue(() => nativeRequest('get')).catch(error => publish(unavailable(error.message))).finally(() => { readPromise = undefined; });
    }
    return copy(await readPromise);
  }
  async function write(op, value, deviceId) {
    assertOpen();
    if (mode === 'readonly') throw new Error('READ_ONLY: 当前运行模式禁止修改系统设置');
    const target = op === 'setBrightness' ? undefined : deviceToken(deviceId);
    return enqueue(async () => {
      if (mode !== 'mock') return nativeRequest(op, value, target);
      const next = copy(state);
      if (op === 'setBrightness') {
        if (!next.brightness.available) throw new Error(next.brightness.error || '屏幕亮度不可用');
        next.brightness.value = Math.round(value);
      } else {
        if (!next.audio.available) throw new Error(next.audio.error || '音频输出不可用');
        if (next.audio.deviceId !== target) throw new Error('音频输出设备已变化，请重新调整');
        if (op === 'setVolume') next.audio.volume = value;
        if (op === 'setMuted') next.audio.muted = value;
      }
      return publish(next);
    });
  }
  async function runAction(value) {
    assertOpen();
    const action = actionName(value);
    if (mode === 'readonly') throw new Error('READ_ONLY: 当前运行模式禁止修改系统设置');
    return enqueue(async () => {
      if (mode !== 'mock') return nativeRequest('runAction', action);
      // Mock actions never launch a process or synthesize system input.
      if (typeof options.onMockAction === 'function') options.onMockAction(action);
      return copy(state);
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(interval);
    if (pending) {
      const current = pending; pending = undefined;
      clearTimeout(current.timer); current.reject(new Error('系统控制服务已关闭'));
    }
    const processChild = child;
    child = undefined;
    if (processChild) {
      processChild.stdin.end();
      const timer = setTimeout(() => { if (processChild.exitCode === null) processChild.kill(); }, 500);
      timer.unref?.();
      processChild.once('exit', () => clearTimeout(timer));
    }
  }
  return {
    getState,
    runAction,
    setVolume: async (value, deviceId) => write('setVolume', percent(value), deviceId),
    setBrightness: async value => write('setBrightness', percent(value)),
    setMuted: async (value, deviceId) => {
      if (typeof value !== 'boolean') throw new TypeError('静音值必须为布尔值');
      return write('setMuted', value, deviceId);
    },
    dispose,
  };
}
module.exports = { createControls, CONTROL_ACTIONS };
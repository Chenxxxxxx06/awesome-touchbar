'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const empty = () => ({ sessions: [], observedAt: Date.now() });
function createMusic(options = {}) {
  const mode = process.env.TOUCH_BAR_CONTROLS_MODE === 'mock' ? 'mock' : (options.mode ?? process.env.TOUCH_BAR_MUSIC_MODE ?? 'live');
  let child, pending, seq = 0, queue = Promise.resolve(), disposed = false, reading;
  const mock = options.mockState || empty();
  function stop(error) {
    const old = child; child = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
    old?.kill();
  }
  function start() {
    if (child) return child;
    if (process.platform !== 'win32' && !options.spawn) throw new Error('Windows media sessions required');
    let packaged = false;
    try { packaged = !!require('electron').app?.isPackaged; } catch {}
    const script = packaged ? path.join(process.resourcesPath, 'native/Media.ps1') : path.join(__dirname, '../native/Media.ps1');
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const proc = (options.spawn || spawn)(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...(mode === 'live' ? ['-AllowWrite'] : [])], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    readline.createInterface({ input: proc.stdout }).on('line', line => {
      if (child !== proc || !pending) return;
      try {
        if (line.length > 262144) throw new Error();
        const message = JSON.parse(line);
        if (message.id !== pending.id) return;
        const p = pending; pending = null; clearTimeout(p.timer);
        message.ok ? p.resolve(message.result) : p.reject(new Error('播放器未接受操作，请重新读取当前歌曲'));
      } catch { stop(new Error('媒体接口返回异常')); }
    });
    proc.stderr.on('data', () => {}); // Never log private song metadata or host errors.
    proc.stdin.on('error', () => { if (child === proc) stop(new Error('媒体接口已断开')); });
    proc.on('error', () => { if (child === proc) stop(new Error('无法启动媒体接口')); });
    proc.on('exit', () => { if (child === proc) stop(new Error('媒体接口已退出')); });
    return proc;
  }
  function request(op, args = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (disposed) return reject(new Error('Media service closed'));
      try {
        const proc = start(), id = ++seq;
        pending = { id, resolve, reject, timer: setTimeout(() => stop(new Error('媒体读取超时')), options.timeoutMs || 12000) };
        proc.stdin.write(JSON.stringify({ id, op, ...args }) + '\n');
      } catch (error) { reject(error); }
    });
    const next = queue.then(run); queue = next.catch(() => {}); return next;
  }
  return {
    mode,
    getState() {
      if (mode === 'mock') return Promise.resolve(structuredClone({ ...mock, observedAt: Date.now() }));
      if (!reading) reading = request('state').finally(() => { reading = null; });
      return reading;
    },
    async seek(token, seconds) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 604800) throw new Error('无效的歌曲或进度');
      if (mode === 'mock') {
        const tracks = mock.sessions.filter(s => s.token === token);
        if (tracks.length !== 1 || !tracks[0].seekable || seconds < tracks[0].minSeek || seconds > tracks[0].maxSeek) throw new Error('歌曲已切换或无法调节');
        tracks[0].position = seconds; return { accepted: true };
      }
      if (mode !== 'live') throw new Error('Read-only media mode');
      return request('seek', { token, seconds });
    },
    dispose() { disposed = true; stop(new Error('Media service closed')); },
  };
}
module.exports = { createMusic };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('native action sequences and failed-input cleanup never need actual Windows input', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-native-actions-test-'));
  const executable = path.join(directory, 'NativeActions.Tests.exe');
  const driver = path.join(directory, 'Driver.cs');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  // This entry point only exercises pure sequence construction and an injected
  // in-memory sender. NativeActions.Execute and SendInput are never called.
  const code = `using System;
using System.Runtime.InteropServices;
internal static class ActionTests {
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  static int Main() {
    try {
      Check(Marshal.SizeOf(typeof(NativeActions.Input)) == 40, "Win64 INPUT size");
      foreach (string action in new string[] { "mediaPrevious", "mediaPlayPause", "mediaNext", "showDesktop", "taskView", "openExplorer" }) {
        var keys = NativeActions.Keys(action); var inputs = NativeActions.Sequence(action);
        Check(inputs.Length == keys.Length * 2, "Balanced sequence length");
        for (int i = 0; i < keys.Length; i++) {
          Check(inputs[i].type == 1 && inputs[i].data.keyboard.key == keys[i], "Key down order");
          Check((inputs[i].data.keyboard.flags & 2) == 0, "Key down flag");
          var up = inputs[inputs.Length - i - 1];
          Check(up.data.keyboard.key == keys[i] && (up.data.keyboard.flags & 2) != 0, "Reverse key up order");
        }
        int calls = 0;
        NativeActions.SendChecked(inputs, batch => { calls++; return (uint)batch.Length; });
        Check(calls == 1, "Success must use one uninterrupted input batch");
      }
      Check(NativeActions.Keys("mediaPrevious")[0] == 0xB1, "Previous track");
      Check(NativeActions.Keys("mediaPlayPause")[0] == 0xB3, "Play/pause");
      Check(NativeActions.Keys("mediaNext")[0] == 0xB0, "Next track");
      bool invalid = false;
      try { NativeActions.Sequence("powershell"); } catch (ArgumentException) { invalid = true; }
      Check(invalid, "Reject unlisted commands");
      for (uint inserted = 0; inserted < 4; inserted++) {
        int calls = 0; bool rejected = false;
        uint firstCount = inserted;
        try {
          NativeActions.SendChecked(NativeActions.Sequence("showDesktop"), batch => {
            calls++;
            if (calls == 1) return firstCount;
            Check(firstCount > 0, "No cleanup when no input was inserted");
            Check(batch.Length == (firstCount == 2 ? 2 : 1), "Release only still-held injected keys");
            foreach (var input in batch) Check((input.data.keyboard.flags & 2) != 0, "Cleanup never presses a key");
            Check(batch[batch.Length - 1].data.keyboard.key == 0x5B, "Release Windows modifier last");
            return (uint)batch.Length;
          });
        } catch (InvalidOperationException) { rejected = true; }
        Check(rejected && calls == (inserted == 0 ? 1 : 2), "Partial input reports failure after cleanup");
      }
      Console.WriteLine("Native action policy passed; real input events = 0");
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
  }
}`;
  try {
    fs.writeFileSync(driver, code, 'utf8');
    const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:ActionTests', '/reference:System.Management.dll', '/reference:System.Web.Extensions.dll', '/out:' + executable, path.resolve(__dirname, '../native/Controls.cs'), driver], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 3000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /real input events = 0/);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('touchbar-native-actions-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});

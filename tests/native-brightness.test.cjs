'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('native brightness verification accepts authoritative readback without invoking a device setter', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-native-brightness-test-'));
  const executable = path.join(directory, 'BrightnessVerification.Tests.exe');
  const driver = path.join(directory, 'Driver.cs');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  // Compile the production policy with a different entry point. Program.Main and
  // every WMI/Core Audio device setter remain uncalled throughout this test.
  const code = `using System;
using System.Collections.Generic;
internal static class BrightnessTests {
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  static void Fails(object returned, Func<int, int?> read, string message) {
    bool failed = false;
    try { BrightnessVerification.Confirm(85, returned, read, delay => {}); }
    catch (InvalidOperationException error) { failed = true; Check(error.Message.Contains(message), error.Message); }
    Check(failed, "Expected mismatched readback to fail");
  }
  static int Main() {
    try {
      foreach (object returned in new object[] { null, 0, (uint)0, true, false, 5, "provider-specific" }) {
        int reads = 0;
        BrightnessVerification.Confirm(85, returned, budget => { Check(budget > 0 && budget <= 200, "Read timeout budget"); reads++; return 85; }, delay => { throw new Exception("No delay needed after matching readback"); });
        Check(reads == 1, "Readback must determine success");
      }
      var waits = new List<int>(); int delayedReads = 0;
      BrightnessVerification.Confirm(85, null, budget => { delayedReads++; return delayedReads < 3 ? (int?)70 : 85; }, waits.Add);
      Check(delayedReads == 3 && waits.Count == 2 && waits[0] == 50 && waits[1] == 100, "Bounded settling reads");
      int recoveredReads = 0;
      BrightnessVerification.Confirm(85, null, budget => { recoveredReads++; if (recoveredReads == 1) throw new Exception("transient"); return 85; }, delay => {});
      Check(recoveredReads == 2, "Retry transient read failure");
      Fails(null, budget => null, "亮度未生效");
      Fails(0, budget => 70, "亮度未生效");
      Fails(5, budget => 70, "屏幕未接受");
      Fails(false, budget => 70, "屏幕未接受");
      Check(!BrightnessVerification.IsExplicitFailure(null), "Missing return is not failure");
      Check(!BrightnessVerification.IsExplicitFailure(true), "Boolean true");
      Check(BrightnessVerification.IsExplicitFailure(false), "Boolean false");
      Check(!BrightnessVerification.IsExplicitFailure((uint)0), "Numeric success");
      Check(BrightnessVerification.IsExplicitFailure((uint)7), "Numeric failure");
      Check(!BrightnessVerification.IsExplicitFailure("unknown"), "Unknown metadata must defer to readback");
      int attempts = 0; int totalWait = 0;
      Fails(null, budget => { attempts++; return 70; }, "亮度未生效");
      Check(attempts == 4, "Never retry reads indefinitely");
      try { BrightnessVerification.Confirm(85, null, budget => 70, delay => { totalWait += delay; }); } catch (InvalidOperationException) {}
      Check(totalWait == 350, "Settling delays remain below one second");
      Console.WriteLine("Pure brightness verification passed; real device writes = 0");
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
  }
}`;
  try {
    fs.writeFileSync(driver, code, 'utf8');
    const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:BrightnessTests', '/reference:System.Management.dll', '/reference:System.Web.Extensions.dll', '/out:' + executable, path.resolve(__dirname, '../native/Controls.cs'), driver], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 3000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /real device writes = 0/);
  } finally {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('touchbar-native-brightness-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
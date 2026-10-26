'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native', 'Controls.cs');
const directory = path.join(root, 'native', 'bin');
const output = path.join(directory, 'TouchBar.Controls.exe');
function buildNative() {
  if (process.platform !== 'win32') throw new Error('The native controls helper must be built on Windows.');
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const compiler = path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(compiler)) throw new Error('Windows .NET Framework 4 compiler was not found: ' + compiler);
  fs.mkdirSync(directory, { recursive: true });
  const args = ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Management.dll', '/reference:System.Web.Extensions.dll', '/out:' + output, source];
  const result = spawnSync(compiler, args, { stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Native controls compilation failed (' + result.status + ').');
  console.log('Built native/bin/TouchBar.Controls.exe');
  return output;
}
module.exports = { buildNative, output };
if (require.main === module) {
  try { buildNative(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
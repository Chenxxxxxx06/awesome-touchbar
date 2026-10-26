// Electron 45 downloads lazily. Reuse its verified installed distribution.
const path = require("node:path");
const { spawnSync } = require("node:child_process");
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  process.env.NODE_USE_ENV_PROXY = "1";
const dist = path.dirname(require("electron"));
const cli = require.resolve("electron-builder/cli.js");
const args = [
  cli,
  "--win",
  ...(process.argv.includes("--dir") ? ["--dir"] : ["portable"]),
  "--x64",
  "--publish",
  "never",
  "--config.electronDist=" + dist,
  "--config.afterPack=" + path.join(__dirname, "after-pack.cjs"),
];
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  windowsHide: true,
  env: process.env,
});
if (result.error)
  console.error("Windows packaging could not start:", result.error.message);
process.exitCode = result.status ?? 1;

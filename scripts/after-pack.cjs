const fs = require("node:fs/promises");
const path = require("node:path");

// Electron 45's WER helper must share the renamed application executable's stem.
// See https://www.electronjs.org/blog/electron-45-0#broader-crash-reporting-on-windows
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const source = path.join(context.appOutDir, "electron_wer.dll");
  try {
    await fs.access(source);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const name = path.basename(context.packager.appInfo.productFilename);
  await fs.rename(source, path.join(context.appOutDir, `${name}_wer.dll`));
};

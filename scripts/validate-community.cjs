"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { parseManifest } = require("../desktop/plugin-schema.cjs");
const root = path.join(__dirname, "../community");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name, "widget.json"));
const ids = new Set();
for (const file of files) {
  if (fs.statSync(file).size > 32768) throw new Error("Component too large");
  const m = parseManifest(fs.readFileSync(file, "utf8"));
  if (ids.has(m.id)) throw new Error("Duplicate component ID: " + m.id);
  ids.add(m.id);
  if (
    !process.argv.slice(2).length &&
    path.basename(path.dirname(file)) !== m.id
  )
    throw new Error("Directory and manifest ID differ");
  console.log("Valid: " + m.id + " (" + m.kind + ")");
}
console.log("Validated " + files.length + " component definitions");

"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const {
  validateManifest,
  parseManifest,
} = require("../desktop/plugin-schema.cjs");
const { createPluginStore, nextAlarm } = require("../desktop/plugin-store.cjs");
const { createDIY, MOCK } = require("../desktop/diy.cjs");
const { createWidgets } = require("../desktop/widgets.cjs");
const { options, launchSpec, runProcess } = require("../desktop/ai-runner.cjs");
const fixture = (kind, config) => ({
  ...MOCK,
  id: "test-" + kind,
  kind,
  config,
});
function directory(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "touchbar-diy-unit-"));
  t.after(() => {
    if (
      path.dirname(d) === path.resolve(os.tmpdir()) &&
      path.basename(d).startsWith("touchbar-diy-unit-")
    )
      fs.rmSync(d, { recursive: true, force: true });
  });
  return d;
}
async function done(app) {
  for (
    let i = 0;
    i < 100 &&
    ["generating", "validating", "cancelling"].includes(
      app.getState().job.status,
    );
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  return app.getState();
}
test("manifest boundary rejects executable fields, traversal IDs, malicious URLs and invalid limits", () => {
  assert.deepEqual(
    parseManifest("```json\n" + JSON.stringify(MOCK) + "\n```"),
    MOCK,
  );
  for (const patch of [
    { script: "alert(1)" },
    { id: "../escape" },
    { name: "x".repeat(25) },
    { kind: "shell" },
    { color: "url(http://bad)" },
    { config: { minutes: 0, repeat: true } },
    { config: { minutes: 10, repeat: "yes" } },
  ])
    assert.throws(() => validateManifest({ ...MOCK, ...patch }));
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/Windows",
    "https://user:secret@example.com",
  ])
    assert.throws(() =>
      validateManifest(fixture("links", { links: [{ label: "x", url }] })),
    );
  assert.throws(
    () => parseManifest('{"error":"不支持这个系统接口"}'),
    /不支持/,
  );
});
test("install/update/rollback are atomic and invalid updates preserve the previous version", (t) => {
  const file = path.join(directory(t), "plugins.json"),
    store = createPluginStore({ file });
  store.install(MOCK);
  assert.equal(store.getState().entries[0].isNew, true);
  store.action(MOCK.id, "seen");
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() =>
    store.install({ ...MOCK, config: { minutes: -1, repeat: true } }, MOCK.id),
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.throws(() => store.install(MOCK));
  store.install({ ...MOCK, config: { minutes: 30, repeat: false } }, MOCK.id);
  assert.equal(store.getState().entries[0].previous.config.minutes, 60);
  store.action(MOCK.id, "rollback");
  assert.equal(store.getState().entries[0].manifest.config.minutes, 60);
  const reloaded = createPluginStore({ file });
  assert.equal(reloaded.getState().entries[0].manifest.config.minutes, 60);
  reloaded.action(MOCK.id, "remove");
  assert.equal(reloaded.getState().entries.length, 0);
});
test("timers pause without drift, catch up once and repeat from delivery time", () => {
  let now = 1000;
  const notices = [],
    store = createPluginStore({
      now: () => now,
      onNotice: (n) => notices.push(n),
    });
  store.install(fixture("timer", { minutes: 1, repeat: true }));
  store.action("test-timer", "toggle");
  now += 20000;
  store.action("test-timer", "toggle");
  assert.equal(store.getState().entries[0].runtime.remaining, 40000);
  now += 500000;
  store.tick();
  assert.equal(notices.length, 0);
  store.action("test-timer", "toggle");
  now += 40001;
  store.tick();
  store.tick();
  assert.equal(notices.length, 1);
  assert.equal(store.getState().entries[0].runtime.deadline, now + 60000);
  now += 10000000;
  store.tick();
  assert.equal(notices.length, 2);
});
test("daily alarm, counter bounds, checklist persistence and corrupt storage", (t) => {
  const now = +new Date(2026, 9, 26, 12, 0, 0),
    file = path.join(directory(t), "plugins.json");
  const store = createPluginStore({ file, now: () => now });
  store.install(fixture("alarm", { time: "09:00" }));
  store.action("test-alarm", "toggle");
  assert.equal(
    new Date(store.getState().entries[0].runtime.deadline).getDate(),
    27,
  );
  assert.equal(nextAlarm("13:00", now) - now, 3600000);
  store.install(fixture("counter", { initial: 0, step: 2, min: 0, max: 3 }));
  store.action("test-counter", "count", 1);
  store.action("test-counter", "count", 1);
  assert.equal(store.getState().entries[1].runtime.count, 3);
  assert.throws(() => store.action("test-counter", "count", 99));
  store.install(fixture("checklist", { items: ["a", "b"] }));
  store.action("test-checklist", "check", 1);
  assert.deepEqual(
    createPluginStore({ file }).getState().entries[2].runtime.checked,
    [1],
  );
  fs.writeFileSync(file, "bad");
  const damaged = createPluginStore({ file });
  assert.ok(damaged.getState().error);
  assert.throws(() => damaged.install(MOCK));
  assert.equal(fs.readFileSync(file, "utf8"), "bad");
});
test("catalog migration preserves built-in order and saved plugin pins across restart", (t) => {
  const file = path.join(directory(t), "layout.json"),
    catalog = [
      { id: "diy", name: "DIY" },
      { id: "plugin:water-break", name: "Water" },
    ];
  let widgets = createWidgets({ file });
  widgets.setCatalog(catalog);
  widgets.begin();
  const l = widgets.getState().layout;
  l.order.reverse();
  l.pinned.push("plugin:water-break");
  widgets.preview(l);
  widgets.commit();
  widgets = createWidgets({ file });
  widgets.setCatalog(catalog);
  assert.ok(
    widgets.getState().layout.pinned.includes("plugin:water-break"),
    "plugin pins survive catalog discovery",
  );
  widgets.setCatalog([{ id: "diy", name: "DIY" }]);
  assert.ok(!widgets.getState().layout.order.includes("plugin:water-break"));
});
test("generation validates and repairs once, failures and cancellation install nothing", async (t) => {
  let calls = 0;
  const app = createDIY({
    directory: directory(t),
    mode: "live",
    discover: async () => [{ id: "codex", name: "Codex" }],
    generate: async () => (++calls === 1 ? "bad json" : JSON.stringify(MOCK)),
  });
  await app.refresh();
  await app.start({ toolId: "codex", request: "a timer" });
  assert.equal((await done(app)).job.status, "installed");
  assert.equal(calls, 2);
  app.dispose();
  const fail = createDIY({
    mode: "live",
    discover: async () => [{ id: "codex", name: "Codex" }],
    generate: async () => '{"script":"danger"}',
  });
  await fail.refresh();
  await fail.start({ toolId: "codex", request: "bad" });
  assert.equal((await done(fail)).job.status, "failed");
  assert.equal(fail.getState().entries.length, 0);
  fail.dispose();
  const cancel = createDIY({ mode: "mock" });
  await cancel.refresh();
  await cancel.start({ toolId: "codex", request: "test" });
  await assert.rejects(cancel.start({ toolId: "codex", request: "again" }));
  cancel.cancel();
  assert.equal((await done(cancel)).job.status, "cancelled");
  assert.equal(cancel.getState().entries.length, 0);
  cancel.dispose();
});
test("CLI arguments never use approval bypasses; models cannot inject flags or shell syntax", () => {
  for (const id of ["codex", "claude", "pi"]) {
    const args = options(id, "", "C:\\Temp\\result.txt");
    assert.ok(
      !args.some((a) => a.includes("bypass") || a.includes("skip-permissions")),
    );
    assert.throws(() => options(id, "model & echo danger", "x"));
  }
  assert.ok(options("claude", "", "x").includes("--safe-mode"));
  assert.ok(options("pi", "", "x").includes("--no-tools"));
  assert.ok(options("codex", "", "x").includes("read-only"));
  assert.throws(() => launchSpec("C:\\bad&dir\\pi.cmd", []));
});
test("process runner preserves UTF-8 across chunks and limits hangs", async () => {
  const r = await runProcess(
    process.execPath,
    [
      "-e",
      "const b=Buffer.from('喝水');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),10)",
    ],
    { timeout: 1000 },
  );
  assert.equal(r.stdout, "喝水");
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 50,
    }),
    /超时/,
  );
});

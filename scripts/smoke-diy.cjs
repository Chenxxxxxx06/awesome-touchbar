"use strict";
const { _electron, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  data = fs.mkdtempSync(path.join(os.tmpdir(), "touchbar-diy-ui-")),
  output = path.join(root, "release-local/screenshots");
fs.mkdirSync(output, { recursive: true });
let app;
const errors = [];
async function launch() {
  const env = {
    ...process.env,
    TOUCH_BAR_DATA_DIR: data,
    TOUCH_BAR_CONTROLS_MODE: "mock",
    TOUCH_BAR_AI_MODE: "mock",
    TOUCH_BAR_MUSIC_MODE: "mock",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath:
      process.env.TOUCH_BAR_TEST_EXECUTABLE || require("electron"),
    args: process.env.TOUCH_BAR_TEST_EXECUTABLE ? [] : [root],
    env,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect
    .poll(() =>
      page.evaluate(() => window.touchbar.getDIY().then((s) => s.tools.length)),
    )
    .toBe(3);
  await expect(page.locator("#volume-button")).toBeEnabled();
  return page;
}
async function expand(page) {
  if ((await page.locator(".expand").getAttribute("aria-expanded")) === "false")
    await page.locator(".expand").click();
}
async function openDIY(page) {
  await expand(page);
  await page.locator('[data-widget="diy"]').click();
  await expect(page.locator("#diy-panel")).toBeVisible();
}
async function importFile(page, manifest) {
  const file = path.join(data, "import.json");
  fs.writeFileSync(file, JSON.stringify(manifest));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  return page.evaluate(() => window.touchbar.importPlugin());
}
(async () => {
  try {
    let page = await launch();
    const controls = await page.evaluate(() => window.touchbar.getControls());
    await openDIY(page);
    await page.getByRole("button", { name: "使用 Codex", exact: true }).click();
    await page
      .getByRole("textbox", { name: "组件需求", exact: true })
      .fill("每小时提醒我喝水，可以暂停，使用薄荷绿图标。");
    await page.screenshot({
      path: path.join(output, "diy-compose.png"),
      omitBackground: true,
    });
    await page.getByRole("button", { name: "生成组件", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.touchbar.getDIY().then((s) => s.job.status)),
      )
      .toBe("installed");
    const water = page.locator('[data-widget="plugin:water-break"]');
    await expect(water).toBeVisible();
    await expect(water.locator(".plugin-new")).toBeVisible();
    await page.screenshot({
      path: path.join(output, "diy-new.png"),
      omitBackground: true,
    });
    await water.click();
    await expect(water.locator(".plugin-new")).toBeHidden();
    await expect(page.locator(".d-value")).toHaveText("60:00");
    await page.getByRole("button", { name: "开始提醒", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "暂停提醒", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(output, "diy-timer.png"),
      omitBackground: true,
    });
    await app.evaluate(() => {
      globalThis.__realNow = Date.now;
      Date.now = () => globalThis.__realNow() + 3600001;
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.touchbar
            .getProductivity()
            .then((s) => s.notices.some((n) => n.kind === "diy")),
        ),
      )
      .toBe(true);
    await page.locator("#notice-button").click();
    await expect(page.locator(".p-title")).toHaveText("喝水提醒");
    await page.locator(".p-title").click();
    await expect(page.locator("#diy-panel")).toBeVisible();
    await page
      .getByRole("button", { name: "管理这个组件", exact: true })
      .click();
    await page
      .getByRole("button", { name: "用 AI 修改组件", exact: true })
      .click();
    await page.getByRole("button", { name: "使用 Codex", exact: true }).click();
    await page
      .getByRole("textbox", { name: "组件需求", exact: true })
      .fill("改成每 30 分钟提醒一次");
    await page.getByRole("button", { name: "生成组件", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.touchbar
            .getDIY()
            .then((s) => s.entries[0].manifest.config.minutes),
        ),
      )
      .toBe(30);
    await water.click();
    await page
      .getByRole("button", { name: "管理这个组件", exact: true })
      .click();
    await page
      .getByRole("button", { name: "恢复上一版组件", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.touchbar
            .getDIY()
            .then((s) => s.entries[0].manifest.config.minutes),
        ),
      )
      .toBe(60);
    const exported = path.join(data, "export.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exported);
    await page
      .getByRole("button", { name: "导出组件用于分享", exact: true })
      .click();
    await expect.poll(() => fs.existsSync(exported)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(exported, "utf8"));
    assert.equal(manifest.kind, "timer");
    assert.ok(!("runtime" in manifest));
    await importFile(page, {
      ...manifest,
      id: "reading-count",
      name: "阅读计数",
      kind: "counter",
      icon: "count",
      config: { initial: 0, step: 1, min: 0, max: 100 },
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator('[data-widget="plugin:reading-count"]').click();
    await page.getByRole("button", { name: "增加计数", exact: true }).click();
    await expect(page.locator(".d-value")).toHaveText("1");
    const before = (await page.evaluate(() => window.touchbar.getDIY())).entries
      .length;
    await assert.rejects(
      importFile(page, {
        ...manifest,
        id: "bad-script",
        script: "process.exit()",
      }),
    );
    assert.equal(
      (await page.evaluate(() => window.touchbar.getDIY())).entries.length,
      before,
    );
    // Pin a generated component through the actual editor and persist it.
    const editorPromise = app.waitForEvent("window");
    await page.locator("#customize-button").click();
    const editor = await editorPromise;
    await editor.locator('[data-id="plugin:reading-count"] .pin').click();
    await editor.locator("#done").click();
    await app.close();
    app = null;
    fs.writeFileSync(
      path.join(data, "widget-layout.json"),
      JSON.stringify({ edge: "left", scale: 0.72, y: 80 }),
    );
    page = await launch();
    await expect(page.locator("body")).toHaveAttribute(
      "data-orientation",
      "vertical",
    );
    await expect(
      page.locator('.compact-controls [data-widget="plugin:reading-count"]'),
    ).toBeVisible();
    await page.locator('[data-widget="plugin:reading-count"]').click();
    await expect(page.locator(".d-value")).toHaveText("1");
    await page.screenshot({
      path: path.join(output, "diy-counter-vertical.png"),
      omitBackground: true,
    });
    await page.keyboard.press("Escape");
    await openDIY(page);
    await page.getByRole("button", { name: "使用 Pi", exact: true }).click();
    const composerPromise = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "打开完整输入框", exact: true })
      .click();
    const composer = await composerPromise;
    await expect(composer.locator("#request")).toBeVisible();
    await composer.locator("#request").fill("增加一个提醒");
    await composer.screenshot({
      path: path.join(output, "diy-composer-vertical.png"),
    });
    await composer.locator("#close").click();
    await page.evaluate(async () => {
      await window.touchbar.startDIY({ toolId: "pi", request: "a timer" });
      await window.touchbar.cancelDIY();
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.touchbar.getDIY().then((s) => s.job.status)),
      )
      .toBe("cancelled");
    assert.equal(
      (await page.evaluate(() => window.touchbar.getDIY())).entries.length,
      2,
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator('[data-widget="plugin:reading-count"]').click();
    await page
      .getByRole("button", { name: "管理这个组件", exact: true })
      .click();
    await page.getByRole("button", { name: "移除组件", exact: true }).click();
    await page.getByRole("button", { name: "移除组件", exact: true }).click();
    await expect(
      page.locator('[data-widget="plugin:reading-count"]'),
    ).toHaveCount(0);
    assert.deepEqual(
      await page.evaluate(() => window.touchbar.getControls()),
      controls,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        realAudioWrites: false,
        realAIRequests: false,
        checks: [
          "inline compose",
          "generation",
          "NEW badge",
          "timer and inbox",
          "update and rollback",
          "export and import",
          "invalid import rejection",
          "custom layout persistence",
          "vertical popup input",
          "cancel",
          "remove",
        ],
        output,
      }),
    );
  } finally {
    await app?.close();
    const safe = path.resolve(data);
    if (
      path.dirname(safe) === path.resolve(os.tmpdir()) &&
      path.basename(safe).startsWith("touchbar-diy-ui-")
    )
      fs.rmSync(safe, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

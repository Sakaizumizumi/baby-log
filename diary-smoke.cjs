const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const root = __dirname;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});

async function count(page, expected, firsts = false) {
  await page.waitForFunction(({ expected, firsts }) =>
    document.getElementById(firsts ? "firstsCount" : "diaryCount").textContent === String(expected),
  { expected, firsts });
}

async function add(page, text, time, first = false) {
  await page.locator("#entryText").fill(text);
  await page.locator("#entryTime").fill(time);
  await page.locator("#entryFirst").setChecked(first);
  await page.locator("#saveEntry").click();
  await page.waitForFunction(() => !document.getElementById("composerFields").disabled);
}

(async () => {
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => !document.getElementById("composerFields").disabled);
    assert.equal(await page.title(), "宝宝日记");
    assert.equal(await page.locator('a[href="analysis.html"]').count(), 0);
    assert.match(await page.locator("#diaryList").innerText(), /还没有日记/);
    await page.evaluate(() => localStorage.setItem("baby-log:v1:records", JSON.stringify([{
      id: "existing-feed", type: "feed", time: "2026-10-21T01:00:00.000Z",
      feed: { method: "formula", amountMl: 30 },
      createdAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T01:00:00.000Z"
    }])));
    const feedBefore = await page.evaluate(() => localStorage.getItem("baby-log:v1:records"));
    await page.locator("#entryText").fill("   ");
    await page.locator("#saveEntry").click();
    await count(page, 0);
    await add(page, "宝宝睡了一个好觉\n<b>文字原样保存</b>", "2026-10-20T08:00");
    await count(page, 1);
    assert.equal(await page.locator(".diary-entry-text b").count(), 0);
    const buffer = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 480; canvas.height = 320;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#d8eadf"; ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = "#ecb557"; ctx.fillRect(140, 90, 200, 150);
      ctx.fillStyle = "#223033"; ctx.font = "28px sans-serif";
      ctx.fillText("A little memory", 125, 275);
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    await page.locator("#entryPhotos").setInputFiles({ name: "memory.png", mimeType: "image/png", buffer });
    await page.waitForFunction(() => document.querySelectorAll("#attachmentPreview img").length === 1);
    await add(page, "第一次翻身，自己完成了！", "2026-10-21T11:20", true);
    await count(page, 2); await count(page, 1, true);
    await page.reload();
    await count(page, 2);
    await page.waitForFunction(() => {
      const img = document.querySelector("#diaryList .diary-entry-photos img");
      return img && img.complete && img.naturalWidth > 0;
    });
    await page.locator("#diaryList [data-action=photo]").click();
    assert.equal(await page.locator("#diaryPhotoDialog").evaluate(el => el.open), true);
    await page.locator("#closeDiaryPhoto").click();
    await page.locator("#firstsTab").click();
    await page.locator("#firstsList [data-action=first]").click();
    await count(page, 0, true);
    await page.locator("#diaryTab").click();
    const first = page.locator("#diaryList .diary-entry").filter({ hasText: "第一次翻身" });
    await first.locator("[data-action=edit]").click();
    assert.equal(await page.locator("#attachmentPreview img").count(), 1);
    await page.locator("#entryText").fill("第一次翻身，留下了一张照片。");
    await page.locator("#entryFirst").check();
    await page.locator("#saveEntry").click();
    await count(page, 1, true); await count(page, 2);
    assert.equal(await page.locator("#diaryList .diary-entry-photos img").count(), 1);
    await add(page, "夜里醒来喝了奶", "2026-10-20T23:50");
    await add(page, "跨过午夜又睡着了", "2026-10-21T00:10");
    await count(page, 4);
    assert.deepEqual(await page.locator("#diaryList time").allTextContents(), ["11:20", "00:10", "23:50", "08:00"]);
    await page.locator("#diaryDateFilter").fill("2026-10-20");
    await page.locator("#diaryDateFilter").dispatchEvent("change");
    await count(page, 2); await count(page, 0, true);
    await page.locator("#clearDiaryFilter").click(); await count(page, 4);
    assert.equal(await page.evaluate(() => localStorage.getItem("baby-log:v1:records")), feedBefore);
    console.log("PASS add, images, refresh persistence, firsts, editing, cross-midnight grouping, reverse sorting, filtering, existing feed data");

    await page.locator(".diary-backup summary").click();
    const promise = page.waitForEvent("download");
    await page.locator("#exportDiary").click();
    const download = await promise;
    const backupBuffer = await fs.readFile(await download.path());
    const backup = JSON.parse(backupBuffer.toString("utf8"));
    assert.equal(backup.entries.length, 4);
    assert.equal(backup.entries.find(entry => entry.text === "跨过午夜又睡着了").time, "2026-10-20T16:10:00.000Z");
    assert.match(backup.entries.find(entry => entry.isFirst).photos[0].dataUrl, /^data:image\/jpeg;base64,/);
    const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const other = await otherContext.newPage();
    other.on("pageerror", error => errors.push(error.message));
    await other.goto(base);
    await other.waitForFunction(() => !document.getElementById("composerFields").disabled);
    const upload = { name: "diary-backup.json", mimeType: "application/json", buffer: backupBuffer };
    await other.locator("#importDiary").setInputFiles(upload);
    await count(other, 4); await count(other, 1, true);
    await other.waitForFunction(() => {
      const img = document.querySelector("#diaryList .diary-entry-photos img");
      return img && img.complete && img.naturalWidth > 0;
    });
    await other.locator("#importDiary").setInputFiles(upload);
    await other.waitForFunction(() => document.getElementById("toast").textContent.includes("跳过 4"));
    const invalid = structuredClone(backup);
    invalid.entries.push({ id: "broken" });
    await other.locator("#importDiary").setInputFiles({
      name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid))
    });
    await other.waitForFunction(() => document.getElementById("toast").textContent.includes("导入失败"));
    await count(other, 4);
    other.once("dialog", dialog => dialog.accept());
    await other.locator("#diaryList .diary-entry").filter({ hasText: "第一次翻身" }).locator("[data-action=delete]").click();
    await count(other, 3); await count(other, 0, true);
    console.log("PASS image backup, clean-device restore, import deduplication, invalid-import rollback, delete synchronization");

    const output = path.join(os.tmpdir(), "baby-diary-checks");
    await fs.mkdir(output, { recursive: true });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(size.scroll <= size.client, "diary overflow at " + width + ": " + JSON.stringify(size));
      if (width === 390 || width === 1280) {
        await page.screenshot({ path: path.join(output, "diary-" + width + ".png"), fullPage: true });
      }
      if (width === 390) {
        await page.locator("#firstsTab").click();
        await page.screenshot({ path: path.join(output, "firsts-390.png"), fullPage: true });
        await page.locator("#diaryTab").click();
      }
    }
    console.log("PASS layouts at 320/390/768/1280px; screenshots: " + output);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller && !document.getElementById("composerFields").disabled);
    const cached = await page.evaluate(async () => {
      const cache = await caches.open("baby-log-pwa-v38");
      return (await cache.keys()).map(req => new URL(req.url).pathname + new URL(req.url).search);
    });
    assert.ok(cached.includes("/diary.js?v=38"));
    assert.ok(cached.includes("/records.html"));
    assert.ok(!cached.some(name => /analysis\.(js|css)/.test(name)));
    await context.setOffline(true);
    await page.goto(base + "/index.html?offline=1#firsts");
    await count(page, 4);
    assert.equal(await page.locator("#firstsPanel").isVisible(), true);
    await add(page, "离线时也能保存的一条日记", "2026-10-21T12:30"); await count(page, 5);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["quick.html", "records.html", "photos.html"]) {
      await page.goto(base + "/" + route + "?offline=1");
      assert.equal(await page.locator('a[href="index.html"]').count(), 1);
      const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(size.scroll <= size.client, route + " overflow");
    }
    await page.goto(base + "/analysis.html");
    await page.waitForURL("**/index.html"); await count(page, 5);
    assert.deepEqual(errors, []);
    console.log("PASS v38 cache, offline page loads, offline writes, retained pages, old-analysis redirect");
    console.log("All diary smoke checks passed.");
  } finally {
    if (browser) { await browser.close(); }
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

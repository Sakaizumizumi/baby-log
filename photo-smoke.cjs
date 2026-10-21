const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const fixtureUrl = "https://raw.githubusercontent.com/strukturag/libheif/v1.22.2/examples/example.heic";
const fixtureHash = "7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2";
const root = __dirname;
const prefix = "/baby-log/";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  pathname = pathname.slice(prefix.length) || "index.html";
  const target = path.resolve(root, pathname);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
    res.end(await fs.readFile(target));
  } catch { res.writeHead(404).end(); }
});

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById("composerFields").disabled);
}

async function attachments(page, expected) {
  await ready(page);
  assert.equal(await page.locator("#attachmentPreview img").count(), expected);
}

(async () => {
  let browser;
  try {
    const fixturePath = process.env.PHOTO_HEIC_FIXTURE || path.join(os.tmpdir(), "baby-log-example.heic");
    let heic;
    try { heic = await fs.readFile(fixturePath); } catch {
      const response = await fetch(fixtureUrl);
      assert.ok(response.ok, "Public HEIC fixture download failed");
      heic = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(fixturePath, heic);
    }
    assert.equal(crypto.createHash("sha256").update(heic).digest("hex"), fixtureHash);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    const base = origin + prefix;
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) { externalRequests.push(request.url()); }
    });
    await page.goto(base);
    await ready(page);
    assert.equal(await page.evaluate(() => typeof window.HeicTo), "undefined");
    const jpeg = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 96; canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#36a66f"; ctx.fillRect(0, 0, 96, 64);
      ctx.fillStyle = "#f2bb55"; ctx.fillRect(20, 20, 30, 20);
      return canvas.toDataURL("image/jpeg").split(",")[1];
    }), "base64");
    for (const mime of ["", "application/octet-stream", "image/jpg", "image/heic"]) {
      const result = await page.evaluate(async ({ bytes, mime }) => {
        const photo = await BabyPhoto.prepare(new File([new Uint8Array(bytes)], "SamsungPhoto", { type: mime }));
        return { type: photo.blob.type, width: photo.width, height: photo.height, size: photo.blob.size };
      }, { bytes: Array.from(jpeg), mime });
      assert.equal(result.type, "image/jpeg");
      assert.equal(result.width, 96); assert.ok(result.size > 0);
    }
    assert.equal(await page.evaluate(() => typeof window.HeicTo), "undefined", "JPEG should not load the HEIC decoder");
    console.log("PASS real-content recognition for missing, generic, alias and incorrect MIME");

    await page.locator("#entryText").fill("三星相册照片测试");
    await page.locator("#entryPhotos").setInputFiles([
      { name: "SamsungPhoto", mimeType: "application/octet-stream", buffer: jpeg },
      { name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a picture") }
    ]);
    await attachments(page, 1);
    assert.equal(await page.locator("#photoError").isVisible(), true);
    assert.match(await page.locator("#photoError").innerText(), /broken.jpg/);
    assert.equal(await page.locator("#entryText").inputValue(), "三星相册照片测试");
    await page.locator("#entryPhotos").setInputFiles({ name: "Samsung.HEIC", mimeType: "image/heic", buffer: heic });
    await attachments(page, 2);
    assert.equal(await page.locator("#photoError").isVisible(), false);
    assert.equal(await page.evaluate(() => typeof window.HeicTo), "function", "The real HEIC should exercise the fallback decoder");
    await page.locator("#entryFirst").check();
    await page.locator("#saveEntry").click();
    await page.waitForFunction(() => document.getElementById("diaryCount").textContent === "1");
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => Array.from(document.querySelectorAll("#diaryList .diary-entry-photos img")).every(img => img.complete && img.naturalWidth > 0));
    assert.equal(await page.locator("#diaryList .diary-entry-photos img").count(), 2);
    const pixels = await page.locator("#diaryList .diary-entry-photos img").nth(1).evaluate(img => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4) { colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]); }
      return colors.size;
    });
    assert.ok(pixels > 3, "Decoded HEIC must contain actual image pixels");
    console.log("PASS real HEIC decode, mixed batches, draft preservation, image pixels and refresh persistence");

    await page.locator(".diary-backup summary").click();
    const downloaded = page.waitForEvent("download");
    await page.locator("#exportDiary").click();
    const download = await downloaded;
    const backup = await fs.readFile(await download.path());
    const exported = JSON.parse(backup.toString("utf8"));
    assert.equal(exported.entries[0].photos.length, 2);
    assert.ok(exported.entries[0].photos.every(photo => /^data:image\/jpeg;base64,/.test(photo.dataUrl)));
    const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const other = await otherContext.newPage();
    await other.goto(base); await ready(other);
    await other.locator("#importDiary").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: backup });
    await other.waitForFunction(() => document.getElementById("diaryCount").textContent === "1");
    await other.waitForFunction(() => {
      const images = Array.from(document.querySelectorAll("#diaryList .diary-entry-photos img"));
      return images.length === 2 && images.every(img => img.complete && img.naturalWidth > 0);
    });
    console.log("PASS converted photos round-trip through JSON backup on a clean device");

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => typeof window.HeicTo), "undefined");
    const converterCached = await page.evaluate(async () => {
      const cache = await caches.open("baby-log-pwa-v39");
      return Boolean(await cache.match(new URL("vendor/heic-to-1.5.2.js", location.href)));
    });
    assert.ok(converterCached);
    await context.setOffline(true);
    await page.locator("#entryPhotos").setInputFiles({ name: "Samsung.HEIF", mimeType: "application/octet-stream", buffer: heic });
    await attachments(page, 1);
    assert.equal(await page.evaluate(() => typeof window.HeicTo), "function");
    await page.locator("#entryText").fill("离线也可以添加 HEIC 照片");
    await page.locator("#saveEntry").click();
    await page.waitForFunction(() => document.getElementById("diaryCount").textContent === "2");
    await page.screenshot({ path: path.join(os.tmpdir(), "baby-log-heic-mobile.png"), fullPage: true });
    console.log("PASS HEIC conversion from the offline cache without preloading the decoder in the page");

    await page.goto(base + "photos.html");
    await page.locator("#navelGalleryInput").setInputFiles({ name: "Samsung.heic", mimeType: "image/heic", buffer: heic });
    await page.waitForFunction(() => document.getElementById("photoTotal").textContent === "1");
    await page.waitForFunction(() => {
      const image = document.querySelector(".photo-thumb-button img");
      return image && image.complete && image.naturalWidth > 0;
    });
    await page.locator("#poopPhotoInput").setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("broken") });
    await page.waitForFunction(() => !document.getElementById("photoUploadError").hidden);
    assert.equal(await page.locator("#photoTotal").innerText(), "1", "Invalid images must not create broken photo records");
    await page.locator("#poopGalleryInput").setInputFiles({ name: "empty.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(0) });
    await page.waitForFunction(() => document.getElementById("photoUploadError").textContent.includes("照片为空"));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(size.scroll <= size.width);
    console.log("PASS independent photo page, empty/corrupt files, no photo uploads and mobile layout");
    console.log("All Samsung photo compatibility checks passed.");
  } finally {
    if (browser) { await browser.close(); }
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

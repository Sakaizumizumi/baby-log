(function () {
  "use strict";

  var converterPromise = null;
  var scriptBase = document.currentScript ? document.currentScript.src : document.baseURI;
  var converterUrl = new URL("vendor/heic-to-1.5.2.js", scriptBase).href;

  function photoError(code) {
    var error = new Error(code);
    error.photoCode = code;
    return error;
  }

  function fourCC(bytes, offset) {
    return String.fromCharCode.apply(null, bytes.subarray(offset, offset + 4));
  }

  async function identify(file) {
    if (!file || !file.size) { throw photoError("empty"); }
    var bytes;
    try { bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer()); }
    catch (error) { throw photoError("read"); }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { return "image/jpeg"; }
    if (bytes[0] === 0x89 && fourCC(bytes, 1) === "PNG\r") { return "image/png"; }
    if (fourCC(bytes, 0) === "GIF8") { return "image/gif"; }
    if (fourCC(bytes, 0) === "RIFF" && fourCC(bytes, 8) === "WEBP") { return "image/webp"; }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) { return "image/bmp"; }

    // HEIF and AVIF share ftyp; inspect compatible brands before the generic mif1 brand.
    if (bytes.length >= 16 && fourCC(bytes, 4) === "ftyp") {
      var boxSize = new DataView(bytes.buffer).getUint32(0);
      var end = boxSize >= 16 ? Math.min(boxSize, bytes.length) : bytes.length;
      var brands = [fourCC(bytes, 8)];
      for (var offset = 16; offset + 4 <= end; offset += 4) { brands.push(fourCC(bytes, offset)); }
      if (brands.some(function (brand) { return brand === "avif" || brand === "avis"; })) {
        return "image/avif";
      }
      if (brands.some(function (brand) { return /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand); })) {
        return "image/heic";
      }
    }
    var mime = (file.type || "").toLowerCase().split(";")[0];
    var suffix = (file.name || "").toLowerCase().split(".").pop();
    var extensions = {
      jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif",
      heic: "image/heic", heif: "image/heic", hif: "image/heic"
    };
    if (extensions[suffix]) { return extensions[suffix]; }
    if (/^image\/hei[cf](?:-sequence)?$/.test(mime)) { return "image/heic"; }
    if (/^image\/(?:jpg|pjpeg)$/.test(mime)) { return "image/jpeg"; }
    if (mime.indexOf("image/") === 0) { return mime; }
    // Some gallery providers omit both the extension and MIME.
    if (!mime || mime === "application/octet-stream") { return ""; }
    throw photoError("type");
  }

  function loadNative(blob) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var url = URL.createObjectURL(blob);
      var timer = setTimeout(function () { finish(false); }, 20000);
      function finish(ok) {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        URL.revokeObjectURL(url);
        if (ok && image.naturalWidth && image.naturalHeight) { resolve(image); }
        else { reject(photoError("decode")); }
      }
      image.onload = function () { finish(true); };
      image.onerror = function () { finish(false); };
      image.src = url;
    });
  }

  function loadConverter() {
    if (typeof window.HeicTo === "function") { return Promise.resolve(window.HeicTo); }
    if (converterPromise) { return converterPromise; }
    converterPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var timer = setTimeout(fail, 30000);
      function fail() {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        reject(photoError("converter-load"));
      }
      script.src = converterUrl;
      script.async = true;
      script.onload = function () {
        clearTimeout(timer);
        if (typeof window.HeicTo === "function") { resolve(window.HeicTo); }
        else { fail(); }
      };
      script.onerror = fail;
      document.head.appendChild(script);
    }).catch(function (error) { converterPromise = null; throw error; });
    return converterPromise;
  }

  async function decode(file, mime, onProgress) {
    var blob = mime && mime !== file.type ? new Blob([file], { type: mime }) : file;
    try { return await loadNative(blob); } catch (nativeError) {
      if (mime !== "image/heic") {
        if (typeof createImageBitmap === "function") {
          try { return await createImageBitmap(blob); } catch (bitmapError) {}
        }
        throw photoError("decode");
      }
    }
    onProgress("正在转换 HEIC/HEIF 照片");
    var convert = await loadConverter();
    try { return await convert({ blob: blob, type: "bitmap" }); }
    catch (error) { throw photoError("heic-convert"); }
  }

  async function prepare(file, options) {
    options = options || {};
    var report = options.onProgress || function () {};
    report("正在读取照片");
    var mime = await identify(file);
    var image = await decode(file, mime, report);
    var canvas = document.createElement("canvas");
    try {
      var width = image.naturalWidth || image.width;
      var height = image.naturalHeight || image.height;
      var scale = Math.min(1, (options.maxEdge || 1600) / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var ctx = canvas.getContext("2d");
      if (!ctx) { throw photoError("encode"); }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      report("正在保存照片");
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (result) {
          if (result) { resolve(result); } else { reject(photoError("encode")); }
        }, "image/jpeg", options.quality || 0.84);
      });
      return { blob: blob, mimeType: blob.type, width: canvas.width, height: canvas.height };
    } finally {
      if (typeof image.close === "function") { image.close(); }
      canvas.width = canvas.height = 1;
    }
  }

  function errorMessage(error) {
    return {
      empty: "照片为空，请先在相册中完整下载后重新选择。",
      read: "无法读取照片，请先在相册中完整下载后重新选择。",
      type: "请选择照片文件。",
      decode: "照片无法解码，请从相册重新选择，或另存为 JPG 后重试。",
      "converter-load": "照片转换组件未加载，请联网刷新页面后重试。",
      "heic-convert": "这张 HEIC/HEIF 照片转换失败，请在相册另存为 JPG 后重试。",
      encode: "照片处理失败，请尝试较小的照片后重试。"
    }[error && error.photoCode] || "照片处理失败，请重新选择后重试。";
  }

  window.BabyPhoto = { prepare: prepare, identify: identify, errorMessage: errorMessage };
})();

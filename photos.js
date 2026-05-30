(function () {
  "use strict";

  var DB_NAME = "baby-photo-log";
  var DB_VERSION = 1;
  var STORE_NAME = "photos";
  var DAY_ONE_DATE_KEY = "2026-05-26";
  var SHANGHAI_OFFSET_MINUTES = 8 * 60;
  var MAX_IMAGE_EDGE = 1600;
  var JPEG_QUALITY = 0.82;
  var toastTimer = 0;
  var dialogUrl = "";
  var dbPromise = null;

  var labels = {
    poop: "大便",
    navel: "肚脐"
  };

  var state = {
    photos: [],
    objectUrls: []
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    loadAndRender();
    registerServiceWorker();
  }

  function cacheElements() {
    els.lastPoopPhoto = byId("lastPoopPhoto");
    els.lastPoopPhotoGap = byId("lastPoopPhotoGap");
    els.lastNavelPhoto = byId("lastNavelPhoto");
    els.lastNavelPhotoGap = byId("lastNavelPhotoGap");
    els.photoTotal = byId("photoTotal");
    els.photoCounts = byId("photoCounts");
    els.poopPhotoInput = byId("poopPhotoInput");
    els.navelPhotoInput = byId("navelPhotoInput");
    els.poopNote = byId("poopNote");
    els.navelNote = byId("navelNote");
    els.refreshPhotos = byId("refreshPhotos");
    els.photoFilter = byId("photoFilter");
    els.photoList = byId("photoList");
    els.toast = byId("toast");
    els.photoDialog = byId("photoDialog");
    els.photoDialogTitle = byId("photoDialogTitle");
    els.photoDialogMeta = byId("photoDialogMeta");
    els.photoDialogImage = byId("photoDialogImage");
    els.closePhotoDialog = byId("closePhotoDialog");
  }

  function bindEvents() {
    els.poopPhotoInput.addEventListener("change", function () {
      saveSelectedPhoto("poop", els.poopPhotoInput, els.poopNote);
    });

    els.navelPhotoInput.addEventListener("change", function () {
      saveSelectedPhoto("navel", els.navelPhotoInput, els.navelNote);
    });

    els.refreshPhotos.addEventListener("click", loadAndRender);
    els.photoFilter.addEventListener("change", render);

    els.photoList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-id]");
      if (!button) {
        return;
      }

      if (button.dataset.intent === "view") {
        openPhoto(button.dataset.id);
      }

      if (button.dataset.intent === "delete") {
        deletePhotoRecord(button.dataset.id);
      }
    });

    els.closePhotoDialog.addEventListener("click", closePhotoDialog);
    els.photoDialog.addEventListener("close", clearDialogImage);
  }

  function loadAndRender() {
    return getAllPhotos().then(function (photos) {
      state.photos = photos.sort(function (a, b) {
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      });
      render();
    }).catch(function () {
      showToast("照片存储暂不可用");
    });
  }

  function render() {
    renderSummary();
    renderHistory();
  }

  function renderSummary() {
    var poopPhotos = photosByType("poop");
    var navelPhotos = photosByType("navel");

    fillLastPhoto(poopPhotos, els.lastPoopPhoto, els.lastPoopPhotoGap);
    fillLastPhoto(navelPhotos, els.lastNavelPhoto, els.lastNavelPhotoGap);

    els.photoTotal.textContent = String(state.photos.length);
    els.photoCounts.textContent = "大便 " + poopPhotos.length + " · 肚脐 " + navelPhotos.length;
  }

  function fillLastPhoto(photos, valueEl, gapEl) {
    if (!photos.length) {
      valueEl.textContent = "--";
      gapEl.textContent = "--";
      return;
    }

    valueEl.textContent = formatTime(photos[0].uploadedAt);
    gapEl.textContent = "距现在 " + gapFromNow(photos[0].uploadedAt) + " · " + latestPairGapText(photos);
  }

  function latestPairGapText(photos) {
    if (photos.length < 2) {
      return "第一次";
    }
    return "上次间隔 " + formatInterval(photos[1].uploadedAt, photos[0].uploadedAt);
  }

  function renderHistory() {
    revokeObjectUrls();

    var filter = els.photoFilter.value;
    var photos = state.photos.filter(function (photo) {
      return filter === "all" || photo.type === filter;
    });

    if (!photos.length) {
      els.photoList.innerHTML = '<div class="empty-state">暂无照片</div>';
      return;
    }

    els.photoList.innerHTML = groupByDate(photos).map(function (group) {
      return '<section class="date-group"><div class="date-title">' +
        escapeHtml(group.title) +
        '</div>' +
        group.photos.map(renderPhotoItem).join("") +
        "</section>";
    }).join("");
  }

  function renderPhotoItem(photo) {
    var url = createObjectUrl(photo.blob);
    var previous = previousSameType(photo);
    var intervalText = previous ? "距上次同类 " + formatInterval(previous.uploadedAt, photo.uploadedAt) : "第一次";

    return '<article class="photo-item">' +
      '<button class="photo-thumb-button" type="button" data-intent="view" data-id="' + escapeHtml(photo.id) + '">' +
      '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(labelFor(photo.type) + "照片") + '">' +
      "</button>" +
      '<div class="photo-info">' +
      '<div class="photo-heading">' +
      '<strong>' + escapeHtml(labelFor(photo.type) + "照片") + '</strong>' +
      '<span>' + escapeHtml(formatTime(photo.uploadedAt)) + "</span>" +
      "</div>" +
      '<div class="photo-meta">上传时间：' + escapeHtml(formatDateTime(photo.uploadedAt)) + "</div>" +
      '<div class="chip-list">' +
      '<span class="chip">' + escapeHtml(intervalText) + "</span>" +
      '<span class="chip">' + escapeHtml(formatFileSize(photo.size || photo.blob.size)) + "</span>" +
      "</div>" +
      (photo.note ? '<div class="photo-note">' + escapeHtml(photo.note) + "</div>" : "") +
      "</div>" +
      '<div class="photo-actions">' +
      '<button class="secondary-button" type="button" data-intent="view" data-id="' + escapeHtml(photo.id) + '">查看</button>' +
      '<button class="danger-button" type="button" data-intent="delete" data-id="' + escapeHtml(photo.id) + '">删除</button>' +
      "</div>" +
      "</article>";
  }

  function saveSelectedPhoto(type, input, noteEl) {
    var file = input.files && input.files[0];
    input.value = "";
    if (!file) {
      return;
    }

    if (!file.type || file.type.indexOf("image/") !== 0) {
      showToast("请选择图片文件");
      return;
    }

    showToast("正在保存照片");
    prepareImage(file).then(function (image) {
      var nowIso = new Date().toISOString();
      return addPhoto({
        id: createId(),
        type: type,
        uploadedAt: nowIso,
        note: noteEl.value.trim(),
        blob: image.blob,
        mimeType: image.mimeType,
        originalName: file.name || "",
        size: image.blob.size || file.size || 0,
        width: image.width || 0,
        height: image.height || 0
      });
    }).then(function () {
      noteEl.value = "";
      showToast("照片已保存");
      return loadAndRender();
    }).catch(function () {
      showToast("照片保存失败，可能是空间不足");
    });
  }

  function prepareImage(file) {
    return loadImage(file).then(function (image) {
      var width = image.naturalWidth || image.width || 0;
      var height = image.naturalHeight || image.height || 0;
      var edge = Math.max(width, height);

      if (!width || !height || edge <= MAX_IMAGE_EDGE) {
        return {
          blob: file,
          height: height,
          mimeType: file.type || "image/jpeg",
          width: width
        };
      }

      var scale = MAX_IMAGE_EDGE / edge;
      var targetWidth = Math.round(width * scale);
      var targetHeight = Math.round(height * scale);
      var canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      return canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY).then(function (blob) {
        return {
          blob: blob,
          height: targetHeight,
          mimeType: "image/jpeg",
          width: targetWidth
        };
      });
    }).catch(function () {
      return {
        blob: file,
        height: 0,
        mimeType: file.type || "application/octet-stream",
        width: 0
      };
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Image load failed"));
      };
      image.src = url;
    });
  }

  function openPhoto(id) {
    var photo = findPhoto(id);
    if (!photo) {
      showToast("未找到照片");
      return;
    }

    clearDialogImage();
    dialogUrl = URL.createObjectURL(photo.blob);
    var previous = previousSameType(photo);
    els.photoDialogTitle.textContent = labelFor(photo.type) + "照片";
    els.photoDialogMeta.textContent = "上传时间：" + formatDateTime(photo.uploadedAt) + " · " +
      (previous ? "距上次同类 " + formatInterval(previous.uploadedAt, photo.uploadedAt) : "第一次");
    els.photoDialogImage.src = dialogUrl;
    els.photoDialogImage.alt = labelFor(photo.type) + "照片";

    if (typeof els.photoDialog.showModal === "function") {
      els.photoDialog.showModal();
    } else {
      els.photoDialog.setAttribute("open", "open");
    }
  }

  function closePhotoDialog() {
    if (typeof els.photoDialog.close === "function") {
      els.photoDialog.close();
    } else {
      els.photoDialog.removeAttribute("open");
      clearDialogImage();
    }
  }

  function clearDialogImage() {
    if (dialogUrl) {
      URL.revokeObjectURL(dialogUrl);
      dialogUrl = "";
    }
    if (els.photoDialogImage) {
      els.photoDialogImage.removeAttribute("src");
    }
  }

  function deletePhotoRecord(id) {
    var photo = findPhoto(id);
    if (!photo) {
      return;
    }

    if (!window.confirm("删除这张" + labelFor(photo.type) + "照片？")) {
      return;
    }

    deletePhoto(id).then(function () {
      showToast("照片已删除");
      return loadAndRender();
    }).catch(function () {
      showToast("删除失败");
    });
  }

  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("uploadedAt", "uploadedAt", { unique: false });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });

    return dbPromise;
  }

  function getAllPhotos() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
        request.onsuccess = function () {
          resolve(request.result || []);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    });
  }

  function addPhoto(photo) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).add(photo);
        tx.oncomplete = resolve;
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function deletePhoto(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function photosByType(type) {
    return state.photos.filter(function (photo) {
      return photo.type === type;
    });
  }

  function previousSameType(photo) {
    return state.photos
      .filter(function (item) {
        return item.type === photo.type &&
          item.id !== photo.id &&
          new Date(item.uploadedAt).getTime() < new Date(photo.uploadedAt).getTime();
      })
      .sort(function (a, b) {
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      })[0];
  }

  function findPhoto(id) {
    return state.photos.find(function (photo) {
      return photo.id === id;
    });
  }

  function groupByDate(photos) {
    var map = {};
    photos.forEach(function (photo) {
      var key = dateKeyFromIso(photo.uploadedAt);
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(photo);
    });

    return Object.keys(map).map(function (key) {
      return {
        dateKey: key,
        title: formatDateTitle(key),
        photos: map[key]
      };
    });
  }

  function createObjectUrl(blob) {
    var url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    return url;
  }

  function revokeObjectUrls() {
    state.objectUrls.forEach(function (url) {
      URL.revokeObjectURL(url);
    });
    state.objectUrls = [];
  }

  function labelFor(type) {
    return labels[type] || type;
  }

  function shanghaiInputFromIso(iso) {
    var shifted = new Date(new Date(iso).getTime() + SHANGHAI_OFFSET_MINUTES * 60 * 1000);
    return [
      shifted.getUTCFullYear(),
      pad2(shifted.getUTCMonth() + 1),
      pad2(shifted.getUTCDate())
    ].join("-") + "T" + [
      pad2(shifted.getUTCHours()),
      pad2(shifted.getUTCMinutes())
    ].join(":");
  }

  function dateKeyFromIso(iso) {
    return shanghaiInputFromIso(iso).slice(0, 10);
  }

  function formatDateTitle(dateKey) {
    var today = dateKeyFromIso(new Date().toISOString());
    var yesterday = dateKeyFromIso(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    var dayBeforeYesterday = dateKeyFromIso(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    var label = dateKey;
    if (dateKey === today) {
      label = "今天";
    } else if (dateKey === yesterday) {
      label = "昨天";
    } else if (dateKey === dayBeforeYesterday) {
      label = "前天";
    }
    return label + dayNumberSuffix(dateKey);
  }

  function dayNumberSuffix(dateKey) {
    var dayNumber = dayNumberFromDateKey(dateKey);
    return dayNumber >= 1 ? " (第" + dayNumber + "天)" : "";
  }

  function dayNumberFromDateKey(dateKey) {
    var target = dateKeyToUtcMs(dateKey);
    var start = dateKeyToUtcMs(DAY_ONE_DATE_KEY);
    if (!Number.isFinite(target) || !Number.isFinite(start)) {
      return 0;
    }
    return Math.floor((target - start) / 86400000) + 1;
  }

  function dateKeyToUtcMs(dateKey) {
    var parts = String(dateKey || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return !Number.isFinite(part); })) {
      return NaN;
    }
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(iso));
  }

  function formatDateTime(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(iso));
  }

  function formatInterval(previousIso, currentIso) {
    var minutes = Math.max(0, Math.round((new Date(currentIso).getTime() - new Date(previousIso).getTime()) / 60000));
    return formatMinuteCount(minutes);
  }

  function gapFromNow(iso) {
    var diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
    return formatMinuteCount(Math.floor(diffMs / 60000));
  }

  function formatMinuteCount(minutes) {
    var safeMinutes = Math.max(0, Number(minutes) || 0);
    if (safeMinutes < 1) {
      return "刚刚";
    }
    var hours = Math.floor(safeMinutes / 60);
    var rest = safeMinutes % 60;
    if (!hours) {
      return rest + " 分钟";
    }
    if (!rest) {
      return hours + " 小时";
    }
    return hours + " 小时 " + rest + " 分钟";
  }

  function formatFileSize(size) {
    var bytes = Number(size) || 0;
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + " KB";
    }
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) {
        reject(new Error("Canvas export unavailable"));
        return;
      }
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas export failed"));
        }
      }, type, quality);
    });
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "photo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char];
    });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    navigator.serviceWorker.register("sw.js?v=21").catch(function () {
      showToast("离线缓存暂不可用");
    });
  }

  window.addEventListener("pagehide", function () {
    revokeObjectUrls();
    clearDialogImage();
  });
})();

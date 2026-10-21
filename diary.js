(function () {
  "use strict";

  var DB_NAME = "baby-diary";
  var STORE_NAME = "entries";
  var DAY_ONE = "2026-05-26";
  var MAX_PHOTOS = 6;
  var state = {
    db: null,
    entries: [],
    attachments: [],
    editingId: "",
    editVersion: "",
    busy: false,
    listUrls: [],
    previewUrls: [],
    dialogUrl: ""
  };
  var els = {};
  var toastTimer = 0;
  var channel = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "diaryForm", "composerFields", "composerTitle", "todayLabel", "storageError",
      "entryText", "entryTime", "entryFirst", "diaryNow", "chooseImages",
      "takePhoto", "entryPhotos", "cameraPhoto", "attachmentCount",
      "attachmentPreview", "saveEntry", "cancelEntryEdit", "diaryTab",
      "firstsTab", "diaryCount", "firstsCount", "diaryDateFilter",
      "clearDiaryFilter", "diaryPanel", "firstsPanel", "diaryList", "firstsList",
      "exportDiary", "importDiaryButton", "importDiary", "diaryPhotoDialog",
      "diaryPhotoImage", "closeDiaryPhoto", "toast"
    ].forEach(function (id) { els[id] = document.getElementById(id); });

    els.entryTime.value = shanghaiInput(new Date());
    updateTodayLabel();
    bindEvents();
    selectTab();
    registerServiceWorker();
    try {
      state.db = await openDb();
      await reloadEntries();
      updateControls();
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel("baby-diary:changes");
        channel.onmessage = refreshFromStorage;
      }
    } catch (error) {
      els.storageError.textContent = "日记存储暂不可用，请检查浏览器是否允许保存网站数据后刷新。";
      els.storageError.hidden = false;
      els.diaryList.innerHTML = '<p class="empty-state">暂时无法读取日记</p>';
      els.firstsList.innerHTML = '<p class="empty-state">暂时无法读取第一次</p>';
    }
  }

  function bindEvents() {
    els.diaryForm.addEventListener("submit", saveEntry);
    els.diaryNow.addEventListener("click", function () {
      els.entryTime.value = shanghaiInput(new Date());
      updateTodayLabel();
    });
    els.chooseImages.addEventListener("click", function () { els.entryPhotos.click(); });
    els.takePhoto.addEventListener("click", function () { els.cameraPhoto.click(); });
    [els.entryPhotos, els.cameraPhoto].forEach(function (input) {
      input.addEventListener("change", function () { attachImages(input); });
    });
    els.attachmentPreview.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-remove]");
      if (!button || state.busy) { return; }
      state.attachments.splice(Number(button.dataset.remove), 1);
      renderAttachments();
    });
    els.cancelEntryEdit.addEventListener("click", resetComposer);
    els.diaryTab.addEventListener("click", function () { changeTab("diary"); });
    els.firstsTab.addEventListener("click", function () { changeTab("firsts"); });
    [els.diaryTab, els.firstsTab].forEach(function (tab) {
      tab.addEventListener("keydown", function (event) {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) { return; }
        event.preventDefault();
        var firsts = event.key === "End" ||
          (event.key !== "Home" && tab === els.diaryTab);
        changeTab(firsts ? "firsts" : "diary");
        (firsts ? els.firstsTab : els.diaryTab).focus();
      });
    });
    window.addEventListener("hashchange", selectTab);
    els.diaryDateFilter.addEventListener("change", render);
    els.clearDiaryFilter.addEventListener("click", function () {
      els.diaryDateFilter.value = "";
      render();
    });
    [els.diaryList, els.firstsList].forEach(function (list) {
      list.addEventListener("click", handleEntryAction);
    });
    els.closeDiaryPhoto.addEventListener("click", function () { els.diaryPhotoDialog.close(); });
    els.diaryPhotoDialog.addEventListener("close", clearDialogPhoto);
    els.exportDiary.addEventListener("click", exportBackup);
    els.importDiaryButton.addEventListener("click", function () { els.importDiary.click(); });
    els.importDiary.addEventListener("change", importBackup);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        updateTodayLabel();
        refreshFromStorage();
      }
    });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) {
        renderAttachments();
        render();
      }
    });
    window.addEventListener("pagehide", function () {
      revokeUrls(state.listUrls);
      revokeUrls(state.previewUrls);
      clearDialogPhoto();
    });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("time", "time", { unique: false });
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          db.close();
          state.db = null;
          updateControls();
          showToast("日记存储已更新，请刷新页面");
        };
        resolve(db);
      };
      request.onerror = function () { reject(request.error); };
      request.onblocked = function () { reject(new Error("Database blocked")); };
    });
  }

  // Resolve only when the transaction commits, including every image Blob.
  function transaction(mode, operation) {
    return new Promise(function (resolve, reject) {
      var tx = state.db.transaction(STORE_NAME, mode);
      var result;
      var failure;
      tx.oncomplete = function () { resolve(result); };
      tx.onabort = tx.onerror = function () { reject(failure || tx.error || new Error("Storage failed")); };
      try {
        operation(tx.objectStore(STORE_NAME), function (value) { result = value; }, function (error) {
          failure = error;
          tx.abort();
        });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }

  async function reloadEntries() {
    var entries = await transaction("readonly", function (store, done) {
      var request = store.getAll();
      request.onsuccess = function () { done(request.result); };
    });
    state.entries = entries.sort(function (a, b) {
      return new Date(b.time) - new Date(a.time) ||
        new Date(b.createdAt) - new Date(a.createdAt) || a.id.localeCompare(b.id);
    });
    render();
  }

  function mutateEntry(id, update) {
    return transaction("readwrite", function (store, done, fail) {
      var request = store.get(id);
      request.onsuccess = function () {
        try {
          if (!request.result) { throw new Error("这条日记已被删除，请刷新列表"); }
          var entry = update(request.result);
          if (entry) { store.put(entry); } else { store.delete(id); }
          done(entry);
        } catch (error) { fail(error); }
      };
    });
  }

  async function saveEntry(event) {
    event.preventDefault();
    if (state.busy || !state.db) { return; }
    var text = els.entryText.value.trim();
    var time = new Date(els.entryTime.value + ":00+08:00");
    if (!text) { showToast("请先写下日记内容"); els.entryText.focus(); return; }
    if (!Number.isFinite(time.getTime())) { showToast("请选择有效时间"); return; }

    var wasEditing = Boolean(state.editingId);
    var now = new Date().toISOString();
    var entry = {
      id: state.editingId || createId(),
      time: time.toISOString(),
      text: text,
      isFirst: els.entryFirst.checked,
      photos: state.attachments.slice(),
      createdAt: now,
      updatedAt: now
    };
    setBusy(true);
    var saved = false;
    try {
      if (wasEditing) {
        await mutateEntry(entry.id, function (previous) {
          if (previous.updatedAt !== state.editVersion) {
            throw new Error("日记已在其他页面更新，请重新打开编辑");
          }
          entry.createdAt = previous.createdAt;
          return entry;
        });
      } else {
        await transaction("readwrite", function (store) { store.add(entry); });
      }
      saved = true;
      resetComposer();
      els.diaryDateFilter.value = "";
      await reloadEntries();
      notifyChanges();
      showToast(wasEditing ? "日记已更新" : "日记已添加");
    } catch (error) {
      showToast(saved ? "已保存，请刷新列表查看" :
        (error.message.indexOf("日记") >= 0 ? error.message : "保存失败，请检查可用空间后重试"));
    } finally {
      setBusy(false);
    }
  }

  async function attachImages(input) {
    var files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || state.busy) { return; }
    if (state.attachments.length + files.length > MAX_PHOTOS) {
      showToast("每条日记最多添加 " + MAX_PHOTOS + " 张图片");
      return;
    }
    setBusy(true);
    try {
      var photos = [];
      for (var file of files) {
        if (file.type.indexOf("image/") !== 0) { throw new Error("请选择图片文件"); }
        photos.push(await prepareImage(file));
      }
      state.attachments = state.attachments.concat(photos);
      renderAttachments();
    } catch (error) {
      showToast("图片无法读取，请尝试 JPG、PNG 或 WebP 图片");
    } finally {
      setBusy(false);
    }
  }

  async function prepareImage(file) {
    var url = URL.createObjectURL(file);
    try {
      var image = await new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
      var scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      var context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (result) {
          if (result) { resolve(result); } else { reject(new Error("Image encoding failed")); }
        }, "image/jpeg", 0.84);
      });
      return { blob: blob, mimeType: blob.type, width: canvas.width, height: canvas.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function renderAttachments() {
    revokeUrls(state.previewUrls);
    els.attachmentPreview.innerHTML = state.attachments.map(function (photo, index) {
      var url = imageUrl(photo.blob, state.previewUrls);
      return '<div class="diary-attachment"><img src="' + escapeHtml(url) + '" alt="待保存附图">' +
        '<button class="diary-remove-photo" type="button" data-remove="' + index +
        '" aria-label="移除第' + (index + 1) + '张图片" title="移除图片">×</button></div>';
    }).join("");
    els.attachmentCount.textContent = state.attachments.length ? state.attachments.length + " 张图片" : "";
  }

  function resetComposer() {
    state.editingId = "";
    state.editVersion = "";
    state.attachments = [];
    els.diaryForm.reset();
    els.entryTime.value = shanghaiInput(new Date());
    els.composerTitle.textContent = "记一件小事";
    els.saveEntry.textContent = "添加日记";
    els.cancelEntryEdit.hidden = true;
    renderAttachments();
    updateTodayLabel();
  }

  function render() {
    revokeUrls(state.listUrls);
    var date = els.diaryDateFilter.value;
    var entries = state.entries.filter(function (entry) { return !date || dateKey(entry.time) === date; });
    var firsts = entries.filter(function (entry) { return entry.isFirst; });
    els.diaryCount.textContent = String(entries.length);
    els.firstsCount.textContent = String(firsts.length);
    els.clearDiaryFilter.hidden = !date;
    els.diaryList.innerHTML = renderGroups(entries, date ? "这一天还没有日记" : "还没有日记，写下宝宝今天的一件小事吧");
    els.firstsList.innerHTML = renderGroups(firsts, date ? "这一天还没有第一次" : "还没有记录第一次");
    updateControls();
  }

  function renderGroups(entries, emptyText) {
    if (!entries.length) { return '<p class="empty-state">' + emptyText + "</p>"; }
    var groups = new Map();
    entries.forEach(function (entry) {
      var key = dateKey(entry.time);
      if (!groups.has(key)) { groups.set(key, []); }
      groups.get(key).push(entry);
    });
    return Array.from(groups).map(function (group) {
      return '<section class="diary-day"><div class="diary-day-heading"><h3>' +
        escapeHtml(dateTitle(group[0])) + '</h3><span class="diary-subtle">' +
        escapeHtml(group[0]) + " · " + group[1].length + " 条</span></div>" +
        group[1].map(renderEntry).join("") + "</section>";
    }).join("");
  }

  function renderEntry(entry) {
    var id = escapeHtml(entry.id);
    var photos = (entry.photos || []).map(function (photo, index) {
      var url = imageUrl(photo.blob, state.listUrls);
      return '<button type="button" data-action="photo" data-id="' + id +
        '" data-photo="' + index + '" aria-label="查看第' + (index + 1) + '张附图" title="查看图片">' +
        '<img src="' + escapeHtml(url) + '" alt="日记附图" loading="lazy"></button>';
    }).join("");
    return '<article class="diary-entry" data-entry-id="' + id + '">' +
      '<div class="diary-entry-header"><time datetime="' + escapeHtml(entry.time) + '">' +
      shanghaiInput(new Date(entry.time)).slice(11, 16) + "</time>" +
      (entry.isFirst ? '<span class="diary-first-badge">第一次</span>' : "") + "</div>" +
      '<p class="diary-entry-text">' + escapeHtml(entry.text) + "</p>" +
      (photos ? '<div class="diary-entry-photos">' + photos + "</div>" : "") +
      '<div class="diary-entry-actions">' +
      '<button type="button" data-action="first" data-id="' + id + '">' +
      (entry.isFirst ? "取消第一次" : "标记第一次") + "</button>" +
      '<button type="button" data-action="edit" data-id="' + id + '">编辑</button>' +
      '<button type="button" data-action="delete" data-id="' + id + '">删除</button>' +
      "</div></article>";
  }

  async function handleEntryAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button || state.busy || !state.db) { return; }
    var entry = state.entries.find(function (item) { return item.id === button.dataset.id; });
    if (!entry) { return; }
    var action = button.dataset.action;
    if (action === "photo") { openPhoto(entry, Number(button.dataset.photo)); return; }
    if (action === "edit") {
      state.editingId = entry.id;
      state.editVersion = entry.updatedAt;
      state.attachments = (entry.photos || []).slice();
      els.entryText.value = entry.text;
      els.entryTime.value = shanghaiInput(new Date(entry.time));
      els.entryFirst.checked = entry.isFirst;
      els.composerTitle.textContent = "编辑日记";
      els.saveEntry.textContent = "保存修改";
      els.cancelEntryEdit.hidden = false;
      renderAttachments();
      els.diaryForm.scrollIntoView({ behavior: "smooth", block: "start" });
      els.entryText.focus({ preventScroll: true });
      return;
    }
    if (action === "delete" && !window.confirm("删除这条日记及其附图？第一次板块也会同步移除。")) { return; }
    setBusy(true);
    try {
      var updated = await mutateEntry(entry.id, function (current) {
        if (action === "delete") { return null; }
        current.isFirst = !current.isFirst;
        current.updatedAt = new Date().toISOString();
        return current;
      });
      if (state.editingId === entry.id) {
        if (!updated) { resetComposer(); } else {
          state.editVersion = updated.updatedAt;
          els.entryFirst.checked = updated.isFirst;
        }
      }
      await reloadEntries();
      notifyChanges();
      showToast(action === "delete" ? "日记已删除" : (updated.isFirst ? "已加入第一次" : "已取消第一次"));
    } catch (error) {
      showToast("操作失败，请刷新列表后重试");
    } finally { setBusy(false); }
  }

  function changeTab(name) {
    history.replaceState(null, "", name === "firsts" ? "#firsts" : location.pathname + location.search);
    selectTab();
  }

  function selectTab() {
    var firsts = location.hash === "#firsts";
    els.diaryPanel.hidden = firsts;
    els.firstsPanel.hidden = !firsts;
    els.diaryTab.setAttribute("aria-selected", String(!firsts));
    els.firstsTab.setAttribute("aria-selected", String(firsts));
    els.diaryTab.tabIndex = firsts ? -1 : 0;
    els.firstsTab.tabIndex = firsts ? 0 : -1;
  }

  function openPhoto(entry, index) {
    var photo = (entry.photos || [])[index];
    if (!photo) { return; }
    clearDialogPhoto();
    state.dialogUrl = URL.createObjectURL(photo.blob);
    els.diaryPhotoImage.src = state.dialogUrl;
    els.diaryPhotoDialog.showModal();
  }

  function clearDialogPhoto() {
    if (state.dialogUrl) { URL.revokeObjectURL(state.dialogUrl); state.dialogUrl = ""; }
    els.diaryPhotoImage.removeAttribute("src");
  }

  async function exportBackup() {
    if (state.busy || !state.db) { return; }
    setBusy(true);
    try {
      await reloadEntries();
      if (!state.entries.length) { showToast("暂无日记可导出"); return; }
      var entries = [];
      for (var entry of state.entries) {
        var photos = [];
        for (var photo of entry.photos || []) {
          photos.push({
            dataUrl: await blobDataUrl(photo.blob),
            mimeType: photo.mimeType,
            width: photo.width,
            height: photo.height
          });
        }
        entries.push(Object.assign({}, entry, { photos: photos }));
      }
      var backup = { app: "baby-diary", schemaVersion: 1, exportedAt: new Date().toISOString(), entries: entries };
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }),
        "宝宝日记备份-" + dateKey(new Date()) + ".json");
      showToast("日记备份已导出");
    } catch (error) { showToast("备份导出失败，请重试"); }
    finally { setBusy(false); }
  }

  async function importBackup() {
    var file = els.importDiary.files && els.importDiary.files[0];
    els.importDiary.value = "";
    if (!file || state.busy || !state.db) { return; }
    setBusy(true);
    try {
      var backup = JSON.parse(await file.text());
      if (backup.app !== "baby-diary" || backup.schemaVersion !== 1 || !Array.isArray(backup.entries)) {
        throw new Error("Invalid diary backup");
      }
      var ids = new Set();
      var entries = backup.entries.map(function (item) {
        if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
            typeof item.text !== "string" || !item.text.trim() || item.text.length > 10000 ||
            typeof item.isFirst !== "boolean" || !validIso(item.time) ||
            !validIso(item.createdAt) || !validIso(item.updatedAt) ||
            !Array.isArray(item.photos) || item.photos.length > MAX_PHOTOS) {
          throw new Error("Invalid diary entry");
        }
        ids.add(item.id);
        return {
          id: item.id, text: item.text.trim(), isFirst: item.isFirst,
          time: new Date(item.time).toISOString(),
          createdAt: new Date(item.createdAt).toISOString(),
          updatedAt: new Date(item.updatedAt).toISOString(),
          photos: item.photos.map(function (photo) {
            var match = photo && typeof photo.dataUrl === "string" &&
              photo.dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
            if (!match) { throw new Error("Invalid diary image"); }
            var bytes = Uint8Array.from(atob(match[2]), function (char) { return char.charCodeAt(0); });
            return {
              blob: new Blob([bytes], { type: match[1] }),
              mimeType: match[1], width: Number(photo.width) || 0, height: Number(photo.height) || 0
            };
          })
        };
      });
      var counts = { added: 0, updated: 0, skipped: 0 };
      await transaction("readwrite", function (store) {
        entries.forEach(function (entry) {
          var request = store.get(entry.id);
          request.onsuccess = function () {
            var existing = request.result;
            if (!existing) { store.add(entry); counts.added += 1; }
            else if (new Date(entry.updatedAt) > new Date(existing.updatedAt)) {
              store.put(entry); counts.updated += 1;
            } else { counts.skipped += 1; }
          };
        });
      });
      await reloadEntries();
      notifyChanges();
      showToast("已合并：新增 " + counts.added + "，更新 " + counts.updated + "，跳过 " + counts.skipped);
    } catch (error) { showToast("导入失败，请选择有效的日记备份并检查可用空间"); }
    finally { setBusy(false); }
  }

  function validIso(value) {
    return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(new Date(value).getTime());
  }

  function blobDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function setBusy(busy) {
    state.busy = busy;
    updateControls();
  }

  function updateControls() {
    var disabled = !state.db || state.busy;
    els.composerFields.disabled = disabled;
    els.exportDiary.disabled = disabled;
    els.importDiaryButton.disabled = disabled;
    document.querySelectorAll(".diary-entry button").forEach(function (button) {
      button.disabled = disabled;
    });
  }

  function refreshFromStorage() {
    if (!state.db || state.busy) { return; }
    reloadEntries().catch(function () { showToast("日记读取失败，请刷新页面"); });
  }

  function notifyChanges() {
    if (channel) { channel.postMessage("changed"); }
  }

  function imageUrl(blob, urls) {
    var url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }

  function revokeUrls(urls) {
    urls.forEach(function (url) { URL.revokeObjectURL(url); });
    urls.length = 0;
  }

  function shanghaiInput(value) {
    return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);
  }

  function dateKey(value) { return shanghaiInput(value).slice(0, 10); }

  function dateTitle(key) {
    var today = dateKey(new Date());
    var daysAgo = Math.round((Date.parse(today) - Date.parse(key)) / 86400000);
    var label = daysAgo === 0 ? "今天" : daysAgo === 1 ? "昨天" : daysAgo === 2 ? "前天" : key;
    var age = Math.round((Date.parse(key) - Date.parse(DAY_ONE)) / 86400000) + 1;
    return label + (age > 0 ? " (第" + age + "天)" : "");
  }

  function updateTodayLabel() { els.todayLabel.textContent = dateTitle(dateKey(new Date())); }

  function createId() {
    return window.crypto && typeof window.crypto.randomUUID === "function" ?
      window.crypto.randomUUID() : "diary-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 3000);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js?v=38").catch(function () {
        showToast("离线缓存暂不可用");
      });
    }
  }
})();

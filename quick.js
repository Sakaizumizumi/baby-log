(function () {
  "use strict";

  var STORAGE_KEY = "baby-log:v1:records";
  var SHANGHAI_OFFSET_MINUTES = 8 * 60;
  var toastTimer = 0;

  var labels = {
    feedMethod: {
      breast: "母乳",
      bottle: "奶瓶",
      formula: "配方奶",
      pumped: "瓶喂母乳",
      other: "其他"
    },
    diaperKind: {
      pee: "小便",
      poop: "大便",
      mixed: "尿+便"
    }
  };

  var quickRecords = {
    "breast-10min": {
      label: "母乳 10分",
      record: function (timeIso) {
        return {
          type: "feed",
          feed: {
            method: "breast",
            durationMin: 10,
            status: "done",
            endedAt: addMinutes(timeIso, 10)
          }
        };
      }
    },
    "pumped-10": {
      label: "瓶喂母乳 10ml",
      record: function () {
        return {
          type: "feed",
          feed: {
            method: "pumped",
            amountMl: 10
          }
        };
      }
    },
    "pumped-30": {
      label: "瓶喂母乳 30ml",
      record: function () {
        return {
          type: "feed",
          feed: {
            method: "pumped",
            amountMl: 30
          }
        };
      }
    },
    "formula-30": {
      label: "配方奶 30ml",
      record: function () {
        return {
          type: "feed",
          feed: {
            method: "formula",
            amountMl: 30
          }
        };
      }
    },
    "formula-50": {
      label: "配方奶 50ml",
      record: function () {
        return {
          type: "feed",
          feed: {
            method: "formula",
            amountMl: 50
          }
        };
      }
    },
    "formula-80": {
      label: "配方奶 80ml",
      record: function () {
        return {
          type: "feed",
          feed: {
            method: "formula",
            amountMl: 80
          }
        };
      }
    },
    "pee-plus": {
      label: "小便 +",
      record: function () {
        return {
          type: "diaper",
          diaper: {
            kind: "pee",
            amount: "+"
          }
        };
      }
    },
    "pee-plus-plus": {
      label: "小便 ++",
      record: function () {
        return {
          type: "diaper",
          diaper: {
            kind: "pee",
            amount: "++"
          }
        };
      }
    },
    "pee-plus-plus-plus": {
      label: "小便 +++",
      record: function () {
        return {
          type: "diaper",
          diaper: {
            kind: "pee",
            amount: "+++"
          }
        };
      }
    },
    "poop-yellow-paste": {
      label: "黄色糊状+++",
      record: function () {
        return {
          type: "diaper",
          diaper: {
            kind: "poop",
            amount: "+++",
            poopColor: "yellow",
            poopTexture: "paste"
          }
        };
      }
    },
    "poop-yellow-watery": {
      label: "黄色水样+++",
      record: function () {
        return {
          type: "diaper",
          diaper: {
            kind: "poop",
            amount: "+++",
            poopColor: "yellow",
            poopTexture: "watery"
          }
        };
      }
    },
    "mixed-poop": {
      label: "尿带屎",
      record: function () {
        return {
          type: "diaper",
          note: "尿带屎",
          diaper: {
            kind: "mixed"
          }
        };
      }
    }
  };

  var state = {
    records: []
  };
  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    state.records = loadRecords();
    els.recordTime.value = nowShanghaiLocalInput();
    bindEvents();
    render();
    registerServiceWorker();
  }

  function cacheElements() {
    els.recordTime = byId("recordTime");
    els.nowButton = byId("nowButton");
    els.undoLastRecord = byId("undoLastRecord");
    els.lastFeed = byId("lastFeed");
    els.lastFeedGap = byId("lastFeedGap");
    els.lastPee = byId("lastPee");
    els.lastPeeGap = byId("lastPeeGap");
    els.lastPoop = byId("lastPoop");
    els.lastPoopGap = byId("lastPoopGap");
    els.todayMilk = byId("todayMilk");
    els.todayCounts = byId("todayCounts");
    els.quickTimeHint = byId("quickTimeHint");
    els.toast = byId("toast");
  }

  function bindEvents() {
    document.querySelectorAll("[data-quick]").forEach(function (button) {
      button.addEventListener("click", function () {
        addQuickRecord(button.dataset.quick);
      });
    });
    els.nowButton.addEventListener("click", function () {
      els.recordTime.value = nowShanghaiLocalInput();
      render();
    });
    els.recordTime.addEventListener("change", render);
    els.undoLastRecord.addEventListener("click", undoLastRecord);
  }

  function addQuickRecord(key) {
    var config = quickRecords[key];
    if (!config) {
      showToast("没有找到这个快捷记录");
      return;
    }

    var timeIso = isoFromShanghaiInput(els.recordTime.value);
    if (!timeIso) {
      showToast("请先填写时间");
      els.recordTime.focus();
      return;
    }

    var nowIso = new Date().toISOString();
    var draft = config.record(timeIso);
    var record = cleanRecord(Object.assign({
      id: createId(),
      time: timeIso,
      note: "",
      createdAt: nowIso,
      updatedAt: nowIso
    }, draft));

    state.records.push(record);
    saveRecords();
    els.recordTime.value = nowShanghaiLocalInput();
    render();
    showToast("已记录 " + config.label);
  }

  function undoLastRecord() {
    if (!state.records.length) {
      showToast("暂无可撤回的记录");
      return;
    }

    var latest = state.records.reduce(function (winner, record) {
      if (!winner) {
        return record;
      }
      return recordTimestamp(record) >= recordTimestamp(winner) ? record : winner;
    }, null);
    state.records = state.records.filter(function (record) {
      return record.id !== latest.id;
    });
    saveRecords();
    render();
    showToast("已撤回 " + recordLabel(latest));
  }

  function render() {
    renderSummary();
    if (els.quickTimeHint) {
      var timeIso = isoFromShanghaiInput(els.recordTime.value);
      els.quickTimeHint.textContent = timeIso ?
        "点击即记录所选时间 · " + formatTime(timeIso) :
        "请先选择记录时间";
    }
  }

  function renderSummary() {
    var today = dateKeyFromIso(new Date().toISOString());
    var todayRecords = state.records.filter(function (record) {
      return dateKeyFromIso(record.time) === today;
    });
    var todayFeeds = todayRecords.filter(isFeed);
    var todayFeedSessions = buildFeedSessions(state.records.filter(isFeed)).filter(function (session) {
      return dateKeyFromIso(session.time) === today;
    });
    var todayDiapers = todayRecords.filter(isDiaper);
    var milkMl = todayFeeds.reduce(function (sum, record) {
      return sum + (Number(record.feed && record.feed.amountMl) || 0);
    }, 0);

    fillLast(getLatest(state.records.filter(isFeed)), els.lastFeed, els.lastFeedGap);
    fillLast(getLatest(state.records.filter(function (record) {
      return hasDiaperKind(record, "pee") || hasDiaperKind(record, "mixed");
    })), els.lastPee, els.lastPeeGap);
    fillLast(getLatest(state.records.filter(function (record) {
      return hasDiaperKind(record, "poop") || hasDiaperKind(record, "mixed");
    })), els.lastPoop, els.lastPoopGap);

    els.todayMilk.textContent = formatAmount(milkMl);
    els.todayCounts.textContent = todayFeedSessions.length + " 次喂奶 · " + todayDiapers.length + " 次尿便";
  }

  function fillLast(record, valueEl, gapEl) {
    if (!record) {
      valueEl.textContent = "--";
      gapEl.textContent = "--";
      return;
    }

    valueEl.textContent = formatTime(record.time);
    gapEl.textContent = "间隔 " + gapFromNow(record.time);
  }

  function buildFeedSessions(feedRecords) {
    return feedRecords.slice()
      .sort(compareByTime)
      .reduce(function (sessions, record) {
        var latestSession = sessions[sessions.length - 1];
        if (!latestSession || intervalMinutes(latestSession.lastTime, record.time) >= 60) {
          sessions.push({
            records: [record],
            time: record.time,
            lastTime: record.time
          });
          return sessions;
        }

        latestSession.records.push(record);
        latestSession.lastTime = record.time;
        return sessions;
      }, []);
  }

  function cleanRecord(record) {
    delete record.caregiver;
    record.note = record.note || "";

    if (record.type === "feed") {
      record.feed = pruneEmpty(record.feed || {});
      record.feed.method = normalizeFeedMethod(record.feed.method);
      if (record.feed.method !== "breast") {
        delete record.feed.side;
        delete record.feed.status;
        delete record.feed.endedAt;
        delete record.feed.durationMin;
      }
      if (record.feed.method === "breast") {
        delete record.feed.amountMl;
        record.feed.status = record.feed.status === "active" ? "active" : "done";
        if (record.feed.status === "active") {
          delete record.feed.endedAt;
          delete record.feed.durationMin;
        }
      }
      delete record.diaper;
    } else {
      record.diaper = pruneEmpty(record.diaper || {});
      if (!record.diaper.kind) {
        record.diaper.kind = "pee";
      }
      delete record.feed;
    }

    return record;
  }

  function pruneEmpty(input) {
    var output = {};
    Object.keys(input || {}).forEach(function (key) {
      var value = input[key];
      if (value === "" || value === null || typeof value === "undefined") {
        return;
      }
      output[key] = value;
    });
    return output;
  }

  function loadRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(cleanRecord).filter(function (record) {
        return record.id && record.type && record.time;
      });
    } catch (error) {
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  }

  function recordTimestamp(record) {
    var source = record && (record.updatedAt || record.createdAt || record.time);
    var timestamp = new Date(source).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function normalizeFeedMethod(method) {
    if (method === "breast" || method === "bottle" || method === "formula" || method === "pumped" || method === "other") {
      return method;
    }
    return "other";
  }

  function isFeed(record) {
    return record.type === "feed";
  }

  function isDiaper(record) {
    return record.type === "diaper";
  }

  function hasDiaperKind(record, kind) {
    return isDiaper(record) && record.diaper && record.diaper.kind === kind;
  }

  function getLatest(records) {
    return records.slice().sort(function (a, b) {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    })[0];
  }

  function recordLabel(record) {
    if (record.type === "feed") {
      return labels.feedMethod[normalizeFeedMethod(record.feed && record.feed.method)] || "喂奶";
    }
    return labels.diaperKind[record.diaper && record.diaper.kind] || "尿便";
  }

  function compareByTime(a, b) {
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function dateKeyFromIso(iso) {
    return shanghaiInputFromIso(iso).slice(0, 10);
  }

  function nowShanghaiLocalInput() {
    return shanghaiInputFromIso(new Date().toISOString());
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

  function isoFromShanghaiInput(value) {
    if (!value) {
      return "";
    }
    var match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
      return "";
    }
    var utcMs = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5])
    ) - SHANGHAI_OFFSET_MINUTES * 60 * 1000;
    return new Date(utcMs).toISOString();
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(iso));
  }

  function formatAmount(value) {
    var number = Number(value) || 0;
    return number + " ml";
  }

  function gapFromNow(iso) {
    var minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return formatMinuteCount(minutes);
  }

  function intervalMinutes(previousIso, currentIso) {
    return Math.max(0, Math.round((new Date(currentIso).getTime() - new Date(previousIso).getTime()) / 60000));
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

  function addMinutes(iso, minutes) {
    return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("show");
    }, 1800);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    navigator.serviceWorker.register("sw.js?v=32").catch(function () {
      // The app still works without offline caching.
    });
  }
})();

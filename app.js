(function () {
  "use strict";

  var STORAGE_KEY = "baby-log:v1:records";
  var SCHEMA_VERSION = 1;
  var DAY_ONE_DATE_KEY = "2026-05-26";
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
    side: {
      left: "左侧",
      right: "右侧",
      both: "两侧",
      none: "不适用"
    },
    diaperKind: {
      pee: "小便",
      poop: "大便",
      mixed: "尿+便"
    },
    diaperAmount: {
      "+": "+",
      "++": "++",
      "+++": "+++"
    },
    poopColor: {
      yellow: "黄色",
      green: "绿色",
      brown: "棕色",
      black: "黑色",
      red: "红色",
      white: "白色",
      other: "其他"
    },
    poopTexture: {
      loose: "稀",
      paste: "糊状",
      formed: "成形",
      watery: "水样",
      seedy: "颗粒",
      other: "其他"
    }
  };

  var state = {
    records: [],
    selectedAction: ""
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
    els.breastMode = byId("breastMode");
    els.otherFeedMethod = byId("otherFeedMethod");
    els.amountMl = byId("amountMl");
    els.feedSide = byId("feedSide");
    els.durationMin = byId("durationMin");
    els.diaperAmount = byId("diaperAmount");
    els.poopColor = byId("poopColor");
    els.poopTexture = byId("poopTexture");
    els.note = byId("note");
    els.recordDetails = byId("recordDetails");
    els.selectedRecordTitle = byId("selectedRecordTitle");
    els.feedDetailGroup = byId("feedDetailGroup");
    els.diaperDetailGroup = byId("diaperDetailGroup");
    els.saveRecord = byId("saveRecord");
    els.clearRecordSelection = byId("clearRecordSelection");
    els.nowButton = byId("nowButton");
    els.historyFilter = byId("historyFilter");
    els.historyList = byId("historyList");
    els.exportRecentSummaryImage = byId("exportRecentSummaryImage");
    els.recentDailySummaryList = byId("recentDailySummaryList");
    els.dailySummaryList = byId("dailySummaryList");
    els.lastFeed = byId("lastFeed");
    els.lastFeedGap = byId("lastFeedGap");
    els.lastPee = byId("lastPee");
    els.lastPeeGap = byId("lastPeeGap");
    els.lastPoop = byId("lastPoop");
    els.lastPoopGap = byId("lastPoopGap");
    els.todayMilk = byId("todayMilk");
    els.todayCounts = byId("todayCounts");
    els.exportCsv = byId("exportCsv");
    els.exportJson = byId("exportJson");
    els.importJson = byId("importJson");
    els.toast = byId("toast");
    els.editDialog = byId("editDialog");
    els.editForm = byId("editForm");
    els.editId = byId("editId");
    els.editType = byId("editType");
    els.editTime = byId("editTime");
    els.editFeedFields = byId("editFeedFields");
    els.editDiaperFields = byId("editDiaperFields");
    els.editOtherFeedMethod = byId("editOtherFeedMethod");
    els.editAmountMl = byId("editAmountMl");
    els.editFeedSide = byId("editFeedSide");
    els.editDurationMin = byId("editDurationMin");
    els.editDiaperAmount = byId("editDiaperAmount");
    els.editPoopColor = byId("editPoopColor");
    els.editPoopTexture = byId("editPoopTexture");
    els.editNote = byId("editNote");
    els.closeEdit = byId("closeEdit");
    els.cancelEdit = byId("cancelEdit");
  }

  function bindEvents() {
    document.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectRecordAction(button.dataset.action);
      });
    });

    els.saveRecord.addEventListener("click", function () {
      addRecord(state.selectedAction);
    });
    els.clearRecordSelection.addEventListener("click", clearRecordSelection);
    els.breastMode.addEventListener("change", updateRecordSelection);

    els.nowButton.addEventListener("click", function () {
      els.recordTime.value = nowShanghaiLocalInput();
    });

    els.historyFilter.addEventListener("change", renderHistory);
    els.exportRecentSummaryImage.addEventListener("click", exportRecentSummaryImage);
    els.exportCsv.addEventListener("click", exportCsv);
    els.exportJson.addEventListener("click", exportJson);
    els.importJson.addEventListener("change", importJson);

    els.historyList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-id]");
      if (!button) {
        return;
      }

      if (button.dataset.intent === "edit") {
        openEdit(button.dataset.id);
      }

      if (button.dataset.intent === "finish-feed") {
        finishBreastfeed(button.dataset.id);
      }

      if (button.dataset.intent === "delete") {
        deleteRecord(button.dataset.id);
      }
    });

    els.dailySummaryList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-summary-date]");
      if (button) {
        exportDailySummaryImage(button.dataset.summaryDate);
      }
    });

    els.editType.addEventListener("change", updateEditVisibility);
    els.editForm.addEventListener("submit", saveEdit);
    els.closeEdit.addEventListener("click", closeEdit);
    els.cancelEdit.addEventListener("click", closeEdit);
  }

  function addRecord(action) {
    if (!action) {
      showToast("请选择记录类型");
      return;
    }

    var timeIso = isoFromShanghaiInput(els.recordTime.value);
    if (!timeIso) {
      showToast("请先填写时间");
      els.recordTime.focus();
      return;
    }

    var nowIso = new Date().toISOString();
    var record = {
      id: createId(),
      type: isFeedAction(action) ? "feed" : "diaper",
      time: timeIso,
      note: els.note.value.trim(),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (record.type === "feed") {
      record.feed = readFeedFields("", action === "breast" ? "breast" : valueOf("otherFeedMethod") || "other");
      if (record.feed.method === "breast") {
        if (els.breastMode.value === "manual") {
          if (!record.feed.durationMin || record.feed.durationMin <= 0) {
            showToast("请填写母乳持续分钟");
            els.durationMin.focus();
            return;
          }
          record.feed.status = "done";
          record.feed.endedAt = new Date(new Date(timeIso).getTime() + record.feed.durationMin * 60000).toISOString();
        } else {
          record.feed.status = "active";
          delete record.feed.durationMin;
          delete record.feed.endedAt;
        }
      }
    } else {
      record.diaper = readDiaperFields("", action);
    }

    state.records.push(cleanRecord(record));
    saveRecords();
    resetEntryFields();
    render();
    showToast(record.feed && record.feed.status === "active" ? "已开始母乳" : "已记录" + recordLabel(record));
  }

  function selectRecordAction(action) {
    state.selectedAction = action;
    updateRecordSelection();
  }

  function clearRecordSelection() {
    state.selectedAction = "";
    updateRecordSelection();
  }

  function updateRecordSelection() {
    var action = state.selectedAction;
    var hasAction = Boolean(action);
    els.recordDetails.hidden = !hasAction;
    els.feedDetailGroup.hidden = !isFeedAction(action);
    els.diaperDetailGroup.hidden = !hasAction || isFeedAction(action);
    els.selectedRecordTitle.textContent = hasAction ? recordActionTitle(action) + "详情" : "详情";
    els.saveRecord.textContent = action === "breast" && els.breastMode.value === "timer" ? "开始母乳" : "保存记录";
    document.querySelectorAll("[data-feed-breast]").forEach(function (field) {
      field.hidden = action !== "breast";
    });
    document.querySelectorAll("[data-breast-manual]").forEach(function (field) {
      field.hidden = action !== "breast" || els.breastMode.value !== "manual";
    });
    document.querySelectorAll("[data-feed-other]").forEach(function (field) {
      field.hidden = action !== "otherFeed";
    });
    document.querySelectorAll("[data-poop-extra]").forEach(function (field) {
      field.hidden = action !== "poop" && action !== "mixed";
    });

    document.querySelectorAll("[data-action]").forEach(function (button) {
      var isSelected = button.dataset.action === action;
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function readFeedFields(prefix, method) {
    var normalizedMethod = normalizeFeedMethod(method);
    var amount = readNumber(fieldId(prefix, "amountMl"));
    var duration = readNumber(fieldId(prefix, "durationMin"));
    return pruneEmpty({
      method: normalizedMethod,
      amountMl: normalizedMethod === "breast" ? undefined : amount,
      side: normalizedMethod === "breast" ? valueOf(fieldId(prefix, "feedSide")) : undefined,
      durationMin: normalizedMethod === "breast" ? duration : undefined
    });
  }

  function readDiaperFields(prefix, kind) {
    return pruneEmpty({
      kind: kind,
      amount: valueOf(fieldId(prefix, "diaperAmount")),
      poopColor: valueOf(fieldId(prefix, "poopColor")),
      poopTexture: valueOf(fieldId(prefix, "poopTexture"))
    });
  }

  function resetEntryFields() {
    els.recordTime.value = nowShanghaiLocalInput();
    state.selectedAction = "";
    els.breastMode.value = "timer";
    els.otherFeedMethod.value = "bottle";
    els.amountMl.value = "";
    els.feedSide.value = "";
    if (els.durationMin) {
      els.durationMin.value = "";
    }
    els.diaperAmount.value = "";
    els.poopColor.value = "";
    els.poopTexture.value = "";
    els.note.value = "";
    updateRecordSelection();
  }

  function render() {
    renderSummary();
    renderHistory();
    renderRecentDailySummary();
    renderDailySummary();
  }

  function renderSummary() {
    var today = dateKeyFromIso(new Date().toISOString());
    var todayRecords = state.records.filter(function (record) {
      return dateKeyFromIso(record.time) === today;
    });
    var todayFeeds = todayRecords.filter(isFeed);
    var todayDiapers = todayRecords.filter(isDiaper);
    var milkMl = todayFeeds.reduce(function (sum, record) {
      return sum + (Number(record.feed && record.feed.amountMl) || 0);
    }, 0);

    fillLast(
      getLatest(state.records.filter(isFeed)),
      els.lastFeed,
      els.lastFeedGap
    );
    fillLast(
      getLatest(state.records.filter(function (record) {
        return hasDiaperKind(record, "pee") || hasDiaperKind(record, "mixed");
      })),
      els.lastPee,
      els.lastPeeGap
    );
    fillLast(
      getLatest(state.records.filter(function (record) {
        return hasDiaperKind(record, "poop") || hasDiaperKind(record, "mixed");
      })),
      els.lastPoop,
      els.lastPoopGap
    );

    els.todayMilk.textContent = formatAmount(milkMl);
    els.todayCounts.textContent = todayFeeds.length + " 次吃奶 · " + todayDiapers.length + " 次尿便";
  }

  function fillLast(record, valueEl, gapEl) {
    if (!record) {
      valueEl.textContent = "--";
      gapEl.textContent = "--";
      return;
    }

    valueEl.textContent = formatTime(record.time);
    gapEl.textContent = isActiveBreastfeed(record) ? "进行中 " + gapFromNow(record.time) : "间隔 " + gapFromNow(record.time);
  }

  function renderHistory() {
    var filter = els.historyFilter.value;
    var records = state.records
      .filter(function (record) {
        return matchesFilter(record, filter);
      })
      .slice()
      .sort(function (a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      });

    if (!records.length) {
      els.historyList.innerHTML = '<div class="empty-state">暂无记录</div>';
      return;
    }

    var groups = groupByDate(records);
    els.historyList.innerHTML = groups.map(function (group) {
      return '<section class="date-group"><div class="date-title">' +
        escapeHtml(group.title) +
        '</div>' +
        group.records.map(renderRecord).join("") +
        "</section>";
    }).join("");
  }

  function renderRecentDailySummary() {
    var groups = groupByDate(
      state.records.slice().sort(function (a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      })
    ).slice(0, 5);

    if (!groups.length) {
      els.recentDailySummaryList.innerHTML = '<div class="empty-state">暂无近五日总结</div>';
      return;
    }

    els.recentDailySummaryList.innerHTML = groups.map(renderRecentDailySummaryCard).join("");
  }

  function renderRecentDailySummaryCard(group) {
    var stats = getDailyStats(group.records);
    var lines = [
      {
        label: "喂奶",
        value: stats.feeds.length + " 次 · 平均间隔 " + averageIntervalText(stats.feeds)
      },
      {
        label: "母乳",
        value: breastDurationText(stats.breastTotals)
      },
      {
        label: "其他奶量",
        value: formatAmount(stats.otherMilkMl)
      },
      {
        label: "小便",
        value: stats.peeRecords.length + " 次 · 平均间隔 " + averageIntervalText(stats.peeRecords)
      },
      {
        label: "大便",
        value: stats.poopRecords.length + " 次 · 平均间隔 " + averageIntervalText(stats.poopRecords)
      }
    ];

    return '<article class="recent-day-card">' +
      '<div class="recent-day-head">' +
      '<h3>' + escapeHtml(group.title) + "</h3>" +
      '<span>' + escapeHtml(formatDateRange(stats.records)) + "</span>" +
      "</div>" +
      '<div class="recent-day-lines">' +
      lines.map(function (line) {
        return '<p><strong>' + escapeHtml(line.label) + '</strong><span>' + escapeHtml(line.value) + "</span></p>";
      }).join("") +
      "</div>" +
      "</article>";
  }

  function renderDailySummary() {
    var groups = groupByDate(
      state.records.slice().sort(function (a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      })
    );

    if (!groups.length) {
      els.dailySummaryList.innerHTML = '<div class="empty-state">暂无总结</div>';
      return;
    }

    els.dailySummaryList.innerHTML = groups.map(renderDailySummaryGroup).join("");
  }

  function renderDailySummaryGroup(group) {
    var stats = getDailyStats(group.records);

    return '<section class="daily-summary-card">' +
      '<div class="daily-summary-head">' +
      '<h3>' + escapeHtml(group.title) + "</h3>" +
      '<button class="secondary-button compact-button" type="button" data-summary-date="' + escapeHtml(group.dateKey) + '">导出图片</button>' +
      '<span>' + stats.feeds.length + ' 次喂奶 · ' + stats.peeRecords.length + ' 次小便 · ' + stats.poopRecords.length + ' 次大便</span>' +
      "</div>" +
      '<div class="daily-summary-grid">' +
      renderSummaryBlock(
        "喂奶",
        [
          "其他总奶量：" + formatAmount(stats.otherMilkMl),
          "母乳持续：" + breastDurationText(stats.breastTotals)
        ],
        renderTimeline(stats.feeds, "暂无喂奶记录", feedTimelineLabel)
      ) +
      renderSummaryBlock(
        "小便",
        [],
        renderTimeline(stats.peeRecords, "暂无小便记录", diaperTimelineLabel)
      ) +
      renderSummaryBlock(
        "大便",
        [],
        renderTimeline(stats.poopRecords, "暂无大便记录", diaperTimelineLabel)
      ) +
      "</div>" +
      "</section>";
  }

  function getDailyStats(records) {
    var sortedRecords = records.slice().sort(function (a, b) {
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });
    var feeds = sortedRecords.filter(isFeed);
    var peeRecords = sortedRecords.filter(function (record) {
      return hasDiaperKind(record, "pee") || hasDiaperKind(record, "mixed");
    });
    var poopRecords = sortedRecords.filter(function (record) {
      return hasDiaperKind(record, "poop") || hasDiaperKind(record, "mixed");
    });
    var otherMilkMl = feeds.reduce(function (sum, record) {
      return normalizeFeedMethod(record.feed && record.feed.method) === "breast"
        ? sum
        : sum + (Number(record.feed && record.feed.amountMl) || 0);
    }, 0);

    return {
      records: sortedRecords,
      feeds: feeds,
      peeRecords: peeRecords,
      poopRecords: poopRecords,
      otherMilkMl: otherMilkMl,
      breastTotals: summarizeBreastDurations(feeds)
    };
  }

  function exportRecentSummaryImage() {
    var groups = groupByDate(
      state.records.slice().sort(function (a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      })
    ).slice(0, 5);

    if (!groups.length) {
      showToast("暂无近五日总结可导出");
      return;
    }

    exportSummaryImage(
      buildRecentSummaryImageData(groups),
      "新生儿近五日总结-" + dateKeyFromIso(new Date().toISOString()) + ".png"
    );
  }

  function exportDailySummaryImage(dateKey) {
    var groups = groupByDate(
      state.records.slice().sort(function (a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      })
    );
    var group = groups.find(function (item) {
      return item.dateKey === dateKey;
    });

    if (!group) {
      showToast("未找到这一天的总结");
      return;
    }

    exportSummaryImage(
      buildDailySummaryImageData(group),
      "新生儿每日总结-" + group.dateKey + ".png"
    );
  }

  function exportSummaryImage(data, filename) {
    drawSummaryImage(data).then(function (blob) {
      downloadBlob(blob, filename);
      showToast("图片已导出");
    }).catch(function () {
      showToast("图片生成失败");
    });
  }

  function buildRecentSummaryImageData(groups) {
    var nowIso = new Date().toISOString();
    return {
      title: "近五日总结",
      subtitle: "生成时间：" + dateKeyFromIso(nowIso) + " " + formatTime(nowIso),
      sections: groups.map(function (group) {
        var stats = getDailyStats(group.records);
        return {
          title: group.title + " · " + formatDateRange(stats.records),
          lines: summaryOverviewLines(stats)
        };
      })
    };
  }

  function buildDailySummaryImageData(group) {
    var stats = getDailyStats(group.records);
    return {
      title: "每日总结 · " + group.title,
      subtitle: "记录范围：" + formatDateRange(stats.records),
      sections: [
        {
          title: "总览",
          lines: summaryOverviewLines(stats)
        },
        {
          title: "喂奶时间线",
          lines: summaryTimelineLines(stats.feeds, "暂无喂奶记录", feedTimelineLabel)
        },
        {
          title: "小便时间线",
          lines: summaryTimelineLines(stats.peeRecords, "暂无小便记录", diaperTimelineLabel)
        },
        {
          title: "大便时间线",
          lines: summaryTimelineLines(stats.poopRecords, "暂无大便记录", diaperTimelineLabel)
        }
      ]
    };
  }

  function summaryOverviewLines(stats) {
    return [
      "喂奶：" + stats.feeds.length + " 次 · 平均间隔 " + averageIntervalText(stats.feeds),
      "母乳：" + breastDurationText(stats.breastTotals),
      "其他奶量：" + formatAmount(stats.otherMilkMl),
      "小便：" + stats.peeRecords.length + " 次 · 平均间隔 " + averageIntervalText(stats.peeRecords),
      "大便：" + stats.poopRecords.length + " 次 · 平均间隔 " + averageIntervalText(stats.poopRecords)
    ];
  }

  function summaryTimelineLines(records, emptyText, labelFn) {
    if (!records.length) {
      return [emptyText];
    }

    return records.map(function (record, index) {
      var interval = index > 0 ? formatInterval(records[index - 1].time, record.time) : "--";
      return formatTime(record.time) + " · " + labelFn(record) + " · 间隔 " + interval;
    });
  }

  function renderSummaryBlock(title, lines, timelineHtml) {
    var lineHtml = lines.map(function (line) {
      return '<p class="summary-line">' + escapeHtml(line) + "</p>";
    }).join("");

    return '<article class="daily-summary-block">' +
      '<h4>' + escapeHtml(title) + "</h4>" +
      lineHtml +
      timelineHtml +
      "</article>";
  }

  function renderTimeline(records, emptyText, labelFn) {
    if (!records.length) {
      return '<div class="summary-empty">' + escapeHtml(emptyText) + "</div>";
    }

    return '<div class="daily-timeline">' + records.map(function (record, index) {
      var interval = index > 0 ? formatInterval(records[index - 1].time, record.time) : "--";
      return '<div class="daily-timeline-row">' +
        '<span>' + escapeHtml(formatTime(record.time)) + "</span>" +
        '<strong>' + escapeHtml(labelFn(record)) + "</strong>" +
        '<small>间隔 ' + escapeHtml(interval) + "</small>" +
        "</div>";
    }).join("") + "</div>";
  }

  function feedTimelineLabel(record) {
    var parts = [labelFor("feedMethod", normalizeFeedMethod(record.feed && record.feed.method)) || "喂奶"];
    if (isActiveBreastfeed(record)) {
      parts.push("进行中");
    }
    if (record.feed && Number.isFinite(Number(record.feed.amountMl))) {
      parts.push(formatAmount(Number(record.feed.amountMl)));
    }
    if (record.feed && record.feed.side) {
      parts.push(labelFor("side", record.feed.side));
    }
    if (record.feed && Number.isFinite(Number(record.feed.durationMin))) {
      parts.push(record.feed.durationMin + " 分钟");
    }
    return parts.join(" · ");
  }

  function diaperTimelineLabel(record) {
    var parts = [recordLabel(record)];
    if (record.diaper && record.diaper.amount) {
      parts.push(record.diaper.amount);
    }
    return parts.join(" · ");
  }

  function summarizeBreastDurations(feeds) {
    var totals = {
      left: 0,
      right: 0,
      both: 0,
      unknown: 0
    };

    feeds.forEach(function (record) {
      if (normalizeFeedMethod(record.feed && record.feed.method) !== "breast") {
        return;
      }
      var minutes = Number(record.feed && record.feed.durationMin);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return;
      }
      if (record.feed.side === "left") {
        totals.left += minutes;
      } else if (record.feed.side === "right") {
        totals.right += minutes;
      } else if (record.feed.side === "both") {
        totals.both += minutes;
      } else {
        totals.unknown += minutes;
      }
    });

    return totals;
  }

  function breastDurationText(totals) {
    var parts = [
      "左 " + formatTotalMinutes(totals.left),
      "右 " + formatTotalMinutes(totals.right)
    ];
    if (totals.both > 0) {
      parts.push("两侧 " + formatTotalMinutes(totals.both));
    }
    if (totals.unknown > 0) {
      parts.push("未分侧 " + formatTotalMinutes(totals.unknown));
    }
    return parts.join(" · ");
  }

  function renderRecord(record) {
    var chips = recordChips(record).map(function (chip) {
      return '<span class="chip">' + escapeHtml(chip) + "</span>";
    }).join("");
    var note = record.note
      ? '<div class="record-note">' + escapeHtml(record.note) + "</div>"
      : "";
    var actions = "";
    if (isActiveBreastfeed(record)) {
      actions += '<button class="primary-button" type="button" data-intent="finish-feed" data-id="' + escapeHtml(record.id) + '">结束</button>';
    }
    actions += '<button class="secondary-button" type="button" data-intent="edit" data-id="' + escapeHtml(record.id) + '">编辑</button>';
    actions += '<button class="secondary-button danger-button" type="button" data-intent="delete" data-id="' + escapeHtml(record.id) + '">删除</button>';

    return '<article class="record-item">' +
      '<div class="record-main">' +
      '<div class="record-title">' + escapeHtml(recordLabel(record)) + "</div>" +
      '<div class="record-time">' + escapeHtml(formatDateTime(record.time)) + "</div>" +
      (chips ? '<div class="chip-list">' + chips + "</div>" : "") +
      note +
      "</div>" +
      '<div class="record-actions">' +
      actions +
      "</div>" +
      "</article>";
  }

  function openEdit(id) {
    var record = findRecord(id);
    if (!record) {
      return;
    }

    var editType = record.feed && normalizeFeedMethod(record.feed.method) === "breast" ? "breast" : "otherFeed";
    if (isDiaper(record)) {
      editType = (record.diaper && record.diaper.kind) || "pee";
    }

    els.editId.value = record.id;
    els.editType.value = editType;
    els.editTime.value = shanghaiInputFromIso(record.time);
    els.editOtherFeedMethod.value = normalizeFeedMethod(record.feed && record.feed.method) === "breast" ? "bottle" : normalizeFeedMethod(record.feed && record.feed.method);
    els.editAmountMl.value = numberToInput(record.feed && record.feed.amountMl);
    els.editFeedSide.value = (record.feed && record.feed.side) || "";
    els.editDurationMin.value = numberToInput(record.feed && record.feed.durationMin);
    els.editDiaperAmount.value = (record.diaper && record.diaper.amount) || "";
    els.editPoopColor.value = (record.diaper && record.diaper.poopColor) || "";
    els.editPoopTexture.value = (record.diaper && record.diaper.poopTexture) || "";
    els.editNote.value = record.note || "";
    updateEditVisibility();

    if (typeof els.editDialog.showModal === "function") {
      els.editDialog.showModal();
    } else {
      els.editDialog.setAttribute("open", "");
    }
  }

  function saveEdit(event) {
    event.preventDefault();
    var record = findRecord(els.editId.value);
    if (!record) {
      closeEdit();
      return;
    }

    var timeIso = isoFromShanghaiInput(els.editTime.value);
    if (!timeIso) {
      showToast("请先填写时间");
      return;
    }

    var nextType = isFeedAction(els.editType.value) ? "feed" : "diaper";
    record.type = nextType;
    record.time = timeIso;
    record.note = els.editNote.value.trim();
    record.updatedAt = new Date().toISOString();

    if (nextType === "feed") {
      var previousFeed = record.feed || {};
      record.feed = readFeedFields("edit", els.editType.value === "breast" ? "breast" : valueOf("editOtherFeedMethod") || "other");
      if (record.feed.method === "breast") {
        record.feed.status = previousFeed.status === "active" ? "active" : "done";
        if (previousFeed.endedAt) {
          record.feed.endedAt = previousFeed.endedAt;
        }
      }
      delete record.diaper;
    } else {
      record.diaper = readDiaperFields("edit", els.editType.value);
      delete record.feed;
    }

    cleanRecord(record);
    saveRecords();
    closeEdit();
    render();
    showToast("已保存");
  }

  function closeEdit() {
    if (els.editDialog.open && typeof els.editDialog.close === "function") {
      els.editDialog.close();
    } else {
      els.editDialog.removeAttribute("open");
    }
  }

  function finishBreastfeed(id) {
    var record = findRecord(id);
    if (!isActiveBreastfeed(record)) {
      return;
    }

    var now = new Date();
    var startedAt = new Date(record.time);
    var durationMin = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000));
    record.feed.status = "done";
    record.feed.endedAt = now.toISOString();
    record.feed.durationMin = durationMin;
    record.updatedAt = record.feed.endedAt;
    saveRecords();
    render();
    showToast("母乳已结束，" + durationMin + " 分钟");
  }

  function updateEditVisibility() {
    var isEditFeed = isFeedAction(els.editType.value);
    els.editFeedFields.hidden = !isEditFeed;
    els.editDiaperFields.hidden = isEditFeed;
    document.querySelectorAll("[data-edit-feed-breast]").forEach(function (field) {
      field.hidden = els.editType.value !== "breast";
    });
    document.querySelectorAll("[data-edit-feed-other]").forEach(function (field) {
      field.hidden = els.editType.value !== "otherFeed";
    });
    document.querySelectorAll("[data-edit-poop-extra]").forEach(function (field) {
      field.hidden = els.editType.value !== "poop" && els.editType.value !== "mixed";
    });
  }

  function deleteRecord(id) {
    var record = findRecord(id);
    if (!record) {
      return;
    }

    if (!window.confirm("删除这条记录？")) {
      return;
    }

    state.records = state.records.filter(function (item) {
      return item.id !== id;
    });
    saveRecords();
    render();
    showToast("已删除");
  }

  function exportCsv() {
    var headers = [
      "记录ID",
      "类型",
      "北京时间",
      "ISO时间",
      "奶类方式",
      "奶量ml",
      "左右侧",
      "持续分钟",
      "尿便类型",
      "尿便量",
      "大便颜色",
      "大便性状",
      "备注",
      "创建时间",
      "更新时间"
    ];
    var rows = state.records
      .slice()
      .sort(function (a, b) {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
      })
      .map(function (record) {
        return [
          record.id,
          recordLabel(record),
          formatDateTime(record.time),
          record.time,
          labelFor("feedMethod", record.feed && record.feed.method),
          valueOrEmpty(record.feed && record.feed.amountMl),
          labelFor("side", record.feed && record.feed.side),
          valueOrEmpty(record.feed && record.feed.durationMin),
          labelFor("diaperKind", record.diaper && record.diaper.kind),
          labelFor("diaperAmount", record.diaper && record.diaper.amount),
          labelFor("poopColor", record.diaper && record.diaper.poopColor),
          labelFor("poopTexture", record.diaper && record.diaper.poopTexture),
          record.note || "",
          record.createdAt || "",
          record.updatedAt || ""
        ];
      });

    var csv = [headers].concat(rows).map(csvRow).join("\r\n");
    download("\ufeff" + csv, "新生儿记录-" + dateKeyFromIso(new Date().toISOString()) + ".csv", "text/csv;charset=utf-8");
    showToast("CSV 已导出");
  }

  function exportJson() {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: state.records
    };
    download(
      JSON.stringify(payload, null, 2),
      "新生儿记录备份-" + dateKeyFromIso(new Date().toISOString()) + ".json",
      "application/json;charset=utf-8"
    );
    showToast("JSON 已导出");
  }

  function importJson(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var payload = JSON.parse(String(reader.result || ""));
        var importedRecords = normalizeImportedRecords(payload);
        var mergeResult = mergeRecords(state.records, importedRecords);
        if (!window.confirm("导入 " + importedRecords.length + " 条记录，并与本机记录自动合并？")) {
          return;
        }

        state.records = mergeResult.records;
        saveRecords();
        render();
        showToast("已合并：新增 " + mergeResult.added + "，更新 " + mergeResult.updated + "，跳过 " + mergeResult.skipped);
      } catch (error) {
        showToast("JSON 文件无法导入");
      } finally {
        els.importJson.value = "";
      }
    };
    reader.onerror = function () {
      showToast("文件读取失败");
      els.importJson.value = "";
    };
    reader.readAsText(file, "utf-8");
  }

  function normalizeImportedRecords(payload) {
    if (!payload || payload.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.records)) {
      throw new Error("Unsupported backup");
    }

    return payload.records.map(function (record) {
      if (!record || !record.id || !record.type || !record.time) {
        throw new Error("Invalid record");
      }

      return cleanRecord({
        id: String(record.id),
        type: record.type === "feed" ? "feed" : "diaper",
        time: new Date(record.time).toISOString(),
        feed: record.feed || undefined,
        diaper: record.diaper || undefined,
        note: String(record.note || ""),
        createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString()
      });
    });
  }

  function mergeRecords(currentRecords, importedRecords) {
    var byId = {};
    var added = 0;
    var updated = 0;
    var skipped = 0;

    currentRecords.forEach(function (record) {
      byId[record.id] = cleanRecord(record);
    });

    importedRecords.forEach(function (incoming) {
      var existing = byId[incoming.id];
      if (!existing) {
        byId[incoming.id] = cleanRecord(incoming);
        added += 1;
        return;
      }

      if (recordTimestamp(incoming) > recordTimestamp(existing)) {
        byId[incoming.id] = cleanRecord(incoming);
        updated += 1;
      } else {
        skipped += 1;
      }
    });

    return {
      records: Object.keys(byId).map(function (id) {
        return byId[id];
      }).sort(function (a, b) {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
      }),
      added: added,
      updated: updated,
      skipped: skipped
    };
  }

  function recordTimestamp(record) {
    var source = record && (record.updatedAt || record.createdAt || record.time);
    var timestamp = new Date(source).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
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

  function groupByDate(records) {
    var map = {};
    records.forEach(function (record) {
      var key = dateKeyFromIso(record.time);
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(record);
    });

    return Object.keys(map).map(function (key) {
      return {
        dateKey: key,
        title: formatDateTitle(key),
        records: map[key]
      };
    });
  }

  function recordChips(record) {
    var chips = [];
    if (record.feed) {
      pushLabel(chips, "feedMethod", record.feed.method);
      if (isActiveBreastfeed(record)) {
        chips.push("进行中");
      }
      if (Number.isFinite(Number(record.feed.amountMl))) {
        chips.push(formatAmount(Number(record.feed.amountMl)));
      }
      pushLabel(chips, "side", record.feed.side);
      if (Number.isFinite(Number(record.feed.durationMin))) {
        chips.push(record.feed.durationMin + " 分钟");
      }
      if (record.feed.endedAt) {
        chips.push("结束 " + formatTime(record.feed.endedAt));
      }
    }

    if (record.diaper) {
      pushLabel(chips, "diaperKind", record.diaper.kind);
      pushLabel(chips, "diaperAmount", record.diaper.amount);
      pushLabel(chips, "poopColor", record.diaper.poopColor);
      pushLabel(chips, "poopTexture", record.diaper.poopTexture);
    }

    return chips;
  }

  function pushLabel(chips, group, value) {
    var text = labelFor(group, value);
    if (text) {
      chips.push(text);
    }
  }

  function recordLabel(record) {
    if (record.type === "feed") {
      var method = normalizeFeedMethod(record.feed && record.feed.method);
      return method === "breast" && isActiveBreastfeed(record) ? "母乳进行中" : labelFor("feedMethod", method);
    }
    return labelFor("diaperKind", record.diaper && record.diaper.kind) || "尿便";
  }

  function recordActionTitle(action) {
    if (action === "breast") {
      return "母乳";
    }
    if (action === "otherFeed") {
      return "其他";
    }
    return labelFor("diaperKind", action) || "尿便";
  }

  function labelFor(group, value) {
    if (!value) {
      return "";
    }
    return (labels[group] && labels[group][value]) || value;
  }

  function getLatest(records) {
    return records.slice().sort(function (a, b) {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    })[0];
  }

  function findRecord(id) {
    return state.records.find(function (record) {
      return record.id === id;
    });
  }

  function hasDiaperKind(record, kind) {
    return isDiaper(record) && record.diaper && record.diaper.kind === kind;
  }

  function matchesFilter(record, filter) {
    if (filter === "all") {
      return true;
    }
    if (filter === "feed") {
      return isFeed(record);
    }
    if (filter === "diaper") {
      return isDiaper(record);
    }
    if (filter === "pee") {
      return hasDiaperKind(record, "pee") || hasDiaperKind(record, "mixed");
    }
    if (filter === "poop") {
      return hasDiaperKind(record, "poop") || hasDiaperKind(record, "mixed");
    }
    return false;
  }

  function isFeed(record) {
    return record.type === "feed";
  }

  function isFeedAction(action) {
    return action === "breast" || action === "otherFeed";
  }

  function isActiveBreastfeed(record) {
    return Boolean(
      record &&
      record.type === "feed" &&
      record.feed &&
      normalizeFeedMethod(record.feed.method) === "breast" &&
      record.feed.status === "active"
    );
  }

  function normalizeFeedMethod(method) {
    if (method === "breast" || method === "bottle" || method === "formula" || method === "pumped" || method === "other") {
      return method;
    }
    return "other";
  }

  function isDiaper(record) {
    return record.type === "diaper";
  }

  function valueOf(id) {
    var el = byId(id);
    return el ? el.value.trim() : "";
  }

  function fieldId(prefix, suffix) {
    if (!prefix) {
      return suffix;
    }
    return prefix + suffix.charAt(0).toUpperCase() + suffix.slice(1);
  }

  function readNumber(id) {
    var text = valueOf(id);
    if (text === "") {
      return undefined;
    }
    var number = Number(text);
    if (!Number.isFinite(number) || number < 0) {
      return undefined;
    }
    return number;
  }

  function numberToInput(value) {
    return Number.isFinite(Number(value)) ? String(value) : "";
  }

  function valueOrEmpty(value) {
    return value === 0 || value ? value : "";
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
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

  function formatAmount(value) {
    var number = Number(value) || 0;
    return number + " ml";
  }

  function formatInterval(previousIso, currentIso) {
    var minutes = Math.max(0, Math.round((new Date(currentIso).getTime() - new Date(previousIso).getTime()) / 60000));
    return formatMinuteCount(minutes);
  }

  function averageIntervalText(records) {
    if (records.length < 2) {
      return "--";
    }
    var totalMinutes = 0;
    for (var index = 1; index < records.length; index += 1) {
      totalMinutes += Math.max(0, Math.round((new Date(records[index].time).getTime() - new Date(records[index - 1].time).getTime()) / 60000));
    }
    return formatMinuteCount(Math.round(totalMinutes / (records.length - 1)));
  }

  function formatDateRange(records) {
    if (!records.length) {
      return "无记录";
    }
    return formatTime(records[0].time) + " - " + formatTime(records[records.length - 1].time);
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

  function formatTotalMinutes(minutes) {
    var safeMinutes = Math.max(0, Number(minutes) || 0);
    if (safeMinutes === 0) {
      return "0 分钟";
    }
    return formatMinuteCount(safeMinutes);
  }

  function gapFromNow(iso) {
    var diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
    var totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes < 1) {
      return "刚刚";
    }
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (!hours) {
      return minutes + " 分钟";
    }
    if (!minutes) {
      return hours + " 小时";
    }
    return hours + " 小时 " + minutes + " 分钟";
  }

  function csvRow(values) {
    return values.map(function (value) {
      var text = String(value === null || typeof value === "undefined" ? "" : value);
      return '"' + text.replace(/"/g, '""') + '"';
    }).join(",");
  }

  function drawSummaryImage(data) {
    var width = 1080;
    var padding = 64;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 100;
    var ctx = canvas.getContext("2d");
    var height = Math.ceil(renderSummaryCanvas(ctx, data, {
      dryRun: true,
      padding: padding,
      width: width
    }));

    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d");
    renderSummaryCanvas(ctx, data, {
      dryRun: false,
      padding: padding,
      width: width
    });

    return canvasToBlob(canvas);
  }

  function renderSummaryCanvas(ctx, data, options) {
    var width = options.width;
    var padding = options.padding;
    var contentWidth = width - padding * 2;
    var y = padding;

    if (!options.dryRun) {
      ctx.fillStyle = "#f6f7f1";
      ctx.fillRect(0, 0, width, ctx.canvas.height);
    }

    y = drawCanvasText(ctx, data.title, {
      color: "#223033",
      dryRun: options.dryRun,
      font: "700 52px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      lineHeight: 66,
      maxWidth: contentWidth,
      x: padding,
      y: y
    });

    if (data.subtitle) {
      y += 10;
      y = drawCanvasText(ctx, data.subtitle, {
        color: "#647275",
        dryRun: options.dryRun,
        font: "400 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 40,
        maxWidth: contentWidth,
        x: padding,
        y: y
      });
    }

    y += 30;
    data.sections.forEach(function (section) {
      var layout = layoutSummaryImageSection(ctx, section, contentWidth - 48);
      if (!options.dryRun) {
        ctx.fillStyle = "#ffffff";
        fillRoundRect(ctx, padding, y, contentWidth, layout.height, 18);
      }

      var innerY = y + 26;
      ctx.font = "700 34px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#2f6f73";
      layout.titleLines.forEach(function (line) {
        if (!options.dryRun) {
          ctx.fillText(line, padding + 24, innerY + 34);
        }
        innerY += 44;
      });

      innerY += 8;
      ctx.font = "400 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#223033";
      layout.bodyLines.forEach(function (line) {
        if (!options.dryRun) {
          ctx.fillText(line, padding + 24, innerY + 28);
        }
        innerY += 38;
      });

      y += layout.height + 24;
    });

    return y + padding - 24;
  }

  function layoutSummaryImageSection(ctx, section, maxWidth) {
    ctx.font = "700 34px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    var titleLines = wrapCanvasText(ctx, section.title, maxWidth);
    var bodyLines = [];
    ctx.font = "400 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    section.lines.forEach(function (line, index) {
      if (index > 0) {
        bodyLines.push("");
      }
      wrapCanvasText(ctx, line, maxWidth).forEach(function (wrappedLine) {
        bodyLines.push(wrappedLine);
      });
    });

    return {
      bodyLines: bodyLines,
      height: 26 + titleLines.length * 44 + 8 + bodyLines.length * 38 + 28,
      titleLines: titleLines
    };
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    var chars = String(text || "").split("");
    var lines = [];
    var line = "";

    chars.forEach(function (char) {
      if (char === "\n") {
        lines.push(line);
        line = "";
        return;
      }

      var candidate = line + char;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    });

    lines.push(line);
    return lines;
  }

  function fillRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawCanvasText(ctx, text, options) {
    ctx.font = options.font;
    ctx.fillStyle = options.color;
    var y = options.y;
    wrapCanvasText(ctx, text, options.maxWidth).forEach(function (line) {
      if (!options.dryRun) {
        ctx.fillText(line, options.x, y + options.lineHeight * 0.8);
      }
      y += options.lineHeight;
    });
    return y;
  }

  function download(content, filename, type) {
    var blob = new Blob([content], { type: type });
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas export failed"));
          }
        }, "image/png");
        return;
      }

      try {
        resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
      } catch (error) {
        reject(error);
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : "image/png";
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
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

    navigator.serviceWorker.register("sw.js?v=15").catch(function () {
      showToast("离线缓存暂不可用");
    });
  }
})();

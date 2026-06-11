(function () {
  "use strict";

  var STORAGE_KEY = "baby-log:v1:records";
  var DAY_ONE_DATE_KEY = "2026-05-26";
  var SHANGHAI_OFFSET_MINUTES = 8 * 60;
  var TIME_BUCKETS = [
    { label: "00-03" },
    { label: "03-06" },
    { label: "06-09" },
    { label: "09-12" },
    { label: "12-15" },
    { label: "15-18" },
    { label: "18-21" },
    { label: "21-24" }
  ];
  var INTERVAL_BUCKETS = [
    { label: "<1h", min: 0, max: 60 },
    { label: "1-2h", min: 60, max: 120 },
    { label: "2-3h", min: 120, max: 180 },
    { label: "3-4h", min: 180, max: 240 },
    { label: "4-6h", min: 240, max: 360 },
    { label: "6-8h", min: 360, max: 480 },
    { label: "8-12h", min: 480, max: 720 },
    { label: "12h+", min: 720, max: Infinity }
  ];

  var toastTimer = 0;
  var state = {
    records: []
  };

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

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    state.records = loadRecords();
    initializeRangeInputs(state.records);
    render();
    registerServiceWorker();
  }

  function cacheElements() {
    els.rangeMode = byId("rangeMode");
    els.rangeStart = byId("rangeStart");
    els.rangeEnd = byId("rangeEnd");
    els.customRangeFields = byId("customRangeFields");
    els.coverageRange = byId("coverageRange");
    els.coverageDays = byId("coverageDays");
    els.totalRecords = byId("totalRecords");
    els.categoryCounts = byId("categoryCounts");
    els.analysisModeLabel = byId("analysisModeLabel");
    els.emptyPanel = byId("emptyPanel");
    els.emptyMessage = byId("emptyMessage");
    els.analysisContent = byId("analysisContent");
    els.nextReferenceCards = byId("nextReferenceCards");
    els.patternCards = byId("patternCards");
    els.trendSummary = byId("trendSummary");
    els.dailyTrend = byId("dailyTrend");
    els.intervalSummary = byId("intervalSummary");
    els.intervalCharts = byId("intervalCharts");
    els.distributionCharts = byId("distributionCharts");
    els.timeHeatmap = byId("timeHeatmap");
    els.feedExtra = byId("feedExtra");
    els.feedBreakdown = byId("feedBreakdown");
    els.diaperBreakdown = byId("diaperBreakdown");
    els.excludedIntervals = byId("excludedIntervals");
    els.toast = byId("toast");
  }

  function bindEvents() {
    els.rangeMode.addEventListener("change", function () {
      updateCustomRangeVisibility();
      render();
    });
    els.rangeStart.addEventListener("change", render);
    els.rangeEnd.addEventListener("change", render);
  }

  function render() {
    var range = getSelectedRange();
    var records = filterRecordsByRange(state.records, range).sort(compareByTime);
    var analysis = buildAnalysis(records, range);
    renderOverview(analysis);
    els.analysisModeLabel.textContent = range.label;

    if (!records.length) {
      els.emptyPanel.hidden = false;
      els.analysisContent.hidden = true;
      els.emptyMessage.textContent = state.records.length ?
        "当前统计范围暂无记录，可以换一个范围看看。" :
        "暂无历史记录，添加吃奶或大小便记录后这里会自动生成分析。";
      return;
    }

    els.emptyPanel.hidden = true;
    els.analysisContent.hidden = false;
    renderNextReferences(analysis.intervalSummaries);
    renderPatternCards(analysis.patterns);
    renderTrendSummary(analysis.trendSummaries);
    renderDailyTrend(analysis.dailyRows);
    renderIntervalSummary(analysis.intervalSummaries);
    renderIntervalCharts(analysis.intervalSummaries);
    renderDistributionCharts(analysis.patterns);
    renderTimeHeatmap(analysis.heatmaps);
    renderFeedExtra(analysis.feedExtra);
    renderFeedBreakdown(analysis.feedBreakdown);
    renderDiaperBreakdown(analysis.diaperBreakdown);
    renderExcludedIntervals(analysis.intervalSummaries);
  }

  function initializeRangeInputs(records) {
    var dateRange = getDateRange(records, { mode: "all" });
    var today = dateKeyFromIso(new Date().toISOString());
    els.rangeStart.value = dateRange.firstDateKey || today;
    els.rangeEnd.value = dateRange.lastDateKey || today;
    updateCustomRangeVisibility();
  }

  function updateCustomRangeVisibility() {
    els.customRangeFields.hidden = els.rangeMode.value !== "custom";
  }

  function getSelectedRange() {
    var mode = els.rangeMode.value;
    var today = dateKeyFromIso(new Date().toISOString());
    if (mode === "recent7") {
      return {
        endDateKey: today,
        label: "最近 7 天",
        mode: mode,
        startDateKey: addDays(today, -6)
      };
    }
    if (mode === "recent14") {
      return {
        endDateKey: today,
        label: "最近 14 天",
        mode: mode,
        startDateKey: addDays(today, -13)
      };
    }
    if (mode === "custom") {
      return customRange();
    }
    return {
      endDateKey: "",
      label: "全部历史",
      mode: "all",
      startDateKey: ""
    };
  }

  function customRange() {
    var fallback = getDateRange(state.records, { mode: "all" });
    var today = dateKeyFromIso(new Date().toISOString());
    var start = els.rangeStart.value || fallback.firstDateKey || today;
    var end = els.rangeEnd.value || fallback.lastDateKey || today;
    if (dateKeyToUtcMs(start) > dateKeyToUtcMs(end)) {
      var temp = start;
      start = end;
      end = temp;
    }
    return {
      endDateKey: end,
      label: start === end ? "自定义 " + formatDateTitle(start) : "自定义 " + formatShortDate(start) + " - " + formatShortDate(end),
      mode: "custom",
      startDateKey: start
    };
  }

  function filterRecordsByRange(records, range) {
    if (!range.startDateKey || !range.endDateKey) {
      return records.slice();
    }
    return records.filter(function (record) {
      var dateKey = dateKeyFromIso(record.time);
      return dateKey >= range.startDateKey && dateKey <= range.endDateKey;
    });
  }

  function buildAnalysis(records, range) {
    var dateRange = getDateRange(records, range);
    var feedRecords = records.filter(isFeed);
    var feedSessions = buildFeedSessions(feedRecords);
    var peeRecords = records.filter(function (record) {
      return hasDiaperKind(record, "pee") || hasDiaperKind(record, "mixed");
    });
    var poopRecords = records.filter(function (record) {
      return hasDiaperKind(record, "poop") || hasDiaperKind(record, "mixed");
    });
    var diaperRecords = records.filter(isDiaper);
    var dailyRows = buildDailyMetrics(dateRange, records, feedSessions);
    var categoryConfigs = [
      { key: "feed", label: "喂奶", records: feedSessions, dailyKey: "feedCount" },
      { key: "pee", label: "小便", records: peeRecords, dailyKey: "peeCount" },
      { key: "poop", label: "大便", records: poopRecords, dailyKey: "poopCount" }
    ];
    var trendSummaries = categoryConfigs.map(function (config) {
      return buildTrendSummary(config.label, dailyRows, config.dailyKey);
    });
    var intervalSummaries = categoryConfigs.map(function (config) {
      return buildIntervalSummary(config.label, config.records);
    });

    return {
      coverageDays: dateRange.coverageDays,
      dailyRows: dailyRows,
      dateRange: dateRange,
      diaperBreakdown: buildDiaperBreakdown(diaperRecords),
      feedBreakdown: buildFeedBreakdown(feedRecords, dailyRows),
      feedExtra: buildFeedExtra(feedRecords, dateRange.coverageDays),
      feedRecords: feedRecords,
      feedSessions: feedSessions,
      heatmaps: categoryConfigs.map(function (config) {
        return buildTimeHeatmap(config.label, dateRange, config.records);
      }),
      intervalSummaries: intervalSummaries,
      patterns: categoryConfigs.map(function (config, index) {
        return buildPattern(config.label, config.records, dateRange.coverageDays, trendSummaries[index], intervalSummaries[index]);
      }),
      peeRecords: peeRecords,
      poopRecords: poopRecords,
      totalRecords: records.length,
      trendSummaries: trendSummaries
    };
  }

  function renderOverview(analysis) {
    if (!analysis.totalRecords) {
      els.coverageRange.textContent = analysis.dateRange.firstDateKey ?
        formatDateRange(analysis.dateRange.firstDateKey, analysis.dateRange.lastDateKey) :
        "--";
      els.coverageDays.textContent = analysis.dateRange.coverageDays ?
        analysis.dateRange.coverageDays + " 天范围 · 0 天有记录" :
        "--";
      els.totalRecords.textContent = "0";
      els.categoryCounts.textContent = "喂奶 0 · 小便 0 · 大便 0";
      return;
    }

    els.coverageRange.textContent = formatDateRange(analysis.dateRange.firstDateKey, analysis.dateRange.lastDateKey);
    els.coverageDays.textContent = analysis.coverageDays + " 天范围 · " + analysis.dateRange.recordedDays + " 天有记录";
    els.totalRecords.textContent = String(analysis.totalRecords);
    els.categoryCounts.textContent =
      "喂奶 " + analysis.feedSessions.length + " 次 · 吃奶记录 " + analysis.feedRecords.length + " 条" +
      " · 小便 " + analysis.peeRecords.length +
      " · 大便 " + analysis.poopRecords.length;
  }

  function renderPatternCards(patterns) {
    els.patternCards.innerHTML = patterns.map(function (pattern) {
      return '<article class="pattern-card">' +
        "<h2>" + escapeHtml(pattern.label + "规律") + "</h2>" +
        '<p class="pattern-insight">' + escapeHtml(pattern.insight) + "</p>" +
        '<div class="pattern-stats">' +
        renderStatLine("平均每日次数", pattern.averageDaily) +
        renderStatLine("趋势", pattern.trendText) +
        renderStatLine("最近 3 天日均", pattern.recent3Average) +
        renderStatLine("前半段 / 后半段", pattern.halfAverages) +
        renderStatLine("典型间隔", pattern.typicalInterval) +
        renderStatLine("中位间隔", pattern.medianInterval) +
        renderStatLine("最常出现", pattern.peakBucket) +
        renderStatLine("历史参考窗口", pattern.nextWindow) +
        renderStatLine("最近一次", pattern.latestText) +
        "</div>" +
        "</article>";
    }).join("");
  }

  function renderNextReferences(summaries) {
    els.nextReferenceCards.innerHTML = summaries.map(function (summary) {
      return '<article class="next-reference-card">' +
        '<h3>' + escapeHtml("下次" + summary.label + "参考") + "</h3>" +
        '<div class="next-reference-window">' + escapeHtml(summary.nextWindow) + "</div>" +
        "<p>" + escapeHtml(summary.nextWindowNote) + "</p>" +
        "<p>" + escapeHtml("最近一次：" + summary.latestText) + "</p>" +
        "<p>" + escapeHtml("有效间隔 " + summary.usableIntervals.length + " 段 · 排除疑似漏记 " + summary.excludedIntervals.length + " 段") + "</p>" +
        "</article>";
    }).join("");
  }

  function renderStatLine(label, value) {
    return "<p><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></p>";
  }

  function renderTrendSummary(summaries) {
    els.trendSummary.innerHTML = summaries.map(function (summary) {
      return renderMiniCard(summary.label, summary.trendText, [
        "最近 3 天日均 " + summary.recent3Text,
        "前半段 " + summary.firstHalfText + " · 后半段 " + summary.secondHalfText,
        "最高 " + summary.maxText + " · 最低 " + summary.minText
      ]);
    }).join("");
  }

  function renderDailyTrend(rows) {
    if (!rows.length) {
      els.dailyTrend.innerHTML = '<div class="empty-state">暂无每日趋势</div>';
      return;
    }

    els.dailyTrend.innerHTML = rows.map(function (row) {
      return '<div class="trend-row">' +
        '<span class="trend-date">' + escapeHtml(formatDateTitle(row.dateKey)) + "</span>" +
        renderTrendCount(row.feedCount, row.feedMovingAverage, "喂奶") +
        renderTrendCount(row.peeCount, row.peeMovingAverage, "小便") +
        renderTrendCount(row.poopCount, row.poopMovingAverage, "大便") +
        "</div>";
    }).join("");
  }

  function renderTrendCount(count, movingAverage, label) {
    return '<span class="trend-count"><strong>' +
      count +
      '</strong><small>' +
      escapeHtml(label + " · 3日均 " + formatDecimal(movingAverage)) +
      "</small></span>";
  }

  function renderIntervalSummary(summaries) {
    els.intervalSummary.innerHTML = summaries.map(function (summary) {
      return renderMiniCard(summary.label, summary.cleaningText, [
        "有效间隔 " + summary.usableIntervals.length + " / 原始间隔 " + summary.rawIntervals.length,
        "典型 " + summary.typicalInterval + " · 中位 " + summary.medianInterval,
        "最短 " + summary.minInterval + " · 最长 " + summary.maxInterval,
        "剔除 " + summary.excludedIntervals.length + " 段"
      ]);
    }).join("");
  }

  function renderIntervalCharts(summaries) {
    els.intervalCharts.innerHTML = summaries.map(function (summary) {
      return renderBarCard(summary.label, summary.intervalBucketCounts.map(function (count, index) {
        return {
          count: count,
          label: INTERVAL_BUCKETS[index].label,
          value: String(count)
        };
      }));
    }).join("");
  }

  function renderDistributionCharts(patterns) {
    els.distributionCharts.innerHTML = patterns.map(function (pattern) {
      return renderBarCard(pattern.label, pattern.bucketCounts.map(function (count, index) {
        return {
          count: count,
          label: TIME_BUCKETS[index].label,
          value: String(count)
        };
      }));
    }).join("");
  }

  function renderTimeHeatmap(heatmaps) {
    els.timeHeatmap.innerHTML = heatmaps.map(function (heatmap) {
      var maxCount = Math.max.apply(null, heatmap.rows.reduce(function (all, row) {
        return all.concat(row.counts);
      }, [0]));
      return '<article class="heatmap-card">' +
        "<h3>" + escapeHtml(heatmap.label) + "</h3>" +
        '<div class="heatmap-scroll"><div class="heatmap-grid">' +
        '<span class="heatmap-cell"></span>' +
        TIME_BUCKETS.map(function (bucket) {
          return '<span class="heatmap-cell">' + escapeHtml(bucket.label) + "</span>";
        }).join("") +
        heatmap.rows.map(function (row) {
          return '<span class="heatmap-cell date">' + escapeHtml(formatShortDate(row.dateKey)) + "</span>" +
            row.counts.map(function (count) {
              return '<span class="heatmap-cell ' + heatmapLevel(count, maxCount) + '">' + (count || "") + "</span>";
            }).join("");
        }).join("") +
        "</div></div></article>";
    }).join("");
  }

  function renderFeedExtra(extra) {
    els.feedExtra.innerHTML =
      renderExtraCard("母乳左右累计", [
        "左侧 " + formatTotalMinutes(extra.breastTotals.left),
        "右侧 " + formatTotalMinutes(extra.breastTotals.right),
        "两侧 " + formatTotalMinutes(extra.breastTotals.both),
        "未填 " + formatTotalMinutes(extra.breastTotals.unknown)
      ].join(" · ")) +
      renderExtraCard("其他喂奶奶量", [
        "总量 " + formatAmount(extra.otherMilkMl),
        "平均每日 " + formatAmount(extra.averageOtherMilkMl),
        extra.otherFeedCount + " 次"
      ].join(" · ")) +
      renderExtraCard("计时说明", extra.activeBreastCount ?
        extra.activeBreastCount + " 条进行中的母乳记录未计入持续时间" :
        "没有进行中的母乳记录");
  }

  function renderFeedBreakdown(breakdown) {
    els.feedBreakdown.innerHTML =
      renderBreakdownCard("原始吃奶记录方式", renderRatioRows([
        { label: "母乳", count: breakdown.breastCount },
        { label: "其他", count: breakdown.otherCount }
      ])) +
      renderBreakdownCard("其他奶量每日趋势", renderDailyValueRows(breakdown.otherMilkRows, "ml")) +
      renderBreakdownCard("母乳时长每日趋势", renderBreastDurationRows(breakdown.breastDurationRows));
  }

  function renderDiaperBreakdown(breakdown) {
    var html =
      renderBreakdownCard("尿便类型", renderRatioRows([
        { label: "小便", count: breakdown.kindCounts.pee },
        { label: "大便", count: breakdown.kindCounts.poop },
        { label: "尿+便", count: breakdown.kindCounts.mixed }
      ])) +
      renderBreakdownCard("尿便量", renderCountMapRows(breakdown.amountCounts));

    if (sumMap(breakdown.colorCounts)) {
      html += renderBreakdownCard("大便颜色", renderCountMapRows(breakdown.colorCounts));
    }
    if (sumMap(breakdown.textureCounts)) {
      html += renderBreakdownCard("大便性状", renderCountMapRows(breakdown.textureCounts));
    }
    els.diaperBreakdown.innerHTML = html;
  }

  function renderExcludedIntervals(summaries) {
    var excluded = summaries.reduce(function (all, summary) {
      return all.concat(summary.excludedIntervals.map(function (interval) {
        return {
          cutoffMinutes: summary.cutoffMinutes,
          current: interval.current,
          label: summary.label,
          minutes: interval.minutes,
          previous: interval.previous
        };
      }));
    }, []);

    if (!excluded.length) {
      els.excludedIntervals.innerHTML = '<div class="empty-state">没有发现疑似漏记的过长间隔。</div>';
      return;
    }

    els.excludedIntervals.innerHTML = excluded.map(function (item) {
      return '<article class="excluded-item">' +
        "<strong>" + escapeHtml(item.label + " · " + formatDateTimeShort(item.previous.time) + " → " + formatDateTimeShort(item.current.time)) + "</strong>" +
        '<span class="excluded-meta">' +
        escapeHtml("间隔 " + formatMinuteCount(item.minutes) + " · 剔除上限 " + formatMinuteCount(item.cutoffMinutes)) +
        "</span>" +
        "</article>";
    }).join("");
  }

  function renderMiniCard(title, value, lines) {
    return '<article class="mini-card"><h3>' +
      escapeHtml(title) +
      "</h3><strong>" +
      escapeHtml(value) +
      "</strong>" +
      lines.map(function (line) {
        return "<span>" + escapeHtml(line) + "</span>";
      }).join("") +
      "</article>";
  }

  function renderExtraCard(title, value) {
    return '<article class="feed-extra-card"><h3>' +
      escapeHtml(title) +
      "</h3><p>" +
      escapeHtml(value) +
      "</p></article>";
  }

  function renderBreakdownCard(title, bodyHtml) {
    return '<article class="breakdown-card"><h3>' +
      escapeHtml(title) +
      "</h3>" +
      bodyHtml +
      "</article>";
  }

  function renderBarCard(title, rows) {
    return '<article class="chart-card"><h3>' +
      escapeHtml(title) +
      '</h3><div class="bar-list">' +
      renderBarRows(rows) +
      "</div></article>";
  }

  function renderBarRows(rows) {
    var maxCount = Math.max.apply(null, rows.map(function (row) {
      return row.count;
    }).concat([0]));
    return rows.map(function (row) {
      var percent = maxCount ? Math.round(row.count / maxCount * 100) : 0;
      return '<div class="bar-row">' +
        '<span class="bar-label">' + escapeHtml(row.label) + "</span>" +
        '<div class="bar-track"><div class="bar-fill' + (row.count ? "" : " zero") + '" style="--value: ' + percent + '%"></div></div>' +
        '<span class="bar-value">' + escapeHtml(row.value) + "</span>" +
        "</div>";
    }).join("");
  }

  function renderRatioRows(rows) {
    var total = rows.reduce(function (sum, row) {
      return sum + row.count;
    }, 0);
    if (!total) {
      return '<p class="analysis-hint">暂无记录</p>';
    }
    return '<div class="ratio-grid">' + rows.map(function (row) {
      var percent = Math.round(row.count / total * 100);
      return '<div class="bar-row">' +
        '<span class="bar-label">' + escapeHtml(row.label) + "</span>" +
        '<div class="bar-track"><div class="bar-fill" style="--value: ' + percent + '%"></div></div>' +
        '<span class="bar-value">' + row.count + "</span>" +
        "</div>";
    }).join("") + "</div>";
  }

  function renderDailyValueRows(rows, unit) {
    if (!rows.length) {
      return '<p class="analysis-hint">暂无记录</p>';
    }
    return '<div class="ratio-grid">' + renderBarRows(rows.map(function (row) {
      return {
        count: row.value,
        label: formatShortDate(row.dateKey),
        value: row.value + " " + unit
      };
    })) + "</div>";
  }

  function renderBreastDurationRows(rows) {
    if (!rows.length) {
      return '<p class="analysis-hint">暂无记录</p>';
    }
    return '<div class="ratio-grid">' + rows.map(function (row) {
      return '<p>' +
        escapeHtml(formatShortDate(row.dateKey) + "：左 " + formatTotalMinutes(row.left) + " · 右 " + formatTotalMinutes(row.right) + " · 两侧 " + formatTotalMinutes(row.both)) +
        "</p>";
    }).join("") + "</div>";
  }

  function renderCountMapRows(countMap) {
    var rows = Object.keys(countMap).map(function (key) {
      return {
        count: countMap[key],
        label: key,
        value: String(countMap[key])
      };
    }).filter(function (row) {
      return row.count > 0;
    });
    if (!rows.length) {
      return '<p class="analysis-hint">暂无记录</p>';
    }
    return '<div class="ratio-grid">' + renderBarRows(rows) + "</div>";
  }

  function buildPattern(label, records, coverageDays, trendSummary, intervalSummary) {
    var bucketCounts = bucketCountsFor(records);
    var peakBucket = peakBucketText(bucketCounts);
    var latestRecord = records[records.length - 1];

    return {
      averageDaily: formatAverage(records.length, coverageDays) + " 次/天",
      bucketCounts: bucketCounts,
      halfAverages: trendSummary.firstHalfText + " / " + trendSummary.secondHalfText,
      insight: patternInsight(label, records.length, peakBucket, intervalSummary.typicalInterval, intervalSummary.excludedIntervals.length),
      label: label,
      latestText: latestRecord ? formatLatest(latestRecord.time) : "--",
      medianInterval: intervalSummary.medianInterval,
      nextWindow: intervalSummary.nextWindow,
      peakBucket: peakBucket,
      recent3Average: trendSummary.recent3Text,
      trendText: trendSummary.trendText,
      typicalInterval: intervalSummary.typicalInterval
    };
  }

  function patternInsight(label, count, peakBucket, typicalInterval, excludedCount) {
    if (!count) {
      return "暂无" + label + "记录。";
    }
    if (count < 2) {
      return "只有 1 次" + label + "记录，暂无法判断间隔规律。";
    }
    return label + "多出现在 " + peakBucket + "，清洗后典型间隔 " + typicalInterval + "。" +
      (excludedCount ? "已排除 " + excludedCount + " 段疑似漏记间隔。" : "");
  }

  function buildTrendSummary(label, dailyRows, key) {
    var values = dailyRows.map(function (row) {
      return Number(row[key]) || 0;
    });
    var recent3 = average(values.slice(-3));
    var maxIndex = indexOfExtreme(values, "max");
    var minIndex = indexOfExtreme(values, "min");
    var firstHalf = [];
    var secondHalf = [];
    var trendText = "天数较少，暂不判断趋势";

    if (values.length >= 4) {
      var splitIndex = Math.floor(values.length / 2);
      firstHalf = values.slice(0, splitIndex);
      secondHalf = values.slice(splitIndex);
      trendText = compareAverages(average(firstHalf), average(secondHalf));
    }

    return {
      firstHalfText: firstHalf.length ? formatDecimal(average(firstHalf)) + " 次/天" : "--",
      label: label,
      maxText: maxIndex >= 0 ? formatShortDate(dailyRows[maxIndex].dateKey) + " " + values[maxIndex] + " 次" : "--",
      minText: minIndex >= 0 ? formatShortDate(dailyRows[minIndex].dateKey) + " " + values[minIndex] + " 次" : "--",
      recent3Text: formatDecimal(recent3) + " 次/天",
      secondHalfText: secondHalf.length ? formatDecimal(average(secondHalf)) + " 次/天" : "--",
      trendText: trendText
    };
  }

  function compareAverages(firstAverage, secondAverage) {
    var diff = secondAverage - firstAverage;
    var relative = Math.abs(diff) / Math.max(Math.abs(firstAverage), 0.1);
    if (Math.abs(diff) >= 0.5 && relative >= 0.2) {
      return diff > 0 ? "后半段比前半段增多" : "后半段比前半段减少";
    }
    return "前后基本接近";
  }

  function buildIntervalSummary(label, records) {
    var rawIntervals = buildIntervalObjects(records);
    var split = splitUsableIntervals(rawIntervals);
    var values = split.usableIntervals.map(function (interval) {
      return interval.minutes;
    }).sort(numberAsc);
    var latest = records[records.length - 1];

    return {
      cleaningText: split.cleaningText,
      cutoffMinutes: split.cutoffMinutes,
      excludedIntervals: split.excludedIntervals,
      intervalBucketCounts: buildIntervalBuckets(values),
      label: label,
      latestText: latest ? formatLatest(latest.time) : "--",
      maxInterval: values.length ? formatMinuteCount(values[values.length - 1]) : "--",
      medianInterval: values.length ? formatMinuteCount(median(values)) : "--",
      minInterval: values.length ? formatMinuteCount(values[0]) : "--",
      nextWindow: buildNextWindow(records, values),
      nextWindowNote: nextWindowNote(records, values),
      rawIntervals: rawIntervals,
      typicalInterval: typicalIntervalText(values),
      usableIntervals: split.usableIntervals
    };
  }

  function buildIntervalObjects(records) {
    return records.map(function (record, index) {
      if (index === 0) {
        return null;
      }
      return {
        current: record,
        minutes: intervalMinutes(records[index - 1].time, record.time),
        previous: records[index - 1]
      };
    }).filter(Boolean);
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

  function splitUsableIntervals(intervals) {
    if (intervals.length < 4) {
      return {
        cleaningText: "样本较少，未做长间隔剔除",
        cutoffMinutes: 0,
        excludedIntervals: [],
        usableIntervals: intervals.slice()
      };
    }

    var values = intervals.map(function (interval) {
      return interval.minutes;
    }).sort(numberAsc);
    var q1 = percentile(values, 0.25);
    var q3 = percentile(values, 0.75);
    var cutoff = Math.round(q3 + 1.5 * (q3 - q1));
    var usable = [];
    var excluded = [];

    intervals.forEach(function (interval) {
      if (interval.minutes > cutoff) {
        excluded.push(interval);
      } else {
        usable.push(interval);
      }
    });

    return {
      cleaningText: excluded.length ?
        "已剔除 " + excluded.length + " 段疑似漏记长间隔" :
        "未发现疑似漏记长间隔",
      cutoffMinutes: cutoff,
      excludedIntervals: excluded,
      usableIntervals: usable
    };
  }

  function buildIntervalBuckets(values) {
    return INTERVAL_BUCKETS.map(function (bucket) {
      return values.filter(function (minutes) {
        return minutes >= bucket.min && minutes < bucket.max;
      }).length;
    });
  }

  function buildNextWindow(records, intervalValues) {
    if (records.length < 2 || intervalValues.length < 3) {
      return "样本不足";
    }
    var latest = records[records.length - 1];
    return formatWindow(latest.time, percentile(intervalValues, 0.25), percentile(intervalValues, 0.75));
  }

  function nextWindowNote(records, intervalValues) {
    if (!records.length) {
      return "暂无记录，暂不能推算。";
    }
    if (records.length < 2) {
      return "只有 1 条记录，暂不能推算间隔。";
    }
    if (intervalValues.length < 3) {
      return "有效间隔少于 3 段，暂不生成参考窗口。";
    }
    return "按清洗后的 P25-P75 间隔推算，仅作历史参考。";
  }

  function buildDailyMetrics(dateRange, records, feedSessions) {
    if (!dateRange.firstDateKey) {
      return [];
    }

    var rows = dateKeysBetween(dateRange.firstDateKey, dateRange.lastDateKey).map(function (dateKey) {
      return {
        breastBothMin: 0,
        breastLeftMin: 0,
        breastRightMin: 0,
        breastUnknownMin: 0,
        dateKey: dateKey,
        feedCount: 0,
        feedRecordCount: 0,
        mixedCount: 0,
        otherFeedCount: 0,
        otherMilkMl: 0,
        peeCount: 0,
        poopCount: 0
      };
    });
    var byDate = {};
    rows.forEach(function (row) {
      byDate[row.dateKey] = row;
    });

    records.forEach(function (record) {
      var row = byDate[dateKeyFromIso(record.time)];
      if (!row) {
        return;
      }

      if (isFeed(record)) {
        addFeedToDailyRow(row, record);
      } else if (isDiaper(record)) {
        addDiaperToDailyRow(row, record);
      }
    });

    (feedSessions || []).forEach(function (session) {
      var row = byDate[dateKeyFromIso(session.time)];
      if (row) {
        row.feedCount += 1;
      }
    });

    addMovingAverages(rows, "feedCount", "feedMovingAverage");
    addMovingAverages(rows, "peeCount", "peeMovingAverage");
    addMovingAverages(rows, "poopCount", "poopMovingAverage");
    return rows;
  }

  function addFeedToDailyRow(row, record) {
    var feed = record.feed || {};
    var method = normalizeFeedMethod(feed.method);
    row.feedRecordCount += 1;
    if (method !== "breast") {
      row.otherFeedCount += 1;
      row.otherMilkMl += Number(feed.amountMl) || 0;
      return;
    }
    if (feed.status === "active") {
      return;
    }
    var duration = Number(feed.durationMin);
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    if (feed.side === "left") {
      row.breastLeftMin += duration;
    } else if (feed.side === "right") {
      row.breastRightMin += duration;
    } else if (feed.side === "both") {
      row.breastBothMin += duration;
    } else {
      row.breastUnknownMin += duration;
    }
  }

  function addDiaperToDailyRow(row, record) {
    var kind = record.diaper && record.diaper.kind;
    if (kind === "pee") {
      row.peeCount += 1;
    } else if (kind === "poop") {
      row.poopCount += 1;
    } else if (kind === "mixed") {
      row.peeCount += 1;
      row.poopCount += 1;
      row.mixedCount += 1;
    }
  }

  function addMovingAverages(rows, sourceKey, outputKey) {
    rows.forEach(function (row, index) {
      var start = Math.max(0, index - 2);
      var slice = rows.slice(start, index + 1);
      row[outputKey] = average(slice.map(function (item) {
        return item[sourceKey];
      }));
    });
  }

  function buildTimeHeatmap(label, dateRange, records) {
    var rows = dateRange.firstDateKey ? dateKeysBetween(dateRange.firstDateKey, dateRange.lastDateKey).map(function (dateKey) {
      return {
        counts: TIME_BUCKETS.map(function () { return 0; }),
        dateKey: dateKey
      };
    }) : [];
    var byDate = {};
    rows.forEach(function (row) {
      byDate[row.dateKey] = row;
    });
    records.forEach(function (record) {
      var row = byDate[dateKeyFromIso(record.time)];
      if (row) {
        row.counts[bucketIndexFor(record.time)] += 1;
      }
    });
    return {
      label: label,
      rows: rows
    };
  }

  function buildFeedExtra(feedRecords, coverageDays) {
    var breastTotals = {
      both: 0,
      left: 0,
      right: 0,
      unknown: 0
    };
    var activeBreastCount = 0;
    var otherFeedCount = 0;
    var otherMilkMl = 0;

    feedRecords.forEach(function (record) {
      var feed = record.feed || {};
      var method = normalizeFeedMethod(feed.method);
      if (method === "breast") {
        if (feed.status === "active") {
          activeBreastCount += 1;
          return;
        }

        var duration = Number(feed.durationMin);
        if (!Number.isFinite(duration) || duration <= 0) {
          return;
        }

        if (feed.side === "left") {
          breastTotals.left += duration;
        } else if (feed.side === "right") {
          breastTotals.right += duration;
        } else if (feed.side === "both") {
          breastTotals.both += duration;
        } else {
          breastTotals.unknown += duration;
        }
        return;
      }

      otherFeedCount += 1;
      otherMilkMl += Number(feed.amountMl) || 0;
    });

    return {
      activeBreastCount: activeBreastCount,
      averageOtherMilkMl: coverageDays ? Math.round(otherMilkMl / coverageDays) : 0,
      breastTotals: breastTotals,
      otherFeedCount: otherFeedCount,
      otherMilkMl: otherMilkMl
    };
  }

  function buildFeedBreakdown(feedRecords, dailyRows) {
    var breastCount = 0;
    var otherCount = 0;
    feedRecords.forEach(function (record) {
      if (normalizeFeedMethod(record.feed && record.feed.method) === "breast") {
        breastCount += 1;
      } else {
        otherCount += 1;
      }
    });

    return {
      breastCount: breastCount,
      breastDurationRows: dailyRows.map(function (row) {
        return {
          both: row.breastBothMin,
          dateKey: row.dateKey,
          left: row.breastLeftMin,
          right: row.breastRightMin,
          unknown: row.breastUnknownMin
        };
      }).filter(function (row) {
        return row.left || row.right || row.both || row.unknown;
      }),
      otherCount: otherCount,
      otherMilkRows: dailyRows.map(function (row) {
        return {
          dateKey: row.dateKey,
          value: row.otherMilkMl
        };
      }).filter(function (row) {
        return row.value > 0;
      })
    };
  }

  function buildDiaperBreakdown(diaperRecords) {
    var kindCounts = {
      pee: 0,
      poop: 0,
      mixed: 0
    };
    var amountCounts = {};
    var colorCounts = {};
    var textureCounts = {};

    diaperRecords.forEach(function (record) {
      var diaper = record.diaper || {};
      var kind = diaper.kind || "pee";
      if (kindCounts[kind] >= 0) {
        kindCounts[kind] += 1;
      }
      incrementCount(amountCounts, labelFor("diaperAmount", diaper.amount));
      if (kind === "poop" || kind === "mixed") {
        incrementCount(colorCounts, labelFor("poopColor", diaper.poopColor));
        incrementCount(textureCounts, labelFor("poopTexture", diaper.poopTexture));
      }
    });

    return {
      amountCounts: amountCounts,
      colorCounts: colorCounts,
      kindCounts: kindCounts,
      textureCounts: textureCounts
    };
  }

  function buildDailyValueRows(rows, key) {
    return rows.map(function (row) {
      return {
        dateKey: row.dateKey,
        value: row[key] || 0
      };
    });
  }

  function bucketCountsFor(records) {
    var counts = TIME_BUCKETS.map(function () {
      return 0;
    });
    records.forEach(function (record) {
      counts[bucketIndexFor(record.time)] += 1;
    });
    return counts;
  }

  function bucketIndexFor(iso) {
    var hour = Number(shanghaiInputFromIso(iso).slice(11, 13));
    return Math.min(TIME_BUCKETS.length - 1, Math.floor(hour / 3));
  }

  function peakBucketText(counts) {
    var maxCount = Math.max.apply(null, counts.concat([0]));
    if (!maxCount) {
      return "--";
    }
    return TIME_BUCKETS[counts.indexOf(maxCount)].label;
  }

  function typicalIntervalText(values) {
    if (!values.length) {
      return "--";
    }
    var low = percentile(values, 0.25);
    var high = percentile(values, 0.75);
    if (low === high) {
      return formatMinuteCount(low);
    }
    return formatMinuteCount(low) + " - " + formatMinuteCount(high);
  }

  function getDateRange(records, range) {
    if (range && range.startDateKey && range.endDateKey) {
      return {
        coverageDays: daySpan(range.startDateKey, range.endDateKey),
        firstDateKey: range.startDateKey,
        lastDateKey: range.endDateKey,
        recordedDays: unique(records.map(function (record) {
          return dateKeyFromIso(record.time);
        })).length
      };
    }

    if (!records.length) {
      return {
        coverageDays: 0,
        firstDateKey: "",
        lastDateKey: "",
        recordedDays: 0
      };
    }

    var dateKeys = unique(records.map(function (record) {
      return dateKeyFromIso(record.time);
    })).sort();

    return {
      coverageDays: daySpan(dateKeys[0], dateKeys[dateKeys.length - 1]),
      firstDateKey: dateKeys[0],
      lastDateKey: dateKeys[dateKeys.length - 1],
      recordedDays: dateKeys.length
    };
  }

  function dateKeysBetween(firstDateKey, lastDateKey) {
    var keys = [];
    var start = dateKeyToUtcMs(firstDateKey);
    var end = dateKeyToUtcMs(lastDateKey);
    for (var time = start; time <= end; time += 86400000) {
      keys.push(utcMsToDateKey(time));
    }
    return keys;
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

  function cleanRecord(record) {
    var output = {
      feed: record.feed ? pruneEmpty(record.feed) : undefined,
      id: record.id || "",
      time: record.time || "",
      type: record.type || ""
    };

    if (record.diaper) {
      output.diaper = pruneEmpty(record.diaper);
    }

    if (output.feed) {
      output.feed.method = normalizeFeedMethod(output.feed.method);
    }

    return output;
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

  function isFeed(record) {
    return record.type === "feed";
  }

  function isDiaper(record) {
    return record.type === "diaper";
  }

  function hasDiaperKind(record, kind) {
    return isDiaper(record) && record.diaper && record.diaper.kind === kind;
  }

  function normalizeFeedMethod(method) {
    if (method === "breast" || method === "bottle" || method === "formula" || method === "pumped" || method === "other") {
      return method;
    }
    return "other";
  }

  function compareByTime(a, b) {
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  }

  function average(values) {
    if (!values.length) {
      return 0;
    }
    return values.reduce(function (sum, value) {
      return sum + (Number(value) || 0);
    }, 0) / values.length;
  }

  function median(values) {
    if (!values.length) {
      return 0;
    }
    var sorted = values.slice().sort(numberAsc);
    var middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2) {
      return sorted[middle];
    }
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function percentile(values, ratio) {
    if (!values.length) {
      return 0;
    }
    var sorted = values.slice().sort(numberAsc);
    var index = Math.round((sorted.length - 1) * ratio);
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  }

  function indexOfExtreme(values, mode) {
    if (!values.length) {
      return -1;
    }
    var target = mode === "max" ? Math.max.apply(null, values) : Math.min.apply(null, values);
    return values.indexOf(target);
  }

  function numberAsc(a, b) {
    return a - b;
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      if (seen[value]) {
        return false;
      }
      seen[value] = true;
      return true;
    });
  }

  function incrementCount(map, key) {
    if (!key) {
      return;
    }
    map[key] = (map[key] || 0) + 1;
  }

  function sumMap(map) {
    return Object.keys(map).reduce(function (sum, key) {
      return sum + map[key];
    }, 0);
  }

  function labelFor(group, value) {
    if (!value) {
      return "";
    }
    return (labels[group] && labels[group][value]) || value;
  }

  function heatmapLevel(count, maxCount) {
    if (!count || !maxCount) {
      return "";
    }
    var ratio = count / maxCount;
    if (ratio <= 0.34) {
      return "level-1";
    }
    if (ratio <= 0.67) {
      return "level-2";
    }
    return "level-3";
  }

  function formatAverage(count, days) {
    if (!days) {
      return "0";
    }
    var value = count / days;
    return value >= 10 || value === Math.round(value) ? String(Math.round(value)) : value.toFixed(1);
  }

  function formatDecimal(value) {
    var number = Number(value) || 0;
    return number >= 10 || number === Math.round(number) ? String(Math.round(number)) : number.toFixed(1);
  }

  function formatLatest(iso) {
    return formatDateTitle(dateKeyFromIso(iso)) + " " + formatTime(iso);
  }

  function formatDateTimeShort(iso) {
    return formatShortDate(dateKeyFromIso(iso)) + " " + formatTime(iso);
  }

  function formatDateRange(firstDateKey, lastDateKey) {
    if (!firstDateKey || !lastDateKey) {
      return "--";
    }
    if (firstDateKey === lastDateKey) {
      return formatDateTitle(firstDateKey);
    }
    return formatShortDate(firstDateKey) + " - " + formatShortDate(lastDateKey);
  }

  function formatShortDate(dateKey) {
    var parts = dateKey.split("-");
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  function formatWindow(latestIso, lowMinutes, highMinutes) {
    var start = addMinutes(latestIso, lowMinutes);
    var end = addMinutes(latestIso, highMinutes);
    if (dateKeyFromIso(start) === dateKeyFromIso(end)) {
      return formatDateTitle(dateKeyFromIso(start)) + " " + formatTime(start) + " - " + formatTime(end);
    }
    return formatDateTimeShort(start) + " - " + formatDateTimeShort(end);
  }

  function intervalMinutes(previousIso, currentIso) {
    return Math.max(0, Math.round((new Date(currentIso).getTime() - new Date(previousIso).getTime()) / 60000));
  }

  function formatAmount(value) {
    return (Number(value) || 0) + " ml";
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(iso));
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

  function daySpan(firstDateKey, lastDateKey) {
    var first = dateKeyToUtcMs(firstDateKey);
    var last = dateKeyToUtcMs(lastDateKey);
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      return 0;
    }
    return Math.floor((last - first) / 86400000) + 1;
  }

  function addDays(dateKey, days) {
    return utcMsToDateKey(dateKeyToUtcMs(dateKey) + days * 86400000);
  }

  function addMinutes(iso, minutes) {
    return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
  }

  function dateKeyFromIso(iso) {
    return shanghaiInputFromIso(iso).slice(0, 10);
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

  function dateKeyToUtcMs(dateKey) {
    var parts = String(dateKey || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return !Number.isFinite(part); })) {
      return NaN;
    }
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function utcMsToDateKey(utcMs) {
    var date = new Date(utcMs);
    return [
      date.getUTCFullYear(),
      pad2(date.getUTCMonth() + 1),
      pad2(date.getUTCDate())
    ].join("-");
  }

  function formatMinuteCount(minutes) {
    var safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
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

  function pad2(value) {
    return String(value).padStart(2, "0");
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

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2200);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    navigator.serviceWorker.register("sw.js?v=29").catch(function () {
      showToast("离线缓存暂不可用");
    });
  }
})();

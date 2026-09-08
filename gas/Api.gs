/**
 * WebApp から google.script.run で呼ぶ API。
 * 例外はそのまま投げる（クライアントの withFailureHandler が受ける）。
 */

var HEATMAP_DAYS = 56;      // 8 週
var NEW_CARD_SHARE = 0.25;  // 1 セッションのうち新規カードに確保する割合

/** UI が使う選択肢や既定値をまとめて返す */
function api_getMeta() {
  return {
    types: TYPES,
    posByType: POS_BY_TYPE,
    statusLabels: STATUS_LABELS,
    settings: readSettings(),
    today: todayStr_()
  };
}

// ---------------------------------------------------------------- Dashboard

function api_getDashboard() {
  var today = todayStr_();
  var settings = readSettings();
  var items = readAllItems(false);
  var logs = readReviewLog_();

  var due = 0, newAvail = 0, unfilled = 0, suspended = 0;
  items.forEach(function (it) {
    if (!hasMeaning(it)) { unfilled++; return; }
    if (it.status === STATUS.SUSPENDED) { suspended++; return; }
    if (it.status === STATUS.NEW) { newAvail++; return; }
    if (it.due_date && diffDays(it.due_date, today) <= 0) due++;
  });

  var introducedToday = countNewIntroducedToday_(logs, today);
  var newQuota = Math.max(0, toNumber(settings.daily_new_limit, 20) - introducedToday);

  return {
    dueCount: Math.min(due, toNumber(settings.daily_review_limit, 100)),
    dueTotal: due,
    newCount: Math.min(newAvail, newQuota),
    newAvailable: newAvail,
    unfilledCount: unfilled,
    suspendedCount: suspended,
    totalCount: items.length,
    streak: calcStreak_(logs, today),
    heatmap: buildHeatmap_(logs, today),
    reviewedToday: countOnDate_(logs, today),
    settings: settings
  };
}

/** Reviews から item_id と日付だけを読む */
function readReviewLog_() {
  var sh = getSheet_(SHEET.REVIEWS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var startCol = REVIEW_COLUMNS.indexOf('item_id') + 1;   // item_id と reviewed_at は隣接
  var values = sh.getRange(2, startCol, last - 1, 2).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var d = toDateStr(values[i][1]);
    if (d) out.push({ item_id: String(values[i][0] || ''), date: d });
  }
  return out;
}

/** その日に「初めて復習されたアイテム」の数＝新規に着手した数 */
function countNewIntroducedToday_(logs, today) {
  var firstSeen = {};
  for (var i = 0; i < logs.length; i++) {
    var l = logs[i];
    if (!l.item_id) continue;
    if (!firstSeen[l.item_id] || l.date < firstSeen[l.item_id]) firstSeen[l.item_id] = l.date;
  }
  var n = 0;
  Object.keys(firstSeen).forEach(function (k) { if (firstSeen[k] === today) n++; });
  return n;
}

function countOnDate_(logs, date) {
  var n = 0;
  for (var i = 0; i < logs.length; i++) if (logs[i].date === date) n++;
  return n;
}

function calcStreak_(logs, today) {
  var days = {};
  for (var i = 0; i < logs.length; i++) days[logs[i].date] = true;
  // 今日まだやっていなくても昨日まで続いていれば途切れていないとみなす
  var cursor = days[today] ? today : addDays(today, -1);
  var streak = 0;
  while (days[cursor]) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function buildHeatmap_(logs, today) {
  var counts = {};
  for (var i = 0; i < logs.length; i++) {
    counts[logs[i].date] = (counts[logs[i].date] || 0) + 1;
  }
  var out = [];
  for (var d = HEATMAP_DAYS - 1; d >= 0; d--) {
    var date = addDays(today, -d);
    out.push({ date: date, count: counts[date] || 0 });
  }
  return out;
}

// ---------------------------------------------------------------- Review

var REVIEW_CARD_FIELDS = [
  'id', 'type', 'text', 'phonetic', 'pos', 'meaning_ja', 'meaning_en',
  'usage_note', 'example', 'example_ja', 'source_url', 'source_context',
  'status', 'due_date', 'interval', 'ease', 'reps', 'lapses', 'encounter_count'
];

/**
 * 出題対象を一括で返す（要件 §5.3）。
 *   1. 期限切れ … due_date の古い順
 *   2. 本日期限 … encounter_count の多い順
 *   3. 新規     … encounter_count 多い順 → created_at 古い順（daily_new_limit まで）
 */
function api_getReviewSession(opts) {
  opts = opts || {};
  var today = todayStr_();
  var settings = readSettings();
  var logs = readReviewLog_();
  var items = readAllItems(false).filter(function (it) {
    return hasMeaning(it) && it.status !== STATUS.SUSPENDED;
  });

  var overdue = [], dueToday = [], fresh = [];
  items.forEach(function (it) {
    if (it.status === STATUS.NEW) { fresh.push(it); return; }
    if (!it.due_date) return;
    var d = diffDays(it.due_date, today);
    if (d < 0) overdue.push(it);
    else if (d === 0) dueToday.push(it);
  });

  overdue.sort(function (a, b) {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return b.encounter_count - a.encounter_count;
  });
  dueToday.sort(function (a, b) { return b.encounter_count - a.encounter_count; });
  fresh.sort(function (a, b) {
    if (b.encounter_count !== a.encounter_count) return b.encounter_count - a.encounter_count;
    return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
  });

  var reviewLimit = toNumber(settings.daily_review_limit, 100);
  var newQuota = Math.max(0, toNumber(settings.daily_new_limit, 20) - countNewIntroducedToday_(logs, today));
  var sessionSize = toNumber(opts.limit, toNumber(settings.session_size, 20));

  var dueAvail = Math.min(overdue.length + dueToday.length, reviewLimit);
  var newAvail = Math.min(fresh.length, newQuota);

  // 復習の滞留で新規が永久に出なくならないよう、セッションの一定割合を新規に確保する。
  // 復習が少ない日はその枠を新規で埋め、新規がない日は全部復習に回す。
  var newSlots = Math.min(newAvail, Math.max(1, Math.round(sessionSize * NEW_CARD_SHARE)));
  var reviewSlots = Math.min(dueAvail, sessionSize - newSlots);
  newSlots = Math.min(newAvail, sessionSize - reviewSlots);

  var dueQueue = overdue.concat(dueToday).slice(0, reviewSlots);
  var newQueue = fresh.slice(0, newSlots);
  var queue = interleave_(dueQueue, newQueue);

  return {
    today: today,
    cards: queue.map(function (it) {
      var card = {};
      REVIEW_CARD_FIELDS.forEach(function (f) { card[f] = it[f]; });
      card.preview = previewIntervals(it, today);
      card.isNew = (it.status === STATUS.NEW);
      return card;
    }),
    remaining: {
      review: Math.max(0, dueAvail - dueQueue.length),
      fresh: Math.max(0, newAvail - newQueue.length)
    }
  };
}

/**
 * 少ない方（新規）を多い方（復習）の中に均等に散らす。
 * 新規がセッション末尾に固まると、途中でやめたときに新規だけ残るため。
 */
function interleave_(base, extra) {
  if (!extra.length) return base.slice();
  if (!base.length) return extra.slice();
  var out = [];
  var step = (base.length + extra.length) / extra.length;
  var bi = 0, ei = 0, next = step - 1;
  for (var i = 0; i < base.length + extra.length; i++) {
    if (ei < extra.length && i >= Math.round(next)) {
      out.push(extra[ei++]);
      next += step;
    } else if (bi < base.length) {
      out.push(base[bi++]);
    } else {
      out.push(extra[ei++]);
    }
  }
  return out;
}

/**
 * 回答をまとめて反映する。
 * 同一アイテムが複数回（Again → Good）含まれる場合は順に適用し、最終状態を 1 回だけ書く。
 */
function api_submitReviews(payload) {
  var results = (payload && payload.results) || [];
  if (!results.length) return { ok: true, updated: 0 };

  return withLock_(function () {
    var today = todayStr_();
    var now = nowIso_();
    var all = readAllItems(true);
    var byId = {};
    all.forEach(function (it) { byId[it.id] = it; });

    var touched = {};
    var logs = [];

    results.forEach(function (r) {
      var item = byId[r.item_id];
      if (!item) return;
      var grade = toNumber(r.grade, -1);
      if ([GRADE.AGAIN, GRADE.HARD, GRADE.GOOD, GRADE.EASY].indexOf(grade) === -1) return;

      var prevInterval = item.interval;
      var next = schedule(item, grade, today);

      item.ease = next.ease;
      item.interval = next.interval;
      item.reps = next.reps;
      item.lapses = next.lapses;
      item.due_date = next.due_date;
      item.status = next.status;
      item.last_reviewed_at = now;
      item.updated_at = now;
      touched[item.id] = item;

      logs.push({
        log_id: uuid_(),
        item_id: item.id,
        reviewed_at: today,
        grade: grade,
        mode: r.mode || 'flashcard',
        elapsed_ms: toNumber(r.elapsed_ms, 0),
        prev_interval: prevInterval,
        new_interval: next.interval
      });
    });

    var changed = Object.keys(touched).map(function (k) { return touched[k]; });
    writeItemRows_(changed);
    appendReviewLogs_(logs);
    return { ok: true, updated: changed.length, logged: logs.length };
  });
}

// ---------------------------------------------------------------- Library

var LIST_FIELDS = ['id', 'text', 'meaning_ja', 'type', 'pos', 'status',
                   'due_date', 'encounter_count', 'created_at'];

function api_listItems(q) {
  q = q || {};
  var includeDeleted = q.status === STATUS.DELETED;
  var items = readAllItems(includeDeleted);
  var today = todayStr_();

  if (q.status) {
    items = items.filter(function (it) { return it.status === q.status; });
  }
  if (q.type) items = items.filter(function (it) { return it.type === q.type; });
  if (q.pos) items = items.filter(function (it) { return it.pos === q.pos; });
  if (q.unfilledOnly) items = items.filter(function (it) { return !hasMeaning(it); });

  var query = String(q.query || '').trim().toLowerCase();
  if (query) {
    items = items.filter(function (it) {
      return ['text', 'meaning_ja', 'meaning_en', 'usage_note', 'example', 'example_ja']
        .some(function (f) { return String(it[f] || '').toLowerCase().indexOf(query) !== -1; });
    });
  }

  var sort = q.sort || 'created_desc';
  items.sort(function (a, b) {
    switch (sort) {
      case 'created_asc':  return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
      case 'due_asc':      return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1;
      case 'encounter_desc': return b.encounter_count - a.encounter_count;
      case 'text_asc':     return a.lemma < b.lemma ? -1 : 1;
      default:             return (a.created_at || '') > (b.created_at || '') ? -1 : 1;
    }
  });

  var total = items.length;
  var offset = toNumber(q.offset, 0);
  var limit = toNumber(q.limit, 500);
  var page = items.slice(offset, offset + limit);

  return {
    total: total,
    offset: offset,
    items: page.map(function (it) {
      var o = {};
      LIST_FIELDS.forEach(function (f) { o[f] = it[f]; });
      o.filled = hasMeaning(it);
      o.overdue = !!(it.due_date && diffDays(it.due_date, today) < 0);
      return o;
    })
  };
}

function api_getItem(id) {
  var it = findItemById(id, true);
  if (!it) throw new Error('見つかりません: ' + id);
  delete it._row;
  return it;
}

/** 未整備（意味が空）のアイテム。遭遇回数の多い順 → 古い順 */
function api_getUnfilled(limit) {
  var items = readAllItems(false).filter(function (it) { return !hasMeaning(it); });
  items.sort(function (a, b) {
    if (b.encounter_count !== a.encounter_count) return b.encounter_count - a.encounter_count;
    return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
  });
  var n = toNumber(limit, 50);
  return {
    total: items.length,
    items: items.slice(0, n).map(function (it) { delete it._row; return it; })
  };
}

// ---------------------------------------------------------------- Write

var EDITABLE_FIELDS = ['type', 'text', 'phonetic', 'pos', 'meaning_ja', 'meaning_en',
                       'usage_note', 'example', 'example_ja', 'source_url'];

/**
 * 新規登録または更新。
 * id なし かつ lemma が既存と一致 → 新規作成せずマージ（要件 §4.5）。
 */
function api_upsertItem(payload) {
  payload = payload || {};
  var text = String(payload.text || '').trim();
  if (!text) throw new Error('英語表現を入力してください。');

  return withLock_(function () {
    var now = nowIso_();
    var lemma = normalizeLemma(text);

    if (payload.id) {
      var item = findItemById(payload.id, true);
      if (!item) throw new Error('見つかりません: ' + payload.id);
      var hadMeaning = hasMeaning(item);

      EDITABLE_FIELDS.forEach(function (f) {
        if (payload[f] !== undefined && payload[f] !== null) item[f] = String(payload[f]).trim();
      });
      item.text = text;
      item.lemma = lemma;
      if (!item.type || TYPES.map(function (t) { return t.value; }).indexOf(item.type) === -1) {
        item.type = detectType(text);
      }
      item.pos = sanitizePos(item.type, item.pos);
      // 意味が入った瞬間に復習対象へ入れる
      if (!hadMeaning && hasMeaning(item) && item.status === STATUS.NEW && !item.due_date) {
        item.due_date = todayStr_();
      }
      item.updated_at = now;
      writeItemRow_(item);
      delete item._row;
      return { item: item, merged: false, created: false };
    }

    var existing = findItemByLemma(lemma, false);
    if (existing) {
      existing.encounter_count = toNumber(existing.encounter_count, 0) + 1;
      if (payload.source_context) {
        existing.source_context = appendContext(existing.source_context, payload.source_context);
      }
      if (payload.source_url && !existing.source_url) existing.source_url = String(payload.source_url);
      // 空欄だけを埋める。既存の入力は上書きしない
      EDITABLE_FIELDS.forEach(function (f) {
        if (f === 'text' || f === 'type') return;
        if (payload[f] && !String(existing[f] || '').trim()) existing[f] = String(payload[f]).trim();
      });
      existing.pos = sanitizePos(existing.type, existing.pos);
      existing.updated_at = now;
      writeItemRow_(existing);
      delete existing._row;
      return { item: existing, merged: true, created: false };
    }

    var type = payload.type && POS_BY_TYPE[payload.type] ? payload.type : detectType(text);
    var created = {
      id: uuid_(),
      type: type,
      text: text,
      lemma: lemma,
      phonetic: String(payload.phonetic || '').trim(),
      pos: sanitizePos(type, String(payload.pos || '').trim()),
      meaning_ja: String(payload.meaning_ja || '').trim(),
      meaning_en: String(payload.meaning_en || '').trim(),
      usage_note: String(payload.usage_note || '').trim(),
      example: String(payload.example || '').trim(),
      example_ja: String(payload.example_ja || '').trim(),
      source_url: String(payload.source_url || '').trim(),
      source_context: appendContext('', payload.source_context || ''),
      encounter_count: 1,
      status: STATUS.NEW,
      due_date: '',
      interval: 0,
      ease: EASE_INITIAL,
      reps: 0,
      lapses: 0,
      last_reviewed_at: '',
      created_at: now,
      updated_at: now
    };
    // 意味が入っていれば当日から復習対象
    if (hasMeaning(created)) created.due_date = todayStr_();

    insertItem_(created);
    delete created._row;
    return { item: created, merged: false, created: true };
  });
}

/** 論理削除 */
function api_deleteItem(id) {
  return withLock_(function () {
    var item = findItemById(id, true);
    if (!item) throw new Error('見つかりません: ' + id);
    item.status = STATUS.DELETED;
    item.updated_at = nowIso_();
    writeItemRow_(item);
    return { ok: true };
  });
}

function api_restoreItem(id) {
  return withLock_(function () {
    var item = findItemById(id, true);
    if (!item) throw new Error('見つかりません: ' + id);
    item.status = (toNumber(item.reps, 0) > 0) ? STATUS.REVIEW : STATUS.NEW;
    item.updated_at = nowIso_();
    writeItemRow_(item);
    return { ok: true, status: item.status };
  });
}

/** 休止のオン/オフ */
function api_toggleSuspend(id) {
  return withLock_(function () {
    var item = findItemById(id, true);
    if (!item) throw new Error('見つかりません: ' + id);
    if (item.status === STATUS.SUSPENDED) {
      item.status = (toNumber(item.reps, 0) > 0) ? STATUS.REVIEW : STATUS.NEW;
    } else {
      item.status = STATUS.SUSPENDED;
    }
    item.updated_at = nowIso_();
    writeItemRow_(item);
    return { ok: true, status: item.status };
  });
}

// ---------------------------------------------------------------- Settings

function api_getSettings() {
  return readSettings();
}

function api_saveSettings(patch) {
  return withLock_(function () { return writeSettings_(patch); });
}

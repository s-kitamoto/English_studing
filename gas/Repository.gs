/**
 * スプレッドシートへの読み書き。
 * 書き込みは必ず withLock_() 経由で直列化する（要件 §4.7）。
 */

var _ssCache = null;

function getSpreadsheet_() {
  if (_ssCache) return _ssCache;
  var active = null;
  try { active = SpreadsheetApp.getActive(); } catch (e) { active = null; }
  if (active) { _ssCache = active; return _ssCache; }

  var id = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (!id) {
    throw new Error('スプレッドシートが未設定です。setup() を一度実行してください。');
  }
  _ssCache = SpreadsheetApp.openById(id);
  return _ssCache;
}

function getSheet_(name) {
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません: ' + name + '（setup() を実行してください）');
  return sh;
}

/** 書き込みを直列化する。ロックが取れなければ例外。 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('他の処理が実行中です。少し待ってからもう一度お試しください。');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Items

function rowToItem_(row, rowNumber) {
  var o = {};
  for (var i = 0; i < ITEM_COLUMNS.length; i++) o[ITEM_COLUMNS[i]] = row[i];

  ITEM_DATE_COLUMNS.forEach(function (c) { o[c] = toDateStr(o[c]); });
  ITEM_TS_COLUMNS.forEach(function (c) { o[c] = toIsoStr(o[c]); });
  ITEM_NUM_COLUMNS.forEach(function (c) { o[c] = toNumber(o[c], 0); });
  ITEM_COLUMNS.forEach(function (c) {
    if (ITEM_DATE_COLUMNS.indexOf(c) === -1 &&
        ITEM_TS_COLUMNS.indexOf(c) === -1 &&
        ITEM_NUM_COLUMNS.indexOf(c) === -1) {
      o[c] = (o[c] === null || o[c] === undefined) ? '' : String(o[c]);
    }
  });
  if (!o.ease) o.ease = EASE_INITIAL;
  o._row = rowNumber;
  return o;
}

function itemToRow_(item) {
  return ITEM_COLUMNS.map(function (c) {
    var v = item[c];
    return (v === null || v === undefined) ? '' : v;
  });
}

/**
 * 全アイテムを読む。削除済みは includeDeleted=true のときだけ含める。
 * 数千行なら 1 秒未満で読めるのでキャッシュは持たない。
 */
function readAllItems(includeDeleted) {
  var sh = getSheet_(SHEET.ITEMS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, ITEM_COLUMNS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) continue;                       // id 空行はスキップ
    var item = rowToItem_(values[i], i + 2);
    if (!includeDeleted && item.status === STATUS.DELETED) continue;
    out.push(item);
  }
  return out;
}

function findItemById(id, includeDeleted) {
  var all = readAllItems(includeDeleted);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function findItemByLemma(lemma, includeDeleted) {
  if (!lemma) return null;
  var all = readAllItems(includeDeleted);
  for (var i = 0; i < all.length; i++) if (all[i].lemma === lemma) return all[i];
  return null;
}

function insertItem_(item) {
  var sh = getSheet_(SHEET.ITEMS);
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, ITEM_COLUMNS.length).setValues([itemToRow_(item)]);
  item._row = row;
  return item;
}

/** 1 行まるごと上書きする。item._row が必要。 */
function writeItemRow_(item) {
  if (!item._row) throw new Error('_row がありません: ' + item.id);
  getSheet_(SHEET.ITEMS)
    .getRange(item._row, 1, 1, ITEM_COLUMNS.length)
    .setValues([itemToRow_(item)]);
  return item;
}

/**
 * 複数行を更新する。行が散らばるため 1 行 1 コールになる。
 * 復習のバッチ送信（5〜20件）を想定した規模。
 */
function writeItemRows_(items) {
  items.forEach(function (it) { writeItemRow_(it); });
  return items.length;
}

// ---------------------------------------------------------------- Reviews

function appendReviewLogs_(logs) {
  if (!logs || !logs.length) return 0;
  var sh = getSheet_(SHEET.REVIEWS);
  var rows = logs.map(function (l) {
    return REVIEW_COLUMNS.map(function (c) {
      var v = l[c];
      return (v === null || v === undefined) ? '' : v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, REVIEW_COLUMNS.length).setValues(rows);
  return rows.length;
}

/** ヒートマップと連続日数のために reviewed_at 列だけを読む */
function readReviewDates_() {
  var sh = getSheet_(SHEET.REVIEWS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var col = REVIEW_COLUMNS.indexOf('reviewed_at') + 1;
  var values = sh.getRange(2, col, last - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var d = toDateStr(values[i][0]);
    if (d) out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------- Settings

function readSettings() {
  var sh = getSheet_(SHEET.SETTINGS);
  var last = sh.getLastRow();
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
  if (last < 2) return out;
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  values.forEach(function (r) {
    var k = String(r[0] || '').trim();
    if (!k || !(k in DEFAULT_SETTINGS)) return;
    var v = r[1];
    out[k] = (typeof DEFAULT_SETTINGS[k] === 'number') ? toNumber(v, DEFAULT_SETTINGS[k]) : String(v);
  });
  return out;
}

function writeSettings_(patch) {
  var current = readSettings();
  Object.keys(patch || {}).forEach(function (k) {
    if (k in DEFAULT_SETTINGS) current[k] = patch[k];
  });
  var sh = getSheet_(SHEET.SETTINGS);
  var keys = Object.keys(DEFAULT_SETTINGS);
  var rows = keys.map(function (k) { return [k, current[k]]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return current;
}

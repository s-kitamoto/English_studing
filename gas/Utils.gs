/**
 * 純粋関数のユーティリティ。
 * GAS API に依存するのは uuid_() と nowIso_() / todayStr_() のみ。
 */

function uuid_() {
  return Utilities.getUuid();
}

/** 'yyyy-MM-dd'（スクリプトのタイムゾーン基準） */
function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** ISO8601 のタイムスタンプ */
function nowIso_() {
  return new Date().toISOString();
}

/**
 * 重複判定・検索用の正規化キー。
 * 小文字化 / 前後空白除去 / 連続空白の圧縮 / 末尾の句読点除去。
 */
function normalizeLemma(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,!?;:]+$/, '')
    .trim();
}

/**
 * type の自動判定（要件 §4.4）。
 *   空白なし                            → word
 *   文末に . ? ! がある または 5語以上  → sentence
 *   それ以外                            → phrase
 */
function detectType(text) {
  var t = String(text === null || text === undefined ? '' : text).trim();
  if (!t) return 'word';
  var words = t.split(/\s+/).filter(function (w) { return w.length > 0; });
  if (words.length <= 1) return 'word';
  if (/[.!?]$/.test(t) || words.length >= 5) return 'sentence';
  return 'phrase';
}

/** 'yyyy-MM-dd' に n 日足す（UTC 基準で計算するので DST の影響を受けない） */
function addDays(dateStr, n) {
  var parts = String(dateStr).split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  d.setUTCDate(d.getUTCDate() + Number(n));
  return [
    d.getUTCFullYear(),
    ('0' + (d.getUTCMonth() + 1)).slice(-2),
    ('0' + d.getUTCDate()).slice(-2)
  ].join('-');
}

/** a - b を日数で返す（どちらも 'yyyy-MM-dd'） */
function diffDays(a, b) {
  var pa = String(a).split('-');
  var pb = String(b).split('-');
  var da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  var db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((da - db) / 86400000);
}

/**
 * シートから読んだ値を 'yyyy-MM-dd' 文字列に寄せる。
 * 手でシートを編集されて Date 型になっていても壊れないようにするための防御。
 */
function toDateStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return [
      v.getFullYear(),
      ('0' + (v.getMonth() + 1)).slice(-2),
      ('0' + v.getDate()).slice(-2)
    ].join('-');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** シートから読んだ値を ISO8601 文字列に寄せる */
function toIsoStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v).trim();
}

function toNumber(v, fallback) {
  var n = Number(v);
  return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : fallback;
}

/**
 * source_context の追記。既存と重複しないものだけを足し、
 * 最大 CONTEXT_MAX_ENTRIES 件（古いものから破棄）に保つ。
 */
function appendContext(existing, addition) {
  var add = String(addition || '').replace(/\s+/g, ' ').trim();
  if (!add) return existing || '';
  if (add.length > CONTEXT_MAX_LEN) add = add.slice(0, CONTEXT_MAX_LEN);
  var list = String(existing || '')
    .split(CONTEXT_SEPARATOR)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  if (list.indexOf(add) !== -1) return list.join(CONTEXT_SEPARATOR);
  list.push(add);
  if (list.length > CONTEXT_MAX_ENTRIES) list = list.slice(list.length - CONTEXT_MAX_ENTRIES);
  return list.join(CONTEXT_SEPARATOR);
}

/**
 * pos が type に対して妥当かを検証し、妥当でなければ '' を返す。
 */
function sanitizePos(type, pos) {
  var allowed = POS_BY_TYPE[type] || [];
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i].value === pos) return pos;
  }
  return '';
}

/** アイテムに意味が入っているか（未整備キューと復習対象の判定に使う） */
function hasMeaning(item) {
  return !!(item && String(item.meaning_ja || '').trim());
}

/** タイミング安全な文字列比較 */
function safeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length === 0 || b.length === 0) return false;
  var ha = Utilities.computeHmacSha256Signature(a, 'cmp');
  var hb = Utilities.computeHmacSha256Signature(b, 'cmp');
  if (ha.length !== hb.length) return false;
  var diff = 0;
  for (var i = 0; i < ha.length; i++) diff |= (ha[i] ^ hb[i]);
  return diff === 0;
}

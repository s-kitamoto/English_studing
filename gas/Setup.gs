/**
 * 初期セットアップ。Apps Script エディタから setup() を一度だけ実行する。
 * 何度実行しても壊れない（既存シートは作り直さない）。
 */

function setup() {
  var props = PropertiesService.getScriptProperties();

  // --- スプレッドシートの用意 ---
  var ss = null;
  try { ss = SpreadsheetApp.getActive(); } catch (e) { ss = null; }
  if (!ss) {
    var id = props.getProperty(PROP.SPREADSHEET_ID);
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('English Studying Data');
      props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
    }
  }
  _ssCache = ss;

  ensureItemsSheet_(ss);
  ensureReviewsSheet_(ss);
  ensureSettingsSheet_(ss);
  removeDefaultSheet_(ss);

  // --- トークンの生成（既にあれば維持） ---
  if (!props.getProperty(PROP.TOKEN)) {
    props.setProperty(PROP.TOKEN, Utilities.getUuid().replace(/-/g, ''));
  }

  showSetupInfo();
  return 'setup 完了';
}

function ensureItemsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET.ITEMS);
  if (!sh) sh = ss.insertSheet(SHEET.ITEMS);
  writeHeader_(sh, ITEM_COLUMNS);
  // 日付・タイムスタンプ列は書式をプレーンテキストにして、
  // Sheets が勝手に Date へ変換するのを防ぐ。
  var dataRows = Math.max(1, sh.getMaxRows() - 1);
  ITEM_DATE_COLUMNS.concat(ITEM_TS_COLUMNS).forEach(function (c) {
    var col = ITEM_COLUMNS.indexOf(c) + 1;
    if (col > 0) sh.getRange(2, col, dataRows, 1).setNumberFormat('@');
  });
  sh.setFrozenRows(1);
  sh.setColumnWidth(ITEM_COLUMNS.indexOf('text') + 1, 200);
  sh.setColumnWidth(ITEM_COLUMNS.indexOf('meaning_ja') + 1, 220);
  return sh;
}

function ensureReviewsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET.REVIEWS);
  if (!sh) sh = ss.insertSheet(SHEET.REVIEWS);
  writeHeader_(sh, REVIEW_COLUMNS);
  var col = REVIEW_COLUMNS.indexOf('reviewed_at') + 1;
  sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  sh.setFrozenRows(1);
  return sh;
}

function ensureSettingsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET.SETTINGS);
  if (!sh) sh = ss.insertSheet(SHEET.SETTINGS);
  writeHeader_(sh, ['key', 'value']);
  sh.setFrozenRows(1);
  if (sh.getLastRow() < 2) {
    var rows = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  return sh;
}

function writeHeader_(sh, columns) {
  var range = sh.getRange(1, 1, 1, columns.length);
  var current = range.getValues()[0];
  var same = current.length === columns.length && columns.every(function (c, i) { return current[i] === c; });
  if (!same) range.setValues([columns]);
  range.setFontWeight('bold').setBackground('#f1f3f4');
}

/**
 * create() で付いてくる空の既定シートだけを消す。
 * ユーザーが自分で足した空シートを巻き込まないよう、名前で限定する。
 */
var DEFAULT_SHEET_NAMES = ['Sheet1', 'シート1'];

function removeDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (DEFAULT_SHEET_NAMES.indexOf(sh.getName()) !== -1 &&
        sh.getLastRow() === 0 &&
        ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
}

/** セットアップ結果と、ブックマークすべき URL の作り方をログに出す */
function showSetupInfo() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(PROP.TOKEN);
  var ss = getSpreadsheet_();
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }

  var msg = [
    '================ セットアップ情報 ================',
    'スプレッドシート : ' + ss.getUrl(),
    'トークン         : ' + token,
    '',
    'デプロイ後、次の URL をブックマークしてください:',
    (url ? url : '（未デプロイ）https://script.google.com/macros/s/＜デプロイID＞/exec') + '?t=' + token,
    '',
    '※ トークンを再発行するには resetToken() を実行してください。',
    '=================================================='
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/** トークンを再発行する。ブックマークの URL も差し替えが必要。 */
function resetToken() {
  var token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(PROP.TOKEN, token);
  return showSetupInfo();
}

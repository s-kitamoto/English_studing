/**
 * Web App のエントリポイント。
 *
 * 公開範囲の設定に関わらず、doGet は必ずトークンを要求する。
 * Phase 2 で拡張機能のために公開範囲を ANYONE_ANONYMOUS に変えても
 * UI が誰でも開ける状態にならないようにするため（要件 §7.3）。
 */

function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty(PROP.TOKEN);
  if (!token) {
    return errorPage_('セットアップが未完了です。',
      'Apps Script エディタで setup() を一度実行してください。');
  }
  var given = (e && e.parameter && e.parameter.t) || '';
  if (!safeEquals_(given, token)) {
    return errorPage_('アクセスできません。',
      'ブックマークした URL（末尾に ?t=… が付いたもの）から開いてください。'
      + ' URL が分からない場合は Apps Script エディタで showSetupInfo() を実行してください。');
  }

  var tpl = HtmlService.createTemplateFromFile('ui/index');
  tpl.token = given;
  return tpl.evaluate()
    .setTitle('English Studying')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** ui/*.html を index に差し込む */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function errorPage_(title, detail) {
  var html =
    '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;' +
    'padding:0 1.5rem;line-height:1.7;color:#1a1c1e">' +
    '<h1 style="font-size:1.25rem;margin:0 0 .75rem">' + escapeHtml_(title) + '</h1>' +
    '<p style="margin:0;color:#5f6368">' + escapeHtml_(detail) + '</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('English Studying');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

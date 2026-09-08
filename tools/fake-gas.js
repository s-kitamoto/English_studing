/**
 * GAS のランタイムを Node 上で偽装する。
 * SpreadsheetApp / PropertiesService / LockService / Utilities などを
 * メモリ上の実装に差し替え、gas/*.gs をそのまま評価して返す。
 *
 * tools/integration-test.js と tools/e2e.js の両方から使う。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FILES = ['Constants.gs', 'Utils.gs', 'Srs.gs', 'Repository.gs', 'Api.gs', 'Setup.gs', 'Code.gs'];

// ------------------------------------------------------------- fake Sheets
function FakeSheet(name) {
  this.name = name;
  this.grid = [];          // [row][col] 0-indexed
  this.maxRows = 1000;
}
FakeSheet.prototype._cell = function (r, c) {
  if (!this.grid[r]) return '';
  const v = this.grid[r][c];
  return v === undefined || v === null ? '' : v;
};
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.getLastRow = function () {
  let last = 0;
  for (let r = 0; r < this.grid.length; r++) {
    const row = this.grid[r] || [];
    if (row.some(v => v !== '' && v !== undefined && v !== null)) last = r + 1;
  }
  return last;
};
FakeSheet.prototype.setFrozenRows = function () { return this; };
FakeSheet.prototype.setColumnWidth = function () { return this; };
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  const sheet = this;
  numRows = numRows === undefined ? 1 : numRows;
  numCols = numCols === undefined ? 1 : numCols;
  if (row < 1 || col < 1) throw new Error('getRange: 1-indexed required, got ' + row + ',' + col);
  if (numRows < 1 || numCols < 1) throw new Error('getRange: numRows/numCols must be >= 1');
  return {
    getValues() {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(sheet._cell(row - 1 + r, col - 1 + c));
        out.push(line);
      }
      return out;
    },
    setValues(values) {
      if (values.length !== numRows) throw new Error('setValues: row count mismatch');
      for (let r = 0; r < numRows; r++) {
        if (values[r].length !== numCols) throw new Error('setValues: col count mismatch');
        const gr = row - 1 + r;
        if (!sheet.grid[gr]) sheet.grid[gr] = [];
        for (let c = 0; c < numCols; c++) sheet.grid[gr][col - 1 + c] = values[r][c];
      }
      return this;
    },
    clearContent() {
      for (let r = 0; r < numRows; r++) {
        const gr = row - 1 + r;
        if (!sheet.grid[gr]) continue;
        for (let c = 0; c < numCols; c++) sheet.grid[gr][col - 1 + c] = '';
      }
      return this;
    },
    setNumberFormat() { return this; },
    setFontWeight() { return this; },
    setBackground() { return this; }
  };
};

function FakeSpreadsheet() { this.sheets = []; }
FakeSpreadsheet.prototype.getSheetByName = function (n) {
  return this.sheets.filter(s => s.name === n)[0] || null;
};
FakeSpreadsheet.prototype.insertSheet = function (n) {
  const s = new FakeSheet(n); this.sheets.push(s); return s;
};
FakeSpreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
FakeSpreadsheet.prototype.deleteSheet = function (s) {
  this.sheets = this.sheets.filter(x => x !== s);
};
FakeSpreadsheet.prototype.getUrl = function () { return 'https://example.invalid/ss'; };
FakeSpreadsheet.prototype.getId = function () { return 'fake-ss-id'; };

// ------------------------------------------------------------- sandbox
const state = { today: '2026-09-08', props: {}, uuidN: 0 };
const ss = new FakeSpreadsheet();
const logs = [];

const sandbox = {
  console,
  SpreadsheetApp: { getActive: () => ss, openById: () => ss, create: () => ss },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in state.props ? state.props[k] : null),
      setProperty: (k, v) => { state.props[k] = v; }
    })
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  Utilities: {
    // 本物と同じ形（36文字）を返す。トークン長のチェックが意味を持つようにするため
    getUuid: () => '00000000-0000-4000-8000-' + (++state.uuidN).toString().padStart(12, '0'),
    formatDate: () => state.today,
    computeHmacSha256Signature: s =>
      Array.from(crypto.createHmac('sha256', 'cmp').update(String(s)).digest())
  },
  Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) },
  Logger: { log: m => logs.push(m) },
  HtmlService: {
    createHtmlOutput: h => ({ _h: h, setTitle() { return this; } }),
    createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    createTemplateFromFile: () => ({
      evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; } })
    })
  }
};
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8'), sandbox, { filename: f });
}


/**
 * @param {{today?: string}} opts
 * @return {{sandbox: object, state: object, ss: object, logs: string[]}}
 */
function createGasSandbox(opts) {
  opts = opts || {};
  const state = { today: opts.today || '2026-09-08', props: {}, uuidN: 0 };
  const ss = new FakeSpreadsheet();
  const logs = [];

  const sandbox = {
    console,
    SpreadsheetApp: { getActive: () => ss, openById: () => ss, create: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = v; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      // 本物と同じ形（36文字）を返す。トークン長のチェックが意味を持つようにするため
      getUuid: () => '00000000-0000-4000-8000-' + (++state.uuidN).toString().padStart(12, '0'),
      formatDate: () => state.today,
      computeHmacSha256Signature: s =>
        Array.from(crypto.createHmac('sha256', 'cmp').update(String(s)).digest())
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) },
    Logger: { log: m => logs.push(m) },
    HtmlService: {
      createHtmlOutput: h => ({ _h: h, setTitle() { return this; } }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      createTemplateFromFile: () => ({
        evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; } })
      })
    }
  };
  vm.createContext(sandbox);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8'), sandbox, { filename: f });
  }
  return { sandbox, state, ss, logs };
}

module.exports = { createGasSandbox, FakeSheet, FakeSpreadsheet };

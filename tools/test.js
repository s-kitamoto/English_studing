/**
 * gas/*.gs の純粋関数を Node で検証する簡易テスト。
 * GAS API はスタブする。`node tools/test.js` で実行。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['Constants.gs', 'Utils.gs', 'Srs.gs'];

const sandbox = {
  Utilities: {
    getUuid: () => 'stub-uuid',
    formatDate: () => '2026-09-08',
    computeHmacSha256Signature: (s) => Array.from(Buffer.from(require('crypto')
      .createHmac('sha256', 'cmp').update(String(s)).digest()))
  },
  Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
  console
};
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8'), sandbox, { filename: f });
}

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }
function group(n) { console.log(`\n[${n}]`); }

const { normalizeLemma, detectType, addDays, diffDays, toDateStr, toIsoStr,
        appendContext, sanitizePos, hasMeaning, schedule, previewIntervals,
        formatInterval, safeEquals_, GRADE, STATUS } = sandbox;

group('normalizeLemma');
eq(normalizeLemma('  Make   A Decision.  '), 'make a decision', 'trim/lower/collapse/punct');
eq(normalizeLemma('Run!'), 'run', 'trailing !');
eq(normalizeLemma('It’s fine'), "it's fine", 'curly apostrophe');
eq(normalizeLemma(''), '', 'empty');
eq(normalizeLemma(null), '', 'null');
eq(normalizeLemma('e.g.'), 'e.g', 'inner dot kept');

group('detectType');
eq(detectType('accommodate'), 'word', '1 word');
eq(detectType('  accommodate '), 'word', '1 word padded');
eq(detectType('roll out'), 'phrase', '2 words');
eq(detectType('make a decision'), 'phrase', '3 words');
eq(detectType('take it with a grain'), 'sentence', '5 words');
eq(detectType('take it with salt'), 'phrase', '4 words');
eq(detectType('I agree.'), 'sentence', 'trailing period');
eq(detectType('Really?'), 'word', 'single word with ? is still 1 word');
eq(detectType(''), 'word', 'empty');

group('addDays / diffDays');
eq(addDays('2026-09-08', 1), '2026-09-09', '+1');
eq(addDays('2026-09-30', 1), '2026-10-01', 'month rollover');
eq(addDays('2026-12-31', 1), '2027-01-01', 'year rollover');
eq(addDays('2028-02-28', 1), '2028-02-29', 'leap year');
eq(addDays('2026-03-01', -1), '2026-02-28', 'negative');
eq(addDays('2026-09-08', 365), '2027-09-08', '+365');
eq(diffDays('2026-09-10', '2026-09-08'), 2, 'diff 2');
eq(diffDays('2026-09-08', '2026-09-10'), -2, 'diff -2');
eq(diffDays('2026-09-08', '2026-09-08'), 0, 'diff 0');

group('toDateStr / toIsoStr');
eq(toDateStr(new Date(2026, 8, 8)), '2026-09-08', 'Date object');
eq(toDateStr('2026-09-08'), '2026-09-08', 'already string');
eq(toDateStr('2026/9/8'), '2026-09-08', 'slash + single digit');
eq(toDateStr('2026-09-08T00:00:00.000Z'), '2026-09-08', 'iso prefix');
eq(toDateStr(''), '', 'empty');
eq(toDateStr('garbage'), '', 'unparseable');
eq(toIsoStr(''), '', 'empty ts');
ok(toIsoStr(new Date(Date.UTC(2026, 8, 8))).indexOf('2026-09-08T') === 0, 'Date -> iso');

group('appendContext');
eq(appendContext('', 'first'), 'first', 'first entry');
eq(appendContext('a', 'b'), 'a\n---\nb', 'second entry');
eq(appendContext('a\n---\nb', 'a'), 'a\n---\nb', 'dedupe');
eq(appendContext('a\n---\nb\n---\nc', 'd'), 'b\n---\nc\n---\nd', 'cap at 3, drop oldest');
eq(appendContext('a', ''), 'a', 'empty addition');
eq(appendContext('a', '   '), 'a', 'whitespace addition');
eq(appendContext('', 'x'.repeat(400)).length, 300, 'truncate to 300');

group('sanitizePos');
eq(sanitizePos('word', 'noun'), 'noun', 'valid word pos');
eq(sanitizePos('word', 'phrasal_verb'), '', 'phrase pos rejected for word');
eq(sanitizePos('phrase', 'phrasal_verb'), 'phrasal_verb', 'valid phrase pos');
eq(sanitizePos('sentence', 'noun'), '', 'sentence has no pos');
eq(sanitizePos('word', ''), '', 'empty');

group('hasMeaning');
eq(hasMeaning({ meaning_ja: 'いみ' }), true, 'has');
eq(hasMeaning({ meaning_ja: '   ' }), false, 'whitespace only');
eq(hasMeaning({}), false, 'missing');
eq(hasMeaning(null), false, 'null');

// fuzz を 0.5 に固定すると倍率はちょうど 1.0 になる
const NF = () => 0.5;
const T = '2026-09-08';

group('schedule: 新規カード');
let r = schedule({}, GRADE.GOOD, T, NF);
eq([r.interval, r.reps, r.status, r.due_date], [1, 1, 'review', '2026-09-09'], 'new + Good -> 1日');
r = schedule({}, GRADE.EASY, T, NF);
eq([r.interval, r.reps, r.due_date], [4, 1, '2026-09-12'], 'new + Easy -> 4日');
eq(r.ease, 2.65, 'new + Easy ease +0.15');
r = schedule({}, GRADE.HARD, T, NF);
eq([r.interval, r.ease], [1, 2.35], 'new + Hard -> 1日 / ease -0.15');
r = schedule({}, GRADE.AGAIN, T, NF);
eq([r.interval, r.reps, r.lapses, r.status, r.due_date], [0, 0, 1, 'learning', T], 'new + Again -> 当日再出題');
eq(r.ease, 2.3, 'new + Again ease -0.20');

group('schedule: 復習カード');
const rev = { ease: 2.5, interval: 10, reps: 3, lapses: 0 };
r = schedule(rev, GRADE.GOOD, T, NF);
eq([r.interval, r.reps, r.due_date], [25, 4, '2026-10-03'], 'Good -> interval * ease');
r = schedule(rev, GRADE.HARD, T, NF);
eq([r.interval, r.ease], [12, 2.35], 'Hard -> interval * 1.2');
r = schedule(rev, GRADE.EASY, T, NF);
eq([r.interval, r.ease], [Math.round(10 * 2.65 * 1.3), 2.65], 'Easy -> interval * newEase * 1.3');
r = schedule(rev, GRADE.AGAIN, T, NF);
eq([r.interval, r.reps, r.lapses, r.status], [0, 0, 1, 'learning'], 'Again -> リセット');

group('schedule: 境界');
r = schedule({ ease: 1.3, interval: 5, reps: 2, lapses: 3 }, GRADE.AGAIN, T, NF);
eq(r.ease, 1.3, 'ease 下限 1.3 を割らない');
r = schedule({ ease: 1.35, interval: 5, reps: 2, lapses: 0 }, GRADE.HARD, T, NF);
eq(r.ease, 1.3, 'ease 下限でクランプ');
r = schedule({ ease: 2.5, interval: 700, reps: 9, lapses: 0 }, GRADE.EASY, T, NF);
eq(r.interval, 730, '上限 730 日');
r = schedule({ ease: 2.5, interval: 100, reps: 5, lapses: 0 }, GRADE.GOOD, T, NF);
eq(r.status, 'mastered', 'interval>=180 かつ lapses=0 で mastered');
r = schedule({ ease: 2.5, interval: 100, reps: 5, lapses: 1 }, GRADE.GOOD, T, NF);
eq(r.status, 'review', 'lapses>0 なら mastered にしない');
r = schedule({ ease: 2.5, interval: 0.2, reps: 2, lapses: 0 }, GRADE.GOOD, T, NF);
ok(r.interval >= 1, '最小 1 日を下回らない');

group('schedule: fuzz の範囲');
for (let i = 0; i < 200; i++) {
  const x = schedule({ ease: 2.5, interval: 100, reps: 3, lapses: 0 }, GRADE.GOOD, T, Math.random);
  if (x.interval < 237 || x.interval > 264) { fail++; console.error(`  FAIL fuzz range: ${x.interval}`); break; }
}
pass++;

group('schedule: 引数を破壊しない');
const orig = { ease: 2.5, interval: 10, reps: 3, lapses: 0 };
schedule(orig, GRADE.EASY, T, NF);
eq(orig, { ease: 2.5, interval: 10, reps: 3, lapses: 0 }, '入力オブジェクトは不変');

group('previewIntervals / formatInterval');
const pv = previewIntervals({ ease: 2.5, interval: 10, reps: 3, lapses: 0 }, T);
eq([pv[0], pv[1], pv[2]], [0, 12, 25], 'preview の Again/Hard/Good');
eq(formatInterval(0), '今日', '0');
eq(formatInterval(1), '1日', '1');
eq(formatInterval(25), '25日', '25');
eq(formatInterval(60), '2ヶ月', '60');
eq(formatInterval(400), '1.1年', '400');

group('safeEquals_');
eq(safeEquals_('abc', 'abc'), true, 'equal');
eq(safeEquals_('abc', 'abd'), false, 'differ');
eq(safeEquals_('', ''), false, '空文字は常に false');
eq(safeEquals_('abc', ''), false, '片方が空');
eq(safeEquals_(null, null), false, 'null');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * 偽のスプレッドシートを使って GAS サーバー側を通しで検証する。
 * `node tools/integration-test.js`
 */
const { createGasSandbox } = require('./fake-gas');

const { sandbox, state, ss, logs } = createGasSandbox({ today: '2026-09-08' });

// ------------------------------------------------------------- assertions
let pass = 0, fail = 0;
function eq(a, e, name) {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) pass++;
  else { fail++; console.error(`  FAIL ${name}\n    expected ${E}\n    actual   ${A}`); }
}
function ok(c, name) { eq(!!c, true, name); }
function throws(fn, name) {
  try { fn(); fail++; console.error(`  FAIL ${name} (例外が発生しなかった)`); }
  catch (e) { pass++; }
}
function group(n) { console.log(`\n[${n}]`); }
const S = sandbox;

// ------------------------------------------------------------- run
group('setup');
S.setup();
ok(ss.getSheetByName('Items'), 'Items シートができる');
ok(ss.getSheetByName('Reviews'), 'Reviews シートができる');
ok(ss.getSheetByName('Settings'), 'Settings シートができる');
eq(ss.getSheetByName('Items').getRange(1, 1, 1, S.ITEM_COLUMNS.length).getValues()[0],
   S.ITEM_COLUMNS, 'Items のヘッダ');
ok(state.props.WEBAPP_TOKEN && state.props.WEBAPP_TOKEN.length >= 20, 'トークンが生成される');
const tokenBefore = state.props.WEBAPP_TOKEN;
S.setup();
eq(state.props.WEBAPP_TOKEN, tokenBefore, '再実行してもトークンは維持される');
eq(ss.getSheets().length, 3, '再実行してもシートは増えない');
eq(S.readSettings(), S.DEFAULT_SETTINGS, '既定設定が入る');

group('doGet のトークンゲート');
ok(String(S.doGet({ parameter: {} })._h).indexOf('アクセスできません') !== -1, 'トークンなしは拒否');
ok(String(S.doGet({ parameter: { t: 'wrong' } })._h).indexOf('アクセスできません') !== -1, '誤ったトークンは拒否');
ok(S.doGet({ parameter: { t: tokenBefore } }).setTitle, '正しいトークンなら UI を返す');
ok(String(S.doGet(null)._h).indexOf('アクセスできません') !== -1, 'e が null でも落ちない');

group('登録');
let r = S.api_upsertItem({ text: 'accommodate', meaning_ja: '収容する / 便宜を図る', pos: 'verb' });
ok(r.created, '新規作成');
eq(r.item.type, 'word', 'type 自動判定 word');
eq(r.item.pos, 'verb', 'pos 保持');
eq(r.item.status, 'new', '初期 status は new');
eq(r.item.due_date, state.today, '意味があれば当日から対象');
eq(r.item.encounter_count, 1, 'encounter_count = 1');
const idAcc = r.item.id;

r = S.api_upsertItem({ text: 'roll out', meaning_ja: '展開する', pos: 'phrasal_verb' });
eq([r.item.type, r.item.pos], ['phrase', 'phrasal_verb'], 'フレーズと句動詞');
const idRoll = r.item.id;

r = S.api_upsertItem({ text: 'Let me get back to you on that.', meaning_ja: '追って連絡します' });
eq(r.item.type, 'sentence', 'センテンス判定');
eq(r.item.pos, '', 'sentence に pos は付かない');

r = S.api_upsertItem({ text: 'ballpark figure', pos: 'noun' });
eq(r.item.pos, '', 'phrase に word 用の pos は入らない');
eq(r.item.due_date, '', '意味が空なら due_date は空');
eq(r.item.status, 'new', '意味が空でも登録できる');
const idBall = r.item.id;

throws(() => S.api_upsertItem({ text: '   ' }), '空文字は拒否');

group('重複マージ');
r = S.api_upsertItem({ text: '  Accommodate. ', source_context: 'We can accommodate 50 people.', source_url: 'https://a.invalid' });
ok(r.merged, 'lemma 一致でマージ');
eq(r.item.id, idAcc, '同じ id');
eq(r.item.encounter_count, 2, 'encounter_count が増える');
eq(r.item.text, 'accommodate', '元の表記を維持');
ok(r.item.source_context.indexOf('50 people') !== -1, 'context が入る');
r = S.api_upsertItem({ text: 'accommodate', meaning_ja: '上書きされないはず' });
eq(r.item.meaning_ja, '収容する / 便宜を図る', '既存の入力は上書きしない');
eq(r.item.encounter_count, 3, '3回目の遭遇');
eq(S.readAllItems(false).length, 4, '行は増えていない');

group('未整備キュー');
let uf = S.api_getUnfilled(50);
eq(uf.total, 1, '未整備は1件');
eq(uf.items[0].id, idBall, 'ballpark figure が対象');
S.api_upsertItem({ id: idBall, text: 'ballpark figure', meaning_ja: 'おおよその数字', pos: 'noun_phrase' });
eq(S.api_getUnfilled(50).total, 0, '埋めたら未整備から消える');
eq(S.findItemById(idBall).due_date, state.today, '意味が入った時点で復習対象になる');

group('ダッシュボード（復習前）');
let d = S.api_getDashboard();
eq(d.totalCount, 4, '総数 4');
eq(d.unfilledCount, 0, '未整備 0');
eq(d.newCount, 4, '新規 4');
eq(d.streak, 0, '連続 0 日');
eq(d.heatmap.length, 56, 'ヒートマップ 56 日');
eq(d.heatmap[55].date, state.today, 'ヒートマップの末尾が今日');

group('復習セッション');
let sess = S.api_getReviewSession({});
eq(sess.cards.length, 4, '4枚出題');
ok(sess.cards.every(c => c.isNew), 'すべて新規');
ok(sess.cards[0].preview && sess.cards[0].preview[2] >= 1, 'preview が入っている');
ok(sess.cards.every(c => c.meaning_ja), '意味のないカードは出ない');

S.api_submitReviews({ results: [
  { item_id: idAcc, grade: 2, mode: 'flashcard', elapsed_ms: 3000 },
  { item_id: idRoll, grade: 3, mode: 'flashcard', elapsed_ms: 2000 }
]});
let acc = S.findItemById(idAcc), roll = S.findItemById(idRoll);
eq([acc.status, acc.reps, acc.interval], ['review', 1, 1], 'Good で 1日後');
eq(acc.due_date, S.addDays(state.today, 1), 'due_date が翌日');
eq([roll.reps, roll.interval], [1, 4], 'Easy で 4日後');
ok(acc.last_reviewed_at, 'last_reviewed_at が入る');
eq(ss.getSheetByName('Reviews').getLastRow(), 3, 'ログが2行追記される');

group('同一アイテムを複数回（Again → Good）');
S.api_submitReviews({ results: [
  { item_id: idBall, grade: 0 },
  { item_id: idBall, grade: 2 }
]});
let ball = S.findItemById(idBall);
eq([ball.lapses, ball.reps, ball.interval], [1, 1, 1], 'Again 後に Good で 1日');
ok(ball.ease < 2.5, 'Again で ease が下がっている');
eq(ss.getSheetByName('Reviews').getLastRow(), 5, 'ログは2行とも残る');

group('存在しない ID / 不正な grade は無視');
r = S.api_submitReviews({ results: [
  { item_id: 'nope', grade: 2 }, { item_id: idAcc, grade: 9 }, { item_id: idAcc, grade: -1 }
]});
eq(r.updated, 0, '何も更新されない');
eq(S.api_submitReviews({ results: [] }), { ok: true, updated: 0 }, '空配列は no-op');

group('翌日への繰り越し');
state.today = '2026-09-09';
d = S.api_getDashboard();
eq(d.dueTotal, 2, '翌日は accommodate と ballpark が期限');
eq(d.streak, 1, '昨日やっていれば連続は途切れない');
sess = S.api_getReviewSession({});
eq(sess.cards.length, 3, '期限2件 + 新規1件（sentence）');
ok(sess.cards.some(c => c.id === idAcc), 'accommodate が出題される');
ok(!sess.cards.some(c => c.id === idRoll), '4日後の roll out は出題されない');

group('新規の1日上限');
S.api_saveSettings({ daily_new_limit: 1, session_size: 20 });
state.today = '2026-09-20';
for (let i = 0; i < 10; i++) S.api_upsertItem({ text: 'newword' + i, meaning_ja: 'いみ' + i });
sess = S.api_getReviewSession({});
eq(sess.cards.filter(c => c.isNew).length, 1, '新規は上限 1 件まで');
S.api_submitReviews({ results: [{ item_id: sess.cards.filter(c => c.isNew)[0].id, grade: 2 }] });
sess = S.api_getReviewSession({});
eq(sess.cards.filter(c => c.isNew).length, 0, '上限を使い切ったら新規は出ない');
S.api_saveSettings({ daily_new_limit: 20 });

group('復習が滞留していても新規が出る');
state.today = '2026-10-30';
sess = S.api_getReviewSession({ limit: 8 });
eq(sess.cards.length, 8, 'セッションサイズどおり');
ok(sess.cards.filter(c => c.isNew).length >= 2, '新規が確保される');
ok(sess.cards.filter(c => !c.isNew).length >= 1, '復習も含まれる');
ok(sess.cards[sess.cards.length - 1] !== undefined, '末尾がある');
ok(!sess.cards.slice(0, sess.cards.length - 2).every(c => !c.isNew), '新規が末尾に固まっていない');

group('一覧・検索');
let L = S.api_listItems({ limit: 3000 });
eq(L.total, S.readAllItems(false).length, '全件返る');
eq(S.api_listItems({ query: 'accommodate' }).total, 1, '英語で検索');
eq(S.api_listItems({ query: '展開' }).total, 1, '日本語で検索');
eq(S.api_listItems({ type: 'sentence' }).total, 1, 'type で絞り込み');
eq(S.api_listItems({ pos: 'phrasal_verb' }).total, 1, 'pos で絞り込み');
ok(S.api_listItems({ limit: 3 }).items.length === 3, 'limit が効く');
ok(L.items[0].filled !== undefined, 'filled フラグがある');

group('削除と復元');
S.api_deleteItem(idRoll);
eq(S.api_listItems({}).items.filter(x => x.id === idRoll).length, 0, '既定では出てこない');
eq(S.api_listItems({ status: 'deleted' }).total, 1, '削除済みで絞ると出る');
S.api_restoreItem(idRoll);
eq(S.findItemById(idRoll).status, 'review', 'reps>0 なら review に戻る');
throws(() => S.api_deleteItem('nope'), '存在しない ID の削除は例外');

group('休止');
S.api_toggleSuspend(idAcc);
eq(S.findItemById(idAcc).status, 'suspended', '休止になる');
ok(!S.api_getReviewSession({}).cards.some(c => c.id === idAcc), '休止は出題されない');
S.api_toggleSuspend(idAcc);
eq(S.findItemById(idAcc).status, 'review', '休止解除で戻る');

group('設定の保存');
let st = S.api_saveSettings({ session_size: 33, tts_lang: 'en-GB', bogus: 'x' });
eq(st.session_size, 33, 'session_size 保存');
eq(st.tts_lang, 'en-GB', 'tts_lang 保存');
ok(!('bogus' in st), '未知のキーは無視');
eq(S.readSettings().session_size, 33, '読み直しても残る');

group('シートを手で編集された場合の耐性');
const itemsSheet = ss.getSheetByName('Items');
const dueCol = S.ITEM_COLUMNS.indexOf('due_date') + 1;
itemsSheet.getRange(2, dueCol, 1, 1).setValues([[new Date(2026, 8, 8)]]);   // Date 型で書かれた
ok(S.readAllItems(false).length > 0, 'Date 型の due_date でも落ちない');
eq(S.findItemById(idAcc).due_date, '2026-09-08', 'Date は yyyy-MM-dd に正規化される');
itemsSheet.getRange(3, S.ITEM_COLUMNS.indexOf('ease') + 1, 1, 1).setValues([['']]);
ok(S.readAllItems(false).every(i => i.ease > 0), 'ease が空でも既定値が入る');

group('メタ情報');
const meta = S.api_getMeta();
eq(meta.types.map(t => t.value), ['word', 'phrase', 'sentence'], 'type は3値');
eq(meta.posByType.sentence, [], 'sentence の pos は空');
eq(meta.posByType.word.length, 8, 'word の pos は8種');
eq(meta.posByType.phrase.length, 5, 'phrase の pos は5種');

group('interleave_ / streak / heatmap の単体');
eq(S.interleave_([1,2,3,4,5,6], []).length, 6, 'extra 空');
eq(S.interleave_([], ['a','b']), ['a','b'], 'base 空');
let mix = S.interleave_([1,2,3,4,5,6], ['a','b']);
eq(mix.length, 8, '長さが合う');
eq(mix.filter(x => typeof x === 'string'), ['a','b'], 'extra が全部入る');
eq(mix.filter(x => typeof x === 'number'), [1,2,3,4,5,6], 'base が順序を保って全部入る');
ok(mix.indexOf('a') < mix.length - 1, '最初の extra が末尾ではない');
mix = S.interleave_([1], ['a','b','c']);
eq(mix.length, 4, 'extra の方が多くても全部入る');
eq(mix.filter(x => typeof x === 'string').length, 3, 'extra が欠けない');

eq(S.calcStreak_([], '2026-09-10'), 0, 'ログなしは 0');
eq(S.calcStreak_([{item_id:'x',date:'2026-09-10'}], '2026-09-10'), 1, '今日だけで 1');
eq(S.calcStreak_([{item_id:'x',date:'2026-09-09'}], '2026-09-10'), 1, '今日未実施でも昨日まで数える');
eq(S.calcStreak_([{item_id:'x',date:'2026-09-08'}], '2026-09-10'), 0, '2日空くと途切れる');
eq(S.calcStreak_(
  ['2026-09-10','2026-09-09','2026-09-08','2026-09-06'].map(d => ({item_id:'x',date:d})),
  '2026-09-10'), 3, '連続3日ぶん数える');
eq(S.calcStreak_(
  [{item_id:'a',date:'2026-09-10'},{item_id:'b',date:'2026-09-10'}], '2026-09-10'),
  1, '同日複数回でも 1 日');

const hm = S.buildHeatmap_([{item_id:'x',date:'2026-09-10'},{item_id:'y',date:'2026-09-10'}], '2026-09-10');
eq(hm.length, 56, '56 日ぶん');
eq(hm[55], { date: '2026-09-10', count: 2 }, '当日の件数');
eq(hm[0].date, S.addDays('2026-09-10', -55), '先頭は 55 日前');

eq(S.countNewIntroducedToday_([
  {item_id:'a',date:'2026-09-09'}, {item_id:'a',date:'2026-09-10'},
  {item_id:'b',date:'2026-09-10'}
], '2026-09-10'), 1, '初回が今日のものだけ数える');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * UI の E2E。実際の gas/ui/*.html を Chromium で描画し、
 * google.script.run を Node 側の（偽シートで動く）本物のサーバーコードに繋ぐ。
 *
 *   node tools/e2e.js            … 検証のみ
 *   node tools/e2e.js --shots    … スクリーンショットも出力
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createGasSandbox } = require('./fake-gas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'screenshots');
const SHOTS = process.argv.indexOf('--shots') !== -1;

function buildHtml(prelude) {
  const read = f => fs.readFileSync(path.join(ROOT, 'gas/ui', f), 'utf8');
  let html = read('index.html');
  html = html.replace("<?!= include('ui/style'); ?>", read('style.html'));
  html = html.replace("<?!= include('ui/app'); ?>", read('app.html'));
  // google.script.run のシムを app より前に差し込む
  const shim = `<script>
    window.google = { script: { run: (function make(handlers) {
      const api = {
        withSuccessHandler(f) { return make(Object.assign({}, handlers, { ok: f })); },
        withFailureHandler(f) { return make(Object.assign({}, handlers, { ng: f })); }
      };
      ['api_getMeta','api_getDashboard','api_getReviewSession','api_submitReviews',
       'api_listItems','api_getItem','api_getUnfilled','api_upsertItem','api_deleteItem',
       'api_restoreItem','api_toggleSuspend','api_getSettings','api_saveSettings'
      ].forEach(function (n) {
        api[n] = function (arg) {
          window.__gasCall(n, arg === undefined ? null : arg).then(function (res) {
            if (res.error) { if (handlers.ng) handlers.ng(new Error(res.error)); }
            else if (handlers.ok) handlers.ok(res.value);
          });
        };
      });
      return api;
    })({}) } };
  </script>`;
  // setContent には addInitScript が効かないので、スタブは HTML に直接差し込む
  return html.replace('<script>\n(function () {',
    shim + (prelude || '') + '\n<script>\n(function () {');
}

(async () => {
  const { sandbox, state } = createGasSandbox({ today: '2026-09-08' });
  sandbox.setup();

  // 見栄えと動作確認のためのシードデータ
  const seed = [
    ['accommodate', '収容する / 便宜を図る', 'verb', '「人数を受け入れる」と「要望に応じる」の両方で使う。ビジネスメールでは後者が多い。',
     'We can accommodate up to 50 people in this room.', 'この部屋は50人まで収容できます。'],
    ['roll out', '（新機能などを）展開する / 公開する', 'phrasal_verb', 'launch より段階的なニュアンス。社内展開にも使う。',
     'We will roll out the new feature next quarter.', '来四半期に新機能を展開します。'],
    ['ballpark figure', 'おおよその数字', 'noun_phrase', '正確でなくてよい概算を聞くときの定型句。',
     'Can you give me a ballpark figure for the budget?', '予算のおおよその数字を教えてもらえますか。'],
    ['circle back', '後で改めて話す', 'phrasal_verb', '会議で結論を持ち越すときの定番。やや婉曲。',
     "Let's circle back on this after the review.", 'レビューの後で改めて話しましょう。'],
    ['Let me get back to you on that.', '追って連絡します', '', '',
     '', ''],
    ['leverage', 'うまく活用する', 'verb', '', '', '']
  ];
  seed.forEach(function (s) {
    sandbox.api_upsertItem({
      text: s[0], meaning_ja: s[1], pos: s[2], usage_note: s[3], example: s[4], example_ja: s[5]
    });
  });
  sandbox.api_upsertItem({ text: 'due diligence', source_context: 'They are conducting due diligence on the target company.', source_url: 'https://example.invalid/a' });
  // 過去の学習履歴（ヒートマップと連続日数の見え方を確認するため）
  ['2026-09-05', '2026-09-06', '2026-09-07'].forEach(function (d) {
    state.today = d;
    sandbox.api_submitReviews({ results: [{ item_id: sandbox.readAllItems(false)[0].id, grade: 2 }] });
  });
  state.today = '2026-09-08';

  // この環境の Chromium はプリインストール版を使う（playwright のバージョンと
  // ビルド番号がずれていてもダウンロードしに行かないようにするため）
  const CHROMIUM = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.exposeFunction('__gasCall', (name, arg) => {
    try {
      const value = arg === null ? sandbox[name]() : sandbox[name](arg);
      return { value: JSON.parse(JSON.stringify(value === undefined ? null : value)) };
    } catch (e) {
      return { error: e.message };
    }
  });

  await page.setContent(buildHtml(), { waitUntil: 'load' });
  if (SHOTS && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  let pass = 0, fail = 0;
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ' — ' + e.message); }
  };
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }); };
  const text = async sel => (await page.textContent(sel) || '').trim();
  const expect = (a, e, what) => { if (String(a) !== String(e)) throw new Error(`${what}: expected ${e}, got ${a}`); };

  console.log('\n[ホーム]');
  await page.waitForFunction(() => document.getElementById('s-total').textContent !== '–', null, { timeout: 8000 });
  await check('統計が描画される', async () => {
    expect(await text('#s-total'), '7', '登録総数');
    expect(await text('#s-todo'), '1', '未整備');
  });
  await check('連続日数が出る', async () => {
    const s = await text('#streak');
    if (!/3日連続/.test(s)) throw new Error('streak = ' + s);
  });
  await check('ヒートマップが 56 マス', async () =>
    expect(await page.locator('#heat i:not(.pad)').count(), 56, 'マス数'));
  await check('未整備ボタンが出る', async () =>
    expect(await page.locator('#go-unfilled').isVisible(), true, '表示'));
  await shot('01-home');

  console.log('\n[復習]');
  await check('セッションが始まる', async () => {
    // 期限が来ているのは 5 枚（accommodate は事前の履歴で先の日付に送られている）
    expect(await text('#start-review'), '復習を始める（5問）', 'CTA の件数');
    await page.click('#start-review');
    await page.waitForSelector('#qcard .term', { timeout: 8000 });
    expect(await page.locator('.tabs').isVisible(), false, '復習中はタブが隠れる');
  });
  await shot('02-review-front');
  await check('めくると答えが出る', async () => {
    await page.click('#qcard');
    await page.waitForSelector('.answer .meaning');
    expect(await page.locator('#r-grades').isVisible(), true, '4段階ボタン');
    const pv = await text('#pv2');
    if (!pv) throw new Error('間隔プレビューが空');
  });
  await shot('03-review-back');
  await check('評価すると次のカードへ進む', async () => {
    const first = await text('#qcard .term');
    await page.click('.grades button[data-g="2"]');
    await page.waitForTimeout(120);
    const second = await text('#qcard .term');
    if (first === second) throw new Error('カードが進んでいない: ' + first);
    expect(await text('#r-count'), '1 / 5', '進捗');
  });
  await check('キーボードで操作できる', async () => {
    await page.keyboard.press('Space');
    await page.waitForSelector('.answer .meaning');
    await page.keyboard.press('3');
    await page.waitForTimeout(120);
    expect(await text('#r-count'), '2 / 5', 'キー操作後の進捗');
  });
  await check('「もう一度」で同セッション内に再出題される', async () => {
    const term = await text('#qcard .term');
    await page.click('#qcard');
    await page.click('.grades button[data-g="0"]');
    await page.waitForTimeout(120);
    const cnt = await text('#r-count');
    if (!/再出題 1/.test(cnt)) throw new Error('再出題の表示がない: ' + cnt);
    if (await text('#qcard .term') === term) throw new Error('同じカードが連続で出ている');
  });
  await check('中断するとサマリが出る', async () => {
    await page.click('#quit-review');
    await page.waitForSelector('#r-done:not(.hidden)');
    expect(await page.locator('.tabs').isVisible(), true, 'タブが戻る');
  });
  await shot('04-review-done');
  await page.click('#done-home');

  console.log('\n[登録]');
  await check('フォームが開く', async () => {
    await page.click('.tabs button[data-view="add"]');
    await page.waitForSelector('#v-add.active');
  });
  await check('type が自動判定される', async () => {
    await page.fill('#f-text', 'take something with a grain of salt');
    await page.waitForTimeout(60);
    expect(await page.inputValue('#f-type'), 'sentence', '5語以上');
    await page.fill('#f-text', 'get around to');
    await page.waitForTimeout(60);
    expect(await page.inputValue('#f-type'), 'phrase', '3語');
    await page.fill('#f-text', 'concise');
    await page.waitForTimeout(60);
    expect(await page.inputValue('#f-type'), 'word', '1語');
  });
  await check('pos の選択肢が type に追従する', async () => {
    expect(await page.locator('#f-pos option').count(), 9, 'word: 8品詞 + 空');
    await page.selectOption('#f-type', 'phrase');
    expect(await page.locator('#f-pos option').count(), 6, 'phrase: 5種 + 空');
    await page.selectOption('#f-type', 'sentence');
    expect(await page.locator('#f-pos').isDisabled(), true, 'sentence では無効化');
    await page.selectOption('#f-type', 'word');
  });
  await check('保存できる', async () => {
    await page.fill('#f-meaning_ja', '簡潔な');
    await page.selectOption('#f-pos', 'adjective');
    await page.click('#f-save');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
    expect(await text('#toast'), '登録しました', 'トースト');
    expect(await page.inputValue('#f-text'), '', 'フォームがクリアされる');
  });
  await shot('05-add');
  await check('重複は マージされる', async () => {
    await page.fill('#f-text', 'Concise');
    await page.fill('#f-meaning_ja', '別の意味');
    await page.click('#f-save');
    await page.waitForFunction(() => /遭遇/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
    expect(await text('#toast'), '登録済みでした（2回目の遭遇）', 'マージのトースト');
  });

  console.log('\n[一覧]');
  await check('一覧が出る', async () => {
    await page.click('.tabs button[data-view="list"]');
    await page.waitForSelector('.li', { timeout: 8000 });
    expect(await page.locator('.li').count(), 8, '件数');
  });
  await check('検索で絞り込める', async () => {
    await page.fill('#q', 'roll');
    await page.waitForTimeout(280);
    expect(await page.locator('.li').count(), 1, '英語検索');
    await page.fill('#q', '数字');
    await page.waitForTimeout(280);
    expect(await page.locator('.li').count(), 1, '日本語検索');
    await page.fill('#q', '');
    await page.waitForTimeout(280);
  });
  await check('種別で絞り込める', async () => {
    await page.selectOption('#q-type', 'phrase');
    await page.waitForTimeout(80);
    const n = await page.locator('.li').count();
    if (n < 1) throw new Error('phrase が 0 件');
    await page.selectOption('#q-type', '');
    await page.waitForTimeout(80);
  });
  await check('未整備バッジが出る', async () =>
    expect(await page.locator('.li .badge.warn', { hasText: '未整備' }).count() >= 1, true, 'バッジ'));
  await shot('06-list');
  await check('行をタップすると編集画面が開く', async () => {
    await page.click('.li');
    await page.waitForSelector('#v-add.active');
    expect(await page.locator('#f-delete').isVisible(), true, '削除ボタンが出る');
    expect(await text('#f-save'), '更新', 'ボタンが更新になる');
  });

  console.log('\n[未整備キュー]');
  await check('キューが起動して文脈が出る', async () => {
    await page.click('.tabs button[data-view="home"]');
    await page.waitForSelector('#v-home.active');
    await page.click('#go-unfilled');
    await page.waitForSelector('#uf-banner');
    expect(await page.inputValue('#f-text'), 'due diligence', '対象');
    expect(await text('#f-save'), '保存して次へ', 'ボタン');
    const ctx = await text('#f-context');
    if (!/due diligence/.test(ctx)) throw new Error('文脈が出ていない: ' + ctx);
  });
  await shot('07-unfilled');
  await check('埋めるとキューが終わる', async () => {
    await page.fill('#f-meaning_ja', 'デューデリジェンス / 買収前調査');
    await page.click('#f-save');
    await page.waitForSelector('#v-home.active', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('s-todo').textContent === '0', null, { timeout: 5000 });
  });

  console.log('\n[設定]');
  await check('設定を保存できる', async () => {
    await page.click('.tabs button[data-view="settings"]');
    await page.fill('#st-session', '12');
    await page.click('#st-save');
    await page.waitForFunction(() => document.getElementById('toast').textContent === '保存しました', null, { timeout: 5000 });
    expect(sandbox.readSettings().session_size, 12, 'サーバー側に反映');
  });
  await check('アプリ情報が出る', async () => {
    const v = await text('#app-version');
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('バージョンが出ていない: ' + v);
    const href = await page.getAttribute('#ss-link', 'href');
    if (!href || href === '#') throw new Error('シートへのリンクが張られていない: ' + href);
  });
  await shot('08-settings');

  console.log('\n[ダークモード]');
  await check('ダークでも描画される', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('.tabs button[data-view="home"]');
    await page.waitForTimeout(300);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (bg === 'rgb(246, 247, 249)') throw new Error('ライトのままです: ' + bg);
  });
  await shot('09-home-dark');

  console.log('\n[デスクトップ幅]');
  await check('横幅 1280 でも崩れない', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) throw new Error('横スクロールが発生: ' + overflow + 'px');
  });
  await shot('10-desktop');

  // ---- 音声選択（macOS の novelty voice を掴まないこと） ----
  // 実機の macOS では en-US に Albert / Bahh / Zarvox といったジョーク音声が
  // 含まれる。言語一致の先頭を採ると Albert を掴んでしまうため、その回帰確認。
  console.log('\n[音声選択]');
  const vpage = await browser.newPage({ viewport: { width: 420, height: 860 } });
  vpage.on('pageerror', e => errors.push('pageerror(voice): ' + e.message));
  await vpage.exposeFunction('__gasCall', (name, arg) => {
    try {
      const value = arg === null ? sandbox[name]() : sandbox[name](arg);
      return { value: JSON.parse(JSON.stringify(value === undefined ? null : value)) };
    } catch (e) { return { error: e.message }; }
  });
  const VOICE_STUB = `<script>
  (function () {
    const V = [
      { name: 'Albert', lang: 'en-US', default: false, localService: true },
      { name: 'Bad News', lang: 'en-US', default: false, localService: true },
      { name: 'Bahh', lang: 'en-US', default: false, localService: true },
      { name: 'Zarvox', lang: 'en-US', default: false, localService: true },
      { name: 'Samantha', lang: 'en-US', default: true, localService: true },
      { name: 'Daniel', lang: 'en-GB', default: false, localService: true },
      { name: 'Google US English', lang: 'en-US', default: false, localService: false },
      { name: 'Kyoko', lang: 'ja-JP', default: false, localService: true }
    ];
    const spoken = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: function () { return V; },
        speak: function (u) { spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang }); },
        cancel: function () {},
        onvoiceschanged: null
      }
    });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.__spoken = spoken;
  })();
  </script>`;
  // localStorage は about:blank では使えないので、実オリジンを装って配信する
  await vpage.route('https://es.test/', route =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: buildHtml(VOICE_STUB) }));
  await vpage.goto('https://es.test/', { waitUntil: 'load' });
  await vpage.waitForFunction(() => document.getElementById('s-total').textContent !== '–', null, { timeout: 8000 });

  const vtext = async sel => (await vpage.textContent(sel) || '').trim();
  await check('自動選択が novelty voice を避ける', async () => {
    const label = await vtext('#st-voice option');
    if (/Albert|Bahh|Zarvox|Bad News/.test(label)) throw new Error('novelty voice を選んでいる: ' + label);
    if (!/Google US English/.test(label)) throw new Error('良質な音声が選ばれていない: ' + label);
  });
  await check('英語以外の音声は選択肢に出さない', async () => {
    const opts = await vpage.$$eval('#st-voice option', els => els.map(e => e.textContent));
    if (opts.some(o => /Kyoko/.test(o))) throw new Error('ja-JP が混ざっている');
    expect(opts.length, 8, '自動 + en 音声 7 件');
  });
  await check('実際に読み上げるのも Albert ではない', async () => {
    await vpage.click('.tabs button[data-view="settings"]');
    await vpage.click('#st-voice-test');
    const spoken = await vpage.evaluate(() => window.__spoken);
    if (!spoken.length) throw new Error('speak が呼ばれていない');
    if (/Albert|Bahh|Zarvox/.test(spoken[0].voice || '')) throw new Error('novelty voice で再生: ' + spoken[0].voice);
    expect(spoken[0].voice, 'Google US English', '選ばれた音声');
  });
  await check('手動で音声を選ぶと保存されて優先される', async () => {
    await vpage.selectOption('#st-voice', 'Samantha');
    await vpage.waitForTimeout(80);
    const spoken = await vpage.evaluate(() => window.__spoken);
    expect(spoken[spoken.length - 1].voice, 'Samantha', '選択した音声で再生');
    const saved = await vpage.evaluate(() => localStorage.getItem('es.voiceName'));
    expect(saved, 'Samantha', 'localStorage に保存');
  });
  await check('カードの読み上げは英語表現そのもの', async () => {
    await vpage.click('.tabs button[data-view="home"]');
    await vpage.click('#start-review');
    await vpage.waitForSelector('#qcard .term');
    const term = (await vpage.textContent('#qcard .term')).trim();
    await vpage.click('#sp1');
    const spoken = await vpage.evaluate(() => window.__spoken);
    expect(spoken[spoken.length - 1].text, term, '読み上げ内容');
  });
  await vpage.close();

  await browser.close();

  if (errors.length) {
    console.error('\nブラウザのエラー:');
    errors.forEach(e => console.error('  ' + e));
    fail += errors.length;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

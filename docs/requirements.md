# 英単語・フレーズ学習アプリ 要件定義（v0.2）

更新日: 2026-09-08 / ステータス: 事前確認待ち（§3）

---

## 0. 確定事項（v0.2 で決定）

| 項目 | 決定 |
|---|---|
| 復習アルゴリズム | **SM-2**（Anki 互換の4段階評価）。Reviews シートにログを残し、将来 FSRS へ移行可能な形にする |
| 1日の新規上限 | **20件**（復習は100件）。Settings で変更可 |
| 拡張の認証 | **共有トークン方式**（ただし §3-1 の確認結果次第で OAuth 方式に切替） |
| 意味取得 | **APIキー不要版を先に実装**（`LanguageApp.translate()` + Free Dictionary API）。Gemini 版は Enricher の差し替えで後から追加 |
| 実行アカウント | **Google Workspace (unext-hd.jp)** |
| UI言語 | 日本語 |

---

## 1. 目的とスコープ

### 目的
Web閲覧中・業務中に出会った英語表現を **摩擦ゼロで記録** し、**忘れる直前に再会させる** ことで使える語彙にする。

### 対象範囲
- 単語1語に限らず、**フレーズ / コロケーション / イディオム / センテンス** を同じ器で扱う
- 記録 → 意味・使い方の付与 → 間隔反復による復習 → 定着状況の可視化

### 非スコープ
- 複数ユーザー / チーム共有（設計上は拡張可能にするが、初期は個人1名）
- ネイティブ音声の収録（ブラウザ内蔵の音声合成で代替）
- モバイルネイティブアプリ（WebApp のレスポンシブ対応で代替）

---

## 2. システム構成

```
┌──────────────────────┐
│ Chrome拡張 (MV3)      │  選択テキスト → 右クリック / Alt+S
│  service worker       │──POST (CORS適用外)──┐
│  content script       │                      │
│  popup / options      │                      │
└──────────────────────┘                      ▼
                                  ┌───────────────────────────┐
┌──────────────────────┐          │ GAS Web App               │
│ ブラウザ (PC/スマホ)  │──GET────▶│  doGet  : HtmlService(UI) │
│  学習UI               │          │  doPost : 拡張からの登録  │
│  speechSynthesis 発音 │◀google.──│  Enricher : 意味取得       │
└──────────────────────┘ script.run└──────────┬────────────────┘
                                               │ LockService で直列化
                                     ┌─────────▼──────────┐
                                     │ スプレッドシート    │
                                     │ Items/Reviews/     │
                                     │ Settings           │
                                     └────────────────────┘
                                               │ UrlFetchApp（textのみ送信）
                                     外部: Free Dictionary API
                                     （将来）Gemini API
```

### 技術制約（調査結果）

| 項目 | 内容 |
|---|---|
| **MV3 の CORS**（v0.1 から訂正） | **background service worker からの fetch は、`host_permissions` に列挙したホストに対して CORS が適用されない**（プリフライトも発生しない）。したがって拡張→GAS の通信で `Content-Type: text/plain` 回避策は**不要**。ただし content script からの fetch はページのオリジンの CORS に従うため、必ず service worker に中継させる |
| GAS Web App の CORS | Web App 自体は OPTIONS プリフライトに応答しない。**拡張以外の外部Webページから叩く予定はないため、本件では問題にならない** |
| GAS 実行時間 | 1実行 6分（無料/Workspace 共通）。同時実行 30 |
| UrlFetch | Workspace **100,000回/日**。本用途では実質無制限 |
| トリガー総実行時間 | Workspace **6時間/日** |
| メール送信 | Workspace 1,500通/日 → 毎朝のリマインドは余裕 |
| `google.script.run` | 1往復 0.5〜2秒。**復習セッション開始時に出題分を一括取得し、回答はバッチ送信**する設計が必須 |
| 発音 | ブラウザ標準 `speechSynthesis`（APIキー不要・無料）。**iOS Safari はユーザー操作起因でないと再生されない**ため自動再生はせず、必ずボタン起因にする |
| スプレッドシート | 1000万セル上限。数千件なら余裕 |

---

## 3. 事前確認事項（実装前のブロッカー）

Workspace アカウントを使うため、以下は**コードを書く前に確認が必要**。結果によって拡張機能の設計が変わる。

| # | 確認事項 | 確認方法 | ブロックされていた場合 |
|---|---|---|---|
| **1** | Apps Script Web App を「**全員**」に公開できるか | GAS のデプロイ画面で「アクセスできるユーザー」に **「全員」** が選択肢として出るか。管理者が無効化できる設定 | 共有トークン方式が成立しない → **§7 の OAuth 方式（案B）に切替**。実装量が増える（GCP で OAuth クライアントID作成、拡張IDの固定） |
| **2** | Apps Script から外部ドメインへの `UrlFetch` が許可されているか | 管理コンソールの「Apps Script と Sheets の外部接続を許可」設定。GAS で `UrlFetchApp.fetch('https://api.dictionaryapi.dev/...')` を1回実行して確認するのが確実 | Free Dictionary API・Gemini が呼べない → **`LanguageApp.translate()` のみ**で運用（Google 内部サービスのため影響を受けにくい）。発音記号・英英定義は手動入力に |
| **3** | Chrome 拡張の**デベロッパーモード / 未署名拡張のインストール**が許可されているか | `chrome://extensions` でデベロッパーモードのトグルがグレーアウトしていないか。`chrome://policy` で `ExtensionInstallBlocklist` 等を確認 | 拡張が入らない → WebApp のみで運用、または Chrome Web Store に**限定公開（自分だけ）**で登録して配布 |
| **4** | 会社アカウントに個人の学習データを置く運用でよいか | 社内規程 | スプレッドシート・GAS プロジェクトは会社資産となり、**退職・異動時にデータを失う**。個人 Gmail に置く選択肢もある（クォータは 1/5 だが本用途では十分） |

**1〜3 は 30分程度で確認できる**ので、実装着手前に済ませることを推奨。

---

## 4. データモデル（スプレッドシート）

### 4.1 `Items` シート（1行1アイテム）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | string | `Utilities.getUuid()`。**行番号はIDにしない**（削除で狂うため） |
| `type` | enum | `word` / `phrase` / `idiom` / `sentence`。自動判定＋手動上書き可 |
| `text` | string | 英語表現そのもの |
| `lemma` | string | 重複判定・検索用の正規化キー（小文字化・前後空白除去・連続空白の圧縮・末尾句読点除去） |
| `phonetic` | string | 発音記号（例: `/əˈkɒmədeɪt/`） |
| `pos` | string | 品詞（複数可、カンマ区切り） |
| `meaning_ja` | string | 日本語の意味（主） |
| `meaning_en` | string | 英英定義 |
| `usage_note` | string | 使い方・ニュアンス・類義語との違い・共起語 |
| `example` | string | 例文（英） |
| `example_ja` | string | 例文の訳 |
| `tags` | string | カンマ区切り |
| `source_url` | string | 登録元URL |
| `source_context` | string | 選択箇所を含む前後の原文（最大300文字・最大3件を `\n---\n` 区切りで保持） |
| `encounter_count` | number | 同一表現への再遭遇回数（重複登録時に加算＝重要度シグナル） |
| `status` | enum | `new` / `learning` / `review` / `mastered` / `suspended` / `deleted` |
| `due_date` | date | 次回復習日（**日単位**。時刻は持たない） |
| `interval` | number | 現在の間隔（日） |
| `ease` | number | SM-2 の易しさ係数（初期 2.5 / 下限 1.3） |
| `reps` | number | 連続正答回数 |
| `lapses` | number | 忘却（Again）回数 |
| `last_reviewed_at` | datetime | 最終復習日時 |
| `created_at` / `updated_at` | datetime | — |

### 4.2 `Reviews` シート（追記のみ）

`log_id` / `item_id` / `reviewed_at` / `grade`(0-3) / `mode` / `elapsed_ms` / `prev_interval` / `new_interval`

**別シートにする理由**: 将来 FSRS へ差し替える際、過去ログがあれば再計算・パラメータ最適化ができる。月100件×3年でも約1万行で容量問題なし。

### 4.3 `Settings` シート（key-value）

`daily_new_limit`(20) / `daily_review_limit`(100) / `enrich_provider`(`none`|`translate`|`dict`|`translate+dict`|`gemini`) / `default_review_mode` / `tts_lang`(`en-US`|`en-GB`) / `session_size`(20) / `send_daily_reminder`(bool)

**APIキー・共有トークンは Settings シートに置かず、`PropertiesService.getScriptProperties()` に格納**（シートを共有・エクスポートした際の漏洩防止）。

### 4.4 type 自動判定

```
空白なし                              → word
2〜4語 かつ 文末に . ? ! がない       → phrase
　うち「動詞+前置詞/副詞」の形        → idiom（候補として提示、確定は手動）
5語以上 または 文末に . ? ! がある    → sentence
```
UI 上で常に手動変更可能。

### 4.5 重複登録の扱い

`lemma` 一致の既存行があれば **新規作成せずマージ**する。
- `encounter_count` +1、`source_context` / `source_url` を追記（3件まで、古いものから破棄）
- **SRS 状態（ease / interval / due_date）はリセットしない**
- UI/拡張のトーストに「登録済み（3回目の遭遇）」と表示

### 4.6 削除

物理削除せず `status = deleted` の**論理削除**。Reviews ログとの整合性を保つため。一覧では非表示、「ゴミ箱」画面から完全削除可能。

### 4.7 同時書き込み

拡張の `doPost` と WebApp の書き込みが競合しうるため、全書き込み処理を **`LockService.getScriptLock()`（待機30秒）で直列化**する。

---

## 5. 復習アルゴリズム（SM-2 / 確定）

### 5.1 スケジューリング擬似コード

```js
const AGAIN = 0, HARD = 1, GOOD = 2, EASY = 3;

function schedule(item, grade, today) {
  let { ease = 2.5, interval = 0, reps = 0, lapses = 0 } = item;
  let status;

  if (grade === AGAIN) {
    reps = 0;
    lapses += 1;
    ease = Math.max(1.3, ease - 0.20);
    interval = 0;                       // 当日中に再出題（セッション内キューで処理）
    status = 'learning';
  } else if (reps === 0) {              // 初回、または忘却直後の再学習
    interval = (grade === EASY) ? 4 : 1;
    if (grade === HARD) ease = Math.max(1.3, ease - 0.15);
    if (grade === EASY) ease = ease + 0.15;
    reps = 1;
    status = 'review';
  } else {
    if (grade === HARD) { ease = Math.max(1.3, ease - 0.15); interval = interval * 1.2; }
    if (grade === GOOD) { interval = interval * ease; }
    if (grade === EASY) { ease = ease + 0.15; interval = interval * ease * 1.3; }
    reps += 1;
    status = 'review';
  }

  let due;
  if (interval > 0) {
    const fuzz = 1 + (Math.random() * 0.1 - 0.05);          // ±5%（復習の集中を防ぐ）
    interval = Math.min(Math.max(1, Math.round(interval * fuzz)), 730);
    due = addDays(today, interval);
  } else {
    due = today;
  }

  if (interval >= 180 && lapses === 0) status = 'mastered';
  return { ease, interval, reps, lapses, due_date: due, status };
}
```

### 5.2 セッション内の再出題

`AGAIN` を押したカードは **クライアント側のキューに戻し、同セッション内で最低3枚後に再出題**する。
**DB への書き込みはセッション終了時の最終状態で1回だけ**（分単位の再出題をシートに記録しない）。往復回数と行更新を最小化する。

### 5.3 出題対象の抽出と順序

```
1. 期限切れ（due_date < today）      … due_date の古い順
2. 本日期限（due_date = today）       … encounter_count の多い順
3. 新規（status = new）               … encounter_count 多い順 → created_at 古い順
   ただし 1日 daily_new_limit(20) 件まで
```
1+2 の合計が `daily_review_limit`(100) を超える場合は上位100件で打ち切り、残りは翌日に繰り越す。
「**何度も出会う表現ほど優先**」を新規の並び順に組み込む点が本設計の特徴。

---

## 6. 出題形式（type に応じて切替）

| モード | 内容 | 主な対象 type | Phase |
|---|---|---|---|
| **フラッシュカード** | 表(英)→裏(意味・例文・使い方)。自己採点4段階 | すべて | 1 |
| **4択** | 誤答選択肢を**同タグ・同品詞の既存アイテムから自動生成**（不足時は同 type からランダム） | word / phrase | 3 |
| **タイピング** | 日本語→英語を打つ。綴り想起は記憶効果が最も強い | word / phrase | 3 |
| **穴埋め (Cloze)** | 例文中のターゲットを空欄にして補充 | phrase / idiom / sentence | 3 |
| **並べ替え** | 単語チップをドラッグして文を組み立てる | sentence | 3 |
| **リスニング** | `speechSynthesis` で読み上げ → 綴り or 意味を答える | すべて | 3 |

### タイピング判定の正規化
大小文字・前後空白・連続空白・句読点・冠詞(a/an/the)の有無を無視して判定。
**Levenshtein 距離1以内は「惜しい（タイポ）」**として正解扱い＋綴り注意を表示。

### セッション設計
1セッション既定20問。開始時に対象を一括取得、回答は**5問ごと＋終了時**にバッチ送信。

---

## 7. Chrome 拡張（Manifest V3）

### 7.1 機能
- `contextMenus`: 選択テキストを右クリック →「英語帳に追加」
- `commands`: 既定 `Alt+S` で選択テキストを即登録
- content script: **選択範囲を含む1文＋前後各1文（最大300文字）**を抽出して `source_context` に載せる
- popup: 手動入力フォーム＋「意味を取得」＋直近5件の登録履歴
- options: Web App URL / トークン / 既定タグの設定
- 登録結果をトースト表示（成功 / 重複マージ / 失敗）
- 補助: 右クリックから Weblio / Cambridge を別タブで開くメニュー（辞書サイトは `X-Frame-Options` で iframe 表示できないため）

### 7.2 通信

```js
// background.js（service worker）— host_permissions があるため CORS 非適用
const res = await fetch(WEBAPP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, action: 'add', text, url, context })
});
```

`manifest.json` の `host_permissions` に **`https://script.google.com/*` と `https://script.googleusercontent.com/*` の両方**を指定（GAS Web App は 302 リダイレクトするため）。

### 7.3 認証（§3-1 の結果で分岐）

| 案 | 前提 | 内容 | 実装量 |
|---|---|---|---|
| **A. 共有トークン**（第一候補・確定済み） | Web App を「全員」で公開できる | リクエストに固定トークンを付け、GAS が Script Properties の値と `Utilities.computeHmacSha256Signature` で照合。トークンは拡張の options に保存 | 小 |
| **B. OAuth** | 「全員」公開が禁止されている場合 | `chrome.identity.getAuthToken()` で OAuth アクセストークンを取得し、`Authorization: Bearer` で Web App を叩く。Web App の公開範囲は「組織内」でよい。service worker からの fetch なのでプリフライトは発生しない | 中（GCP で OAuth クライアントID作成、`manifest.key` で拡張IDを固定） |

案A の限界: 拡張のソースは読めるため**トークンは完全な秘密にはならない**。個人利用では実用上十分で、漏洩時はトークン再発行で対処する。ただし Web App が匿名公開である以上、**URLとトークンが漏れれば第三者が書き込める**点は受け入れるリスクとして明記する。

---

## 8. 意味・使い方の自動取得（Enricher）

### 8.1 インタフェース

```js
/**
 * @param {{text: string, type: string}} input   // ← context は渡さない（§9）
 * @return {{meaning_ja, meaning_en, phonetic, pos, example, example_ja, usage_note, _provider}}
 */
function enrich(input) { /* provider によって実装を切替 */ }
```
Settings の `enrich_provider` で実装を選ぶ。**プロバイダを増やしても呼び出し側は変えない**。

### 8.2 Phase 2 実装（APIキー不要版・確定）

| プロバイダ | 埋まる列 | 備考 |
|---|---|---|
| `LanguageApp.translate(text, 'en', 'ja')` | `meaning_ja`, `example_ja` | **GAS 標準サービス。APIキー不要・無料・Google 内部処理**。単なる機械翻訳のため品詞・複数語義・ニュアンスは出ない。フレーズ/センテンスには十分実用的 |
| Free Dictionary API<br>`GET https://api.dictionaryapi.dev/api/v2/entries/en/{word}` | `phonetic`, `pos`, `meaning_en`, `example` | **キー登録不要**（ただし第三者の外部API）。**単語1語のみ対応**（フレーズ・センテンスでは 404）。コミュニティ運営で可用性保証なし |

**既定は `translate+dict`**。type が `word` のときのみ Dictionary API を呼び、`phrase`/`sentence` では translate のみ。

**埋まらない列**: `usage_note`（使い方・ニュアンス）。これは手動入力か Gemini 版待ち。

### 8.3 Phase 3 実装（Gemini 版・後付け）

`gemini-2.5-flash` 等に JSON スキーマを固定した構造化出力で問い合わせ、`meaning_ja` / `pos` / `usage_note` / `example` / `example_ja` を**1リクエストで全部埋める**。辞書APIでは埋まらない「使い方・ニュアンス・類義語との違い」がここで初めて埋まる。
- APIキーは Script Properties にのみ保持。拡張側には置かない
- 無料枠は 2025年12月に絞られており日次上限の公開情報が割れている。**個人利用の想定量（1日20〜30件）なら足りる見込みだが、実測が必要**。不足すれば従量課金（Flash 系は極めて安価）

### 8.4 共通仕様
- 取得結果は Items シートに保存＝キャッシュ。同じ `lemma` の2回目以降は外部呼び出しなし
- **取得失敗時も登録は必ず成功させる**（空欄で保存 →「未整備キュー」へ）。取得失敗で記録が失われるのが最悪のUX
- 取得内容は**保存前に必ず編集可能**（自動生成を鵜呑みにしない）
- 外部API呼び出しは 1回あたり 5秒でタイムアウト、失敗時リトライなし

---

## 9. データ保護方針（設計上の制約）

業務中のページから登録するため、`source_context` に社内情報や取引先名が混入しうる。以下を**設計上の制約として固定**する。

1. **Enricher が Google 外部に送信してよいのは `text`（英語表現そのもの）のみ**。`source_context` / `source_url` / `tags` は送信しない
2. `LanguageApp.translate()` は Google Workspace 内のサービス。Free Dictionary API は**完全な第三者サービス**であることを認識して使う
3. Gemini 版でも同じ制約を適用する。文脈を渡せば訳の精度は上がるが**既定はオフ**。設定で明示的にオプトインした場合のみ送信し、その際は UI に注意表示を出す
4. 社外秘ページからの登録時は、拡張のトーストに「文脈を保存しました。外部送信はされません」と明示する
5. スプレッドシートの共有設定は**自分のみ**を既定とする

---

## 10. サーバーAPI仕様

### 10.1 WebApp から（`google.script.run`）

| 関数 | 引数 | 戻り |
|---|---|---|
| `api_getDashboard()` | — | `{dueCount, newCount, streak, heatmap[], totalCount, unenrichedCount}` |
| `api_getReviewSession(opts)` | `{limit, modes}` | `{cards: [...出題に必要な列のみ]}` |
| `api_submitReviews(payload)` | `{results: [{item_id, grade, mode, elapsed_ms}]}` | `{ok, updated}` |
| `api_listItems(q)` | `{query, type, status, tags, offset, limit}` | `{items: [...軽量列], total}` |
| `api_getItem(id)` | `id` | `{item}` |
| `api_upsertItem(payload)` | item | `{item, merged}` |
| `api_deleteItem(id)` | `id` | `{ok}` |
| `api_enrich(input)` | `{text, type}` | `{data}` |
| `api_getSettings()` / `api_saveSettings(obj)` | — | `{settings}` |
| `api_exportCsv(opts)` | `{format: 'csv'\|'anki'}` | `{fileUrl}` |

一覧の軽量列 = `id, text, meaning_ja, type, tags, status, due_date, encounter_count`。
3,000件までは初回に全件返してクライアント側で検索・絞り込み（往復レイテンシ回避）。超えたらページングに切替。

### 10.2 拡張から（HTTP）

```
POST {WEBAPP_URL}
  { token, action: 'add',    text, url, context, tags? }  → { ok, id, merged, item }
  { token, action: 'enrich', text, type }                  → { ok, data }
GET  {WEBAPP_URL}?token=...&action=recent&limit=5          → { ok, items }
```
`doPost` では `Session.getActiveUser()` が取得できない（匿名公開のため）点に注意。認証は token のみで行う。

---

## 11. WebApp UI

### 方針
- **モバイルファースト**（スマホの隙間時間での復習が主用途）
- ダークモード対応、タップ領域を大きく、正誤は色とアニメーションで即時フィードバック
- PC ではキーボードショートカット（`Space`=めくる、`1`〜`4`=評価、`E`=編集、`P`=発音）

### 画面

| 画面 | 内容 |
|---|---|
| **ホーム** | 今日の復習件数 / 新規件数 / 連続学習日数(streak) / 直近8週のヒートマップ / 総登録数 / 未整備件数 / 「復習を始める」CTA |
| **登録 (Add)** | 英語表現を入力 →「意味を取得」→ 自動補完 → 編集して保存。type / タグ / 例文 / 出典を編集可 |
| **一覧 (Library)** | 全文検索、type・status・タグ絞り込み、並び替え（登録日 / 次回復習日 / 遭遇回数）、インライン編集、論理削除、CSVエクスポート |
| **復習 (Review)** | 進捗バー、カード、4段階評価ボタン、発音ボタン、その場で編集、終了サマリ（正答率・所要時間・次回予定） |
| **未整備キュー** | `meaning_ja` が空のアイテムだけを並べ、まとめて埋める |
| **ゴミ箱** | 論理削除済みの復元 / 完全削除 |
| **設定** | 1日の上限、既定の出題モード、Enricher プロバイダ、TTS音声（US/UK）、APIキー登録 |

### スマホ運用
GAS Web App の URL をホーム画面に追加して使う（GAS は `manifest.json` を配信できないため真の PWA にはならない）。Google ログインが切れると再認証が必要。

---

## 12. 非機能要件

- **応答性**: カードのめくり操作はサーバー往復なし（クライアント完結）。登録は3秒以内
- **可用性**: 外部API障害時も登録・復習は継続できる
- **可搬性**: CSV エクスポート。Anki 取り込み用の `text<TAB>meaning` 形式も出力
- **バックアップ**: 日次トリガーでスプレッドシートを Drive に複製（7世代保持）
- **監視**: エラーは `console.error` + 週次で自分宛にサマリメール（Phase 4）

---

## 13. リポジトリ構成

```
/
├─ README.md
├─ docs/requirements.md
├─ gas/                      # clasp で管理
│  ├─ .clasp.json  appsscript.json
│  ├─ Code.gs                # doGet / doPost エントリ
│  ├─ Api.gs                 # google.script.run 用 api_* 関数
│  ├─ Repository.gs          # シートCRUD + LockService
│  ├─ Srs.gs                 # SM-2
│  ├─ Enricher.gs            # 意味取得（プロバイダ切替）
│  ├─ Setup.gs               # シート初期化・トークン生成
│  └─ ui/  index.html  style.html  app.html
└─ extension/
   ├─ manifest.json  background.js  content.js
   ├─ popup.html  popup.js
   └─ options.html  options.js
```
GAS 側は **clasp** でローカル管理し、Git で履歴を残す。

---

## 14. 開発フェーズ

| Phase | 内容 |
|---|---|
| **0** | §3 の事前確認（1〜3）。ここで拡張の認証方式が確定する |
| **1 (MVP)** | シート初期化 / GAS WebApp（ホーム・登録・一覧・復習[フラッシュカード]）/ SM-2 / 発音 |
| **2** | Chrome拡張（右クリック・Alt+S・popup）/ Enricher（キー不要版）/ **毎朝のリマインドメール** |
| **3** | Gemini 版 Enricher / 出題モード追加（4択・タイピング・Cloze・並べ替え・リスニング）/ 統計 |
| **4** | CSV・Anki エクスポート / バックアップ / 週次サマリ |

**毎朝のリマインドメールを Phase 2 に前倒し**する。継続率に最も効くのは復習の入口を毎日作ることで、実装は時間トリガー＋`MailApp.sendEmail` の数十行で済むため。

---

## 15. 未決事項

1. §3 の事前確認 1〜3 の結果（**Phase 0**）
2. `usage_note` を Phase 2 の時点でどう埋めるか（手動入力のみ / Gemini を前倒しする / 空のまま運用する）
3. タグの初期セット（`work` / `meeting` / `email` / `TOEIC` / `IT` など）を決めるか、運用しながら育てるか
4. 復習のリマインド時刻（毎朝何時か）

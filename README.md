# English Studying

Google Apps Script + スプレッドシートで作る、英単語・フレーズ・センテンスの記録＆間隔反復復習アプリ。

単語1語に限らず、**フレーズ・イディオム・センテンス**を同じ器で扱い、種別に応じて出題を変える。

## いまできること（Phase 1 完了）

- **登録**: WebApp から英語表現を登録。種別（単語 / フレーズ / センテンス）は自動判定、品詞は種別に応じた選択肢から選択。**意味が空でも保存できる**
- **復習**: SM-2（Anki 互換の4段階評価）によるフラッシュカード。ブラウザ内蔵の音声合成で発音再生。キーボード操作対応
- **一覧**: 全文検索、種別・品詞・状態での絞り込み、並び替え、編集、論理削除と復元、休止
- **未整備キュー**: 意味が未入力のものを1件ずつ埋める。未整備は復習に出題されない
- **ホーム**: 今日の復習・新規・未整備の件数、連続学習日数、8週間のヒートマップ

## セットアップ

[docs/SETUP.md](docs/SETUP.md) を参照（所要 15〜20 分）。

## ドキュメント

- [要件定義 v0.4](docs/requirements.md)
- [セットアップ手順](docs/SETUP.md) — 初回のデプロイまで
- [自動デプロイの設定](docs/DEPLOY.md) — GitHub Actions から Apps Script へ反映する

## 構成

```
gas/                  Apps Script（clasp 管理）
  Code.gs             doGet（トークン検証 → UI 配信）
  Api.gs              google.script.run 用の api_* 関数
  Repository.gs       シート CRUD + LockService による直列化
  Srs.gs              SM-2
  Utils.gs            lemma 正規化・種別判定・日付
  Constants.gs        列定義 / type / pos / 既定設定
  Setup.gs            シート初期化・トークン発行
  ui/                 index.html / style.html / app.html
.github/workflows/
  deploy-gas.yml      gas/** の変更を clasp で Apps Script へ反映
tools/                Node 上の検証ツール
  fake-gas.js         SpreadsheetApp 等を偽装する GAS ランタイム
  test.js             純粋関数の単体テスト
  integration-test.js 偽シートでサーバー側を通しで検証
  e2e.js              実 UI を Chromium で動かす E2E
```

## 開発

```bash
npm install
npm test      # 単体 + 結合（189 assertions）
npm run e2e   # ブラウザ E2E（25 checks）
```

GAS にデプロイしなくてもサーバーロジックと UI の両方を検証できる。

## この先

| Phase | 内容 |
|---|---|
| 2 | Chrome 拡張（右クリック / `Alt+S` 登録）、共有トークン認証、意味の自動取得（APIキー不要版） |
| 3 | Gemini 版の意味取得、出題形式の追加（4択・タイピング・穴埋め・並べ替え・リスニング） |
| 4 | CSV / Anki エクスポート、日次バックアップ |

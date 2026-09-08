# GitHub Actions から Apps Script へ自動デプロイする

`gas/` 配下を変更して push すると、GitHub Actions が clasp で Apps Script へ反映する。
ワークフロー本体は [`.github/workflows/deploy-gas.yml`](../.github/workflows/deploy-gas.yml)。

設定は一度だけ。所要 10〜15 分。

---

## 仕組み

```
git push (gas/** が変更)
        │
        ▼
  GitHub Actions
    1. npm test            … 落ちたらここで止まる
    2. clasp push -f       … エディタ上のコードを更新
    3. clasp redeploy <ID> … 既存デプロイを新バージョンに差し替え
        │
        ▼
  Apps Script（/exec の URL は変わらない）
```

**3 が要**。`clasp push` はエディタ上のコードを更新するだけで、`/exec` は**デプロイ済みバージョンのスナップショット**を配信し続ける。既存の deployment ID を指定して差し替えることで、**URL を変えずに**公開版を更新する。

> `clasp deploy`（ID 指定なし）を使うと**新しいデプロイ＝新しい URL** ができてしまい、ブックマークが変わる。ワークフローでは使っていない。

---

## 手順

### 1. Apps Script API を有効にする

[script.google.com/home/usersettings](https://script.google.com/home/usersettings) で
**「Google Apps Script API」をオン**にする。

オフのままだと `User has not enabled the Apps Script API` で失敗する。
Workspace の管理者が無効化している場合は、この方式自体が使えない。

### 2. ローカルで clasp にログインする

自分の PC で実行する（GitHub Actions 側ではブラウザ認証ができないため、ここだけは手作業）。

```bash
npx @google/clasp@3 login
```

ブラウザが開くので、**アプリを動かすアカウント**でログインして承認する。
成功すると `~/.clasprc.json` が作られる。

```bash
ls -l ~/.clasprc.json   # 作られていることを確認
```

> `npm install -g` でも構わないが、グローバルの bin が PATH に入っていないと
> `clasp: command not found` になる（nvm 利用時は Node のバージョンを切り替えると消える）。
> `.clasprc.json` を一度作るだけが目的で、CI 側は自前で clasp を入れるため、
> `npx` で済ませるのが確実。

### 3. 登録する 3 つの値を用意する

#### `CLASPRC_JSON_B64` — 認証情報

`~/.clasprc.json` を base64 にしたもの。手順 4 で `gh` CLI を使うならこの手順は不要
（パイプで直接渡せる）。ブラウザで登録する場合だけクリップボードに載せる。

```bash
# macOS
base64 -i ~/.clasprc.json | tr -d '\n' | pbcopy

# Linux
base64 -w0 ~/.clasprc.json | xclip -selection clipboard
```

> base64 にするのは、複数行 JSON がログに部分的に露出するのを避けるため。

#### `GAS_SCRIPT_ID` — スクリプト ID

Apps Script エディタ → 左メニューの ⚙（プロジェクトの設定）→ **「スクリプト ID」**。

#### `GAS_DEPLOYMENT_ID` — デプロイ ID

Apps Script エディタ → 右上の **「デプロイ」→「デプロイを管理」** → 対象のデプロイの **「デプロイ ID」**。
`AKfycb...` で始まる文字列で、ウェブアプリ URL の `/macros/s/` と `/exec` の間にあるものと同じ。

コマンドでも確認できる。

```bash
cd gas
echo '{"scriptId":"＜スクリプトID＞","rootDir":"."}' > .clasp.json
npx @google/clasp@3 list-deployments
```

```
2 Deployments.
- AKfycbxxxx @HEAD          ← これは開発用（/dev）。使わない
- AKfycbyyyy @1 - v1        ← こちらを登録する
```

`@HEAD` は開発用デプロイなので**使わない**。バージョン番号が付いている方を登録する。

### 4. GitHub に Secrets を登録する

登録するのは次の 3 件。

| Name | 値 | 必須 |
|---|---|---|
| `CLASPRC_JSON_B64` | `~/.clasprc.json` の base64 | 必須 |
| `GAS_SCRIPT_ID` | スクリプト ID | 必須 |
| `GAS_DEPLOYMENT_ID` | デプロイ ID | 任意（未設定ならエディタ上のコードのみ更新し、`/exec` は据え置き） |

#### gh CLI で登録する

トークンが画面にもシェル履歴にも残らない。`gh` が入っていない環境で、
これだけのために Homebrew を入れる必要はない。その場合は次の「ブラウザで登録する」でよい
（Homebrew なしで入れたい場合は [cli/cli の Releases](https://github.com/cli/cli/releases) の `.pkg`）。

```bash
gh auth login       # 未認証なら

# パイプで直接渡す。値は表示されない
base64 -i ~/.clasprc.json | tr -d '\n' \
  | gh secret set CLASPRC_JSON_B64 --repo ＜owner＞/＜repo＞

# 残りは隠し入力のプロンプトで貼り付ける
gh secret set GAS_SCRIPT_ID --repo ＜owner＞/＜repo＞
gh secret set GAS_DEPLOYMENT_ID --repo ＜owner＞/＜repo＞

gh secret list --repo ＜owner＞/＜repo＞   # 確認
```

#### ブラウザで登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で 3 件登録する。
`CLASPRC_JSON_B64` は手順 3 でクリップボードに入れた base64 文字列を貼り付ける。

### 5. 動かして確認する

**Actions** タブ → 左の **Deploy to Apps Script** → **Run workflow** で手動実行できる。

成功したら Apps Script エディタを開いてコードが更新されていること、
ブックマークした `/exec?t=…` の URL で変更が反映されていることを確認する。

以降は `gas/` 配下を変更して `main`（または `claude/english-learning-app-95l8jo`）に push するだけで自動的に反映される。

---

## セキュリティ上の注意

`CLASPRC_JSON_B64` の中身は Google アカウントの**リフレッシュトークン**で、
Apps Script プロジェクトと Drive への長期アクセス権を持つ。

- **GitHub Secrets の値は登録後に読み直せない**（管理者でも参照不可）。控えを手元に残すなら、それ自体を安全に保管する
- **Secrets を読めるのは、トリガー対象ブランチに workflow を push できる人**。`main` などのトリガー対象ブランチには branch protection をかける
- Public リポジトリの場合、fork からの Pull Request には Secrets は渡らない（GitHub の既定動作）。このワークフローは `push` と `workflow_dispatch` のみをトリガーにしており、`pull_request_target` は使っていない
- さらに堅くするなら **Settings → Environments** で承認者付きの environment を作り、ジョブに紐づける

---

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| `User has not enabled the Apps Script API` | 手順 1 が未実施。有効化してから数分待って再実行 |
| `invalid_grant` / `Token has been expired or revoked` | リフレッシュトークンが失効した。ローカルで `npx @google/clasp@3 login` をやり直し、`CLASPRC_JSON_B64` を更新する |
| `Secrets ... を設定してください` で失敗 | `CLASPRC_JSON_B64` か `GAS_SCRIPT_ID` が未登録 |
| push は成功するが `/exec` が古いまま | `GAS_DEPLOYMENT_ID` が未設定か、`@HEAD` の方の ID を登録している |
| ウェブアプリの URL が変わってしまった | ID 指定なしの `clasp deploy` を手で実行した可能性。古いデプロイの ID を `GAS_DEPLOYMENT_ID` に登録し直すか、新しい URL でブックマークを更新する |
| `clasp: command not found` | グローバル install の bin が PATH にない。`npx @google/clasp@3 <command>` で実行するか、`$(npm prefix -g)/bin` を PATH に追加する |
| `clasp login` 自体が失敗する | Workspace の管理者が third-party の OAuth アプリを制限している可能性。管理者に確認が必要 |

## ワークフローを止めたいとき

`.github/workflows/deploy-gas.yml` の `on.push` を消せば手動実行（`workflow_dispatch`）だけになる。
完全に止めるならファイルを削除し、Secrets も削除する。

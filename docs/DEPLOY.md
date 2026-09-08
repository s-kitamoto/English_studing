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

> **最初のデプロイだけは手で作る必要がある。**
> CI がやるのは「既存デプロイを新バージョンに差し替える」ことだけで、
> これは URL を変えないための仕様。デプロイが 1 つも無い状態では
> `GAS_DEPLOYMENT_ID` も存在しないので、下の順番どおりに進める。

### 1. Apps Script API を有効にする

[script.google.com/home/usersettings](https://script.google.com/home/usersettings) で
**「Google Apps Script API」をオン**にする。

オフのままだと `User has not enabled the Apps Script API` で失敗する。
Workspace の管理者が無効化している場合は、この方式自体が使えない。

### 2. ローカルで clasp にログインする

自分の PC で実行する（GitHub Actions 側ではブラウザ認証ができないため、ここだけは手作業）。

```bash
npx @google/clasp@3 login
ls -l ~/.clasprc.json   # 作られていることを確認
```

ブラウザが開くので、**アプリを動かすアカウント**でログインして承認する。

> `npm install -g` でも構わないが、グローバルの bin が PATH に入っていないと
> `clasp: command not found` になる（nvm 利用時は Node のバージョンを切り替えると消える）。
> `.clasprc.json` を一度作るだけが目的で、CI 側は自前で clasp を入れるため、
> `npx` で済ませるのが確実。

### 3. Secrets を 2 件だけ登録する

この時点ではまだデプロイが無いので、`GAS_DEPLOYMENT_ID` は後回しにする。

| Name | 値 |
|---|---|
| `CLASPRC_JSON_B64` | `~/.clasprc.json` を base64 にしたもの |
| `GAS_SCRIPT_ID` | Apps Script エディタ → ⚙ プロジェクトの設定 → **スクリプト ID** |

#### ブラウザで登録する

```bash
# macOS。クリップボードに base64 を載せる
base64 -i ~/.clasprc.json | tr -d '\n' | pbcopy
```

リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
で 2 件登録する。base64 にするのは、複数行 JSON がログに部分露出するのを避けるため。

#### gh CLI で登録する

トークンが画面にもシェル履歴にも残らない。`gh` が入っていない環境で、これだけのために
Homebrew を入れる必要はない（入れたい場合は [cli/cli の Releases](https://github.com/cli/cli/releases) の `.pkg`）。

```bash
gh auth login       # 未認証なら

base64 -i ~/.clasprc.json | tr -d '\n' \
  | gh secret set CLASPRC_JSON_B64 --repo ＜owner＞/＜repo＞
gh secret set GAS_SCRIPT_ID --repo ＜owner＞/＜repo＞   # 隠し入力で貼る

gh secret list --repo ＜owner＞/＜repo＞                # 確認
```

### 4. ワークフローを回してコードを入れる

**Actions** タブ → 左の **Deploy to Apps Script** → **Run workflow**。

`GAS_DEPLOYMENT_ID` が未設定でも `clasp push` までは実行され、
「公開版の更新は行いません」という notice を出して正常終了する。

Apps Script エディタを開き、`Code.gs` などが入っていることを確認する。

> ローカルに clasp がある場合は `cd gas && npx @google/clasp@3 push -f` でも同じ。

### 5. `setup()` を実行する

エディタ上部の関数プルダウンで `setup` を選び「実行」。初回は権限の承認を求められる。

実行ログにスプレッドシートの URL とトークンが出る（[SETUP.md](SETUP.md) 参照）。

### 6. 最初のデプロイを作る（ここで初めてデプロイ ID ができる）

**デプロイ → 新しいデプロイ** → 歯車から種類に **ウェブアプリ** を選ぶ。

| 項目 | 設定 |
|---|---|
| 説明 | `v1` |
| 次のユーザーとして実行 | **自分** |
| アクセスできるユーザー | **自分のみ**（Phase 2 で拡張をつなぐときに「全員」へ変更） |

完了画面に出る **デプロイ ID** と **ウェブアプリ URL** を控える。
`<ウェブアプリURL>?t=<トークン>` をブックマークする。

以後は「デプロイ → デプロイを管理」からいつでもデプロイ ID を確認できる。
コマンドなら次のとおり。

```bash
cd gas
echo '{"scriptId":"＜スクリプトID＞","rootDir":"."}' > .clasp.json
npx @google/clasp@3 list-deployments
```

```
2 Deployments.
- AKfycbxxxx @HEAD          ← 開発用（/dev）。使わない
- AKfycbyyyy @1 - v1        ← こちらを登録する
```

`@HEAD` は開発用デプロイなので**使わない**。バージョン番号が付いている方を登録する。

### 7. `GAS_DEPLOYMENT_ID` を追加登録する

手順 3 と同じ場所に 3 件目として登録する。

```bash
gh secret set GAS_DEPLOYMENT_ID --repo ＜owner＞/＜repo＞
```

これで完成。以降は `gas/` 配下を変更して `main`（または `claude/english-learning-app-95l8jo`）に
push するだけで、**URL を変えずに**公開版まで自動更新される。

### 8. 通しで確認する

`gas/` の何かを少し変えて push し、Actions が緑になったあと、
ブックマークした `/exec?t=…` に変更が反映されていることを確認する。

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
| デプロイを管理に「このプロジェクトはまだデプロイされていません」と出る | まだ一度もデプロイしていない。手順 6 で最初のデプロイを手で作る。CI は既存デプロイの差し替えしかしないため、最初の 1 回は手動が必須 |
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

# Japan Monitor デプロイ手順書

作成日: 2026-02-27
対象: `japan.koide.io` の初回本番デプロイ

---

## 現状

| 項目 | 状態 |
|---|---|
| GitHub リポジトリ | ✅ `Junji-Koide/worldmonitor` (private) |
| Vercel プロジェクト | ⬜ `.vercel/` 未作成（Vercel との紐付けが必要） |
| `japan.koide.io` DNS | ❌ NXDOMAIN（Route53 未設定） |
| GitHub Secrets | ⬜ VERCEL_TOKEN 等の設定状況不明 |
| CI/CD ワークフロー | ✅ `.github/workflows/deploy.yml` 作成済み |

---

## デプロイの全体像

```
push to main
    │
    ▼
GitHub Actions (deploy.yml)
    ├── vercel pull        # Vercel プロジェクト設定を取得
    ├── vercel build --prod # VITE_VARIANT=japan でビルド
    ├── vercel deploy      # Vercel 本番環境にデプロイ
    └── Cloudflare purge   # CDN キャッシュをパージ
```

DNS ルーティング:
```
ユーザー → japan.koide.io
    → Route53 (koide.io ホストゾーン)
    → CNAME: cname.vercel-dns.com
    → Vercel Edge Network
```

---

## Step 1: Vercel プロジェクトの作成・紐付け

### 1-1. Vercel ダッシュボードでプロジェクト作成

1. https://vercel.com/dashboard を開く
2. **Add New → Project** をクリック
3. `Junji-Koide/worldmonitor` リポジトリをインポート
4. 以下を設定:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build:japan`
   - **Output Directory:** `dist`
   - **Root Directory:** `.` (デフォルト)
5. **Environment Variables** に追加:
   ```
   VITE_VARIANT = japan
   ```
6. **Deploy** をクリック（初回ビルドを実行）

### 1-2. Vercel CLI でローカルに紐付け

```bash
cd /home/koide/projects/project-i/worldmonitor

# Vercel CLI インストール（未インストールの場合）
npm install -g vercel@latest

# ログイン
vercel login

# プロジェクトと紐付け（`.vercel/project.json` が生成される）
vercel link

# 環境変数を取得して動作確認
vercel env pull .env.local
```

> `.vercel/` ディレクトリは `.gitignore` に含める（既に含まれているはず）

---

## Step 2: GitHub Secrets の設定

`.github/workflows/deploy.yml` が使用するシークレットを設定する。

**設定場所:** GitHub リポジトリ → Settings → Secrets and variables → Actions

### 2-1. VERCEL_TOKEN

```bash
# Vercel ダッシュボード → Settings → Tokens → Create Token
# スコープ: Full Account
```

| Secret 名 | 値 |
|---|---|
| `VERCEL_TOKEN` | Vercel で発行したトークン |

### 2-2. Cloudflare 設定（CDN を使う場合）

deploy.yml には Cloudflare キャッシュパージステップがある。
Cloudflare CDN を使わない場合は deploy.yml からこのステップを削除してよい。

Cloudflare CDN を使う場合:
1. Cloudflare ダッシュボード → 対象ゾーン → Overview で **Zone ID** を確認
2. My Profile → API Tokens → Create Token (Zone:Cache Purge 権限)

| Secret 名 | 値 |
|---|---|
| `CLOUDFLARE_ZONE_ID` | Cloudflare の Zone ID |
| `CLOUDFLARE_API_TOKEN` | Cache Purge 権限付き API Token |

> **注意:** `koide.io` の DNS は Route53 管理。Cloudflare CDN を使う場合は「DNS のみ (Proxy OFF)」または「Full Proxy」構成を別途検討。Cloudflare CDN を使わない場合は Step 2-2 をスキップして deploy.yml の purge ステップを削除する。

---

## Step 3: Vercel カスタムドメインの追加

1. Vercel ダッシュボード → 対象プロジェクト → **Settings → Domains**
2. `japan.koide.io` を入力して **Add**
3. Vercel が表示する DNS レコード値を控える:
   ```
   Type: CNAME
   Name: japan
   Value: cname.vercel-dns.com   ← Vercel が指定する値を使うこと
   ```

---

## Step 4: Route53 DNS レコードの追加

1. AWS マネジメントコンソール → Route 53 → ホストゾーン → `koide.io`
2. **レコードを作成** をクリック
3. 以下を入力:

| 項目 | 値 |
|---|---|
| レコード名 | `japan` |
| レコードタイプ | CNAME |
| 値 | `cname.vercel-dns.com`（Step 3 で確認した値） |
| TTL | `300` |

4. **レコードを作成** をクリック

### DNS 伝播の確認

```bash
# TTL が 300 秒なので、最大 5 分後に確認
dig japan.koide.io

# 期待される結果:
# japan.koide.io. 300 IN CNAME cname.vercel-dns.com.

# HTTPS で疎通確認
curl -I https://japan.koide.io
# → HTTP/2 200 が返れば完了
```

---

## Step 5: 初回デプロイの実行

### 自動デプロイ（main へのプッシュ）

```bash
git push origin main
# → GitHub Actions の deploy.yml が自動実行される
```

### 手動デプロイ（ワークフロー手動実行）

GitHub リポジトリ → Actions → **Deploy to Vercel** → **Run workflow**
- variant: `japan` を選択して実行

### Vercel CLI から直接デプロイ

```bash
VITE_VARIANT=japan vercel deploy --prod
```

---

## Step 6: デプロイ後の確認

```bash
# 1. ページが表示されること
curl -sI https://japan.koide.io | head -5
# → HTTP/2 200

# 2. セキュリティヘッダーが付いていること
curl -sI https://japan.koide.io | grep -E "x-frame|csp|referrer|x-content"
# → X-Frame-Options: DENY
# → Content-Security-Policy-Report-Only: ...
# → Referrer-Policy: strict-origin-when-cross-origin
# → X-Content-Type-Options: nosniff

# 3. 静的アセットのキャッシュ設定
curl -sI https://japan.koide.io/assets/ | grep cache-control
# → cache-control: public, max-age=31536000, immutable

# 4. API エンドポイント疎通
curl -s https://japan.koide.io/api/rss-proxy?url=https://feeds.bbci.co.uk/news/rss.xml | head -100
```

---

## トラブルシューティング

### DNS が反映されない

```bash
# Route53 の NS が正しいか確認
dig koide.io NS +short
# → ns-897.awsdns-48.net. 等が返ること

# TTL が長い場合は時間をおく（最大 300 秒）
dig japan.koide.io @8.8.8.8
```

### Vercel ビルドが失敗する

```bash
# ローカルでビルドを再現
npm run build:japan
# エラーを確認して修正後、再プッシュ
```

### `vercel pull` が失敗する（CI）

- GitHub Secrets の `VERCEL_TOKEN` が正しいか確認
- Vercel ダッシュボードで Token が有効か確認
- Token のスコープが `Full Account` であること

### Cloudflare purge が 403 になる

- `CLOUDFLARE_API_TOKEN` の権限を確認（Zone:Cache Purge が必要）
- `CLOUDFLARE_ZONE_ID` が正しいか Cloudflare ダッシュボードで再確認

---

## 作業チェックリスト

- [ ] Vercel プロジェクト作成（VITE_VARIANT=japan 設定）
- [ ] `vercel link` でローカルに `.vercel/` 生成
- [ ] GitHub Secrets: `VERCEL_TOKEN` 設定
- [ ] GitHub Secrets: `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_API_TOKEN` 設定（or purge ステップ削除）
- [ ] Vercel にカスタムドメイン `japan.koide.io` 追加
- [ ] Route53 に CNAME レコード追加（`japan → cname.vercel-dns.com`）
- [ ] `dig japan.koide.io` で CNAME が返ること確認
- [ ] `curl -I https://japan.koide.io` で HTTP 200 確認
- [ ] セキュリティヘッダーの確認

# Basic 認証 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `japan.koide.io` の HTML ページ全体に Basic 認証をかける。`/api/*` 等は認証不要のまま維持。

**Architecture:** Vercel Edge Middleware（`middleware.ts`）に Basic 認証チェックを追加。認証情報は `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` 環境変数で管理。未設定時はスキップ（ローカル開発用）。

**Tech Stack:** Vercel Edge Runtime, TypeScript

---

### Task 1: middleware.ts に Basic 認証を追加

**Files:**
- Modify: `middleware.ts`

**Step 1: 現在の middleware.ts を確認**

```bash
cat middleware.ts
```

現在の `config.matcher` が `/api/:path*` と `/favico/:path*` のみであることを確認。

**Step 2: middleware.ts を以下の内容に書き換える**

```typescript
/**
 * Vercel Edge Middleware
 * 1. Basic 認証（HTML ページ全体）— BASIC_AUTH_USER / BASIC_AUTH_PASS が設定されている場合のみ
 * 2. ボット・クローラーブロック（/api/* のみ）
 */

const BOT_UA =
  /bot|crawl|spider|slurp|archiver|wget|curl\/|python-requests|scrapy|httpclient|go-http|java\/|libwww|perl|ruby|php\/|ahrefsbot|semrushbot|mj12bot|dotbot|baiduspider|yandexbot|sogou|bytespider|petalbot|gptbot|claudebot|ccbot/i;

const SOCIAL_PREVIEW_UA =
  /twitterbot|facebookexternalhit|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|redditbot/i;

const SOCIAL_PREVIEW_PATHS = new Set(['/api/story', '/api/og-story']);

const SOCIAL_IMAGE_UA =
  /Slack-ImgProxy|Slackbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|discordbot|redditbot/i;

// Basic 認証をスキップするパス
const AUTH_BYPASS_PREFIXES = ['/api/', '/_next/', '/favico/', '/ingest/'];
const AUTH_BYPASS_EXACT = new Set(['/sw.js', '/offline.html', '/manifest.webmanifest']);

function requiresAuth(pathname: string): boolean {
  if (AUTH_BYPASS_EXACT.has(pathname)) return false;
  return !AUTH_BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Japan Monitor"' },
  });
}

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Basic 認証（環境変数が設定されている場合のみ有効）---
  const authUser = process.env.BASIC_AUTH_USER;
  const authPass = process.env.BASIC_AUTH_PASS;

  if (authUser && authPass && requiresAuth(path)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Basic ')) return unauthorized();

    const decoded = atob(authHeader.slice(6));
    const colon = decoded.indexOf(':');
    if (colon === -1) return unauthorized();

    const inputUser = decoded.slice(0, colon);
    const inputPass = decoded.slice(colon + 1);
    if (inputUser !== authUser || inputPass !== authPass) return unauthorized();
  }

  // --- 以下は /api/* と /favico/* にのみ適用（ボット保護）---
  const ua = request.headers.get('user-agent') ?? '';

  // Allow social preview/image bots on OG image assets
  if (path.startsWith('/favico/') || path.endsWith('.png')) {
    if (SOCIAL_IMAGE_UA.test(ua)) return;
  }

  // Allow social preview bots on exact OG routes only
  if (SOCIAL_PREVIEW_UA.test(ua) && SOCIAL_PREVIEW_PATHS.has(path)) return;

  // Block bots from all API routes
  if (BOT_UA.test(ua)) {
    return new Response('{"error":"Forbidden"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // No user-agent or suspiciously short — likely a script
  if (!ua || ua.length < 10) {
    return new Response('{"error":"Forbidden"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = {
  // 全パスにマッチ（_next/static 等は Vercel が自動除外するが明示的に除外も可）
  matcher: ['/((?!_next/static|_next/image).*)'],
};
```

**Step 3: 型チェックを実行**

```bash
npx tsc --noEmit
```

Expected: エラーなし

**Step 4: コミット**

```bash
git add middleware.ts
git commit -m "feat: middleware に Basic 認証を追加（BASIC_AUTH_USER/PASS 環境変数で制御）"
```

---

### Task 2: .env.example に Basic 認証の説明を追加

**Files:**
- Modify: `.env.example`

**Step 1: `.env.example` の `# ------ Site Configuration ------` セクションの前に追加**

```bash
# ------ Basic 認証 ------

# サイト全体への Basic 認証（/api/* は対象外）
# 未設定の場合は認証なし（ローカル開発時はそのまま）
# パスワードは強力なランダム文字列を推奨: openssl rand -base64 32
BASIC_AUTH_USER=
BASIC_AUTH_PASS=
```

**Step 2: コミット**

```bash
git add .env.example
git commit -m "docs: .env.example に BASIC_AUTH_USER/PASS を追加"
```

---

### Task 3: Vercel 環境変数を設定

**Step 1: パスワードを生成**

```bash
openssl rand -base64 32
# 出力例: xK9mP3qR7vL2nJ5wY8sA1dF6hT4uB0cE=
```

**Step 2: Vercel 環境変数に設定**

```bash
# Vercel CLI が使えない環境のため REST API で設定
VERCEL_TOKEN="<your-token>"
PROJECT_ID="prj_mFvnIJz96LUT3w3GwaFyLUSsWDPN"

curl -s -X POST "https://api.vercel.com/v10/projects/${PROJECT_ID}/env" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "BASIC_AUTH_USER",
    "value": "admin",
    "type": "encrypted",
    "target": ["production"]
  }'

curl -s -X POST "https://api.vercel.com/v10/projects/${PROJECT_ID}/env" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "BASIC_AUTH_PASS",
    "value": "<generated-password>",
    "type": "encrypted",
    "target": ["production"]
  }'
```

**Step 3: 設定確認**

```bash
curl -s "https://api.vercel.com/v10/projects/${PROJECT_ID}/env" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" | \
  python3 -c "import json,sys; [print(e['key']) for e in json.load(sys.stdin)['envs'] if 'BASIC' in e['key']]"
# Expected: BASIC_AUTH_USER と BASIC_AUTH_PASS が表示される
```

---

### Task 4: プッシュ・デプロイ・動作確認

**Step 1: GitHub にプッシュ**

```bash
git push origin main
```

Expected: GitHub Actions の Deploy to Vercel が起動

**Step 2: デプロイ完了を確認**

```bash
gh run list --repo Junji-Koide/worldmonitor --limit 2
# Deploy to Vercel が completed success になるまで待つ（約2分）
```

**Step 3: 認証なしでアクセス → 401 を確認**

```bash
curl -sI https://japan.koide.io | head -3
# Expected:
# HTTP/2 401
# www-authenticate: Basic realm="Japan Monitor"
```

**Step 4: 正しい認証情報でアクセス → 200 を確認**

```bash
curl -sI -u "admin:<password>" https://japan.koide.io | head -3
# Expected:
# HTTP/2 200
```

**Step 5: API は認証不要を確認**

```bash
curl -sI "https://japan.koide.io/api/rss-proxy?url=https://feeds.bbci.co.uk/news/rss.xml" | head -3
# Expected:
# HTTP/2 200 または 400（認証なしでアクセスできること）
```

**Step 6: 静的アセットは認証不要を確認**

```bash
curl -sI https://japan.koide.io/sw.js | head -3
# Expected: HTTP/2 200
```

---

## 注意事項

- `atob()` は Edge Runtime で使用可能（Web API として利用できる）
- `process.env` は Vercel Edge Runtime でサポートされている
- Basic 認証は HTTPS 前提。japan.koide.io は Vercel で HTTPS 強制済み
- ブラウザはいちど認証に成功するとセッション終了まで認証情報をキャッシュする

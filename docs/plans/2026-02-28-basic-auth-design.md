# Basic 認証 設計ドキュメント

作成日: 2026-02-28
対象: `japan.koide.io` 全体への Basic 認証追加

---

## 要件

- **保護範囲:** HTML ページ全体（`/`）
- **除外:** `/api/*`（RSS プロキシ等）、静的アセット（`/_next/`, `/favico/` 等）
- **認証情報管理:** Vercel 環境変数（`BASIC_AUTH_USER`, `BASIC_AUTH_PASS`）

---

## アーキテクチャ

```
ブラウザ → japan.koide.io
  → middleware.ts（全パスにマッチ）
    ├── /api/*, /_next/*, /favico/*, /sw.js 等 → 認証スキップ
    ├── Authorization ヘッダーあり
    │   ├── credentials 一致 → 通常レスポンス
    │   └── credentials 不一致 → 401 Unauthorized
    └── Authorization ヘッダーなし → 401 + WWW-Authenticate（ブラウザがダイアログ表示）
```

---

## 変更内容

### `middleware.ts`

1. `config.matcher` を全パスに拡張（現在は `/api/:path*` と `/favico/:path*` のみ）
2. 認証スキップパスのリストを定義
3. Basic 認証チェックロジックを追加（スキップパス以外に適用）
4. 既存のボット保護ロジックは `/api/*` にのみ残す

### 環境変数

```
BASIC_AUTH_USER=<username>
BASIC_AUTH_PASS=<strong-random-password>
```

Vercel ダッシュボード → Settings → Environment Variables に追加。
未設定の場合は Basic 認証をスキップ（開発環境の利便性のため）。

### `.env.example`

`BASIC_AUTH_USER` / `BASIC_AUTH_PASS` の説明を追加。

---

## 実装詳細

```typescript
// 認証をスキップするパスプレフィックス
const BYPASS_PREFIXES = ['/api/', '/_next/', '/favico/', '/ingest/']
const BYPASS_EXACT = new Set(['/sw.js', '/offline.html', '/manifest.webmanifest'])

function requiresAuth(pathname: string): boolean {
  if (BYPASS_EXACT.has(pathname)) return false
  return !BYPASS_PREFIXES.some(p => pathname.startsWith(p))
}

function checkBasicAuth(request: Request): Response | null {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS
  if (!user || !pass) return null // 未設定時はスキップ

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Basic ')) return unauthorized()

  const decoded = atob(authHeader.slice(6))
  const colon = decoded.indexOf(':')
  if (colon === -1) return unauthorized()

  const inputUser = decoded.slice(0, colon)
  const inputPass = decoded.slice(colon + 1)
  if (inputUser !== user || inputPass !== pass) return unauthorized()

  return null // 認証OK
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Japan Monitor"' },
  })
}
```

---

## セキュリティ考慮事項

- Basic 認証はパスワードを base64 エンコードするだけ（平文と同等）
- **HTTPS 必須**（japan.koide.io は Vercel で HTTPS 強制済みのため問題なし）
- パスワードは十分に長いランダム文字列を使用すること（`openssl rand -base64 32` 推奨）
- timing attack 対策: 現実的な脅威レベルが低いため簡易実装で十分

---

## テスト

```bash
# 認証なしでアクセス → 401
curl -sI https://japan.koide.io | grep HTTP
# → HTTP/2 401

# 正しい認証情報でアクセス → 200
curl -sI -u "admin:password" https://japan.koide.io | grep HTTP
# → HTTP/2 200

# API は認証不要 → 200
curl -sI https://japan.koide.io/api/rss-proxy?url=https://feeds.bbci.co.uk/news/rss.xml | grep HTTP
# → HTTP/2 200

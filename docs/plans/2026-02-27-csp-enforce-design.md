# CSP enforce 移行 設計ドキュメント

作成日: 2026-02-27
対象: `vercel.json` の `Content-Security-Policy-Report-Only` → `Content-Security-Policy`

---

## 背景

`vercel.json` で `Content-Security-Policy-Report-Only` として CSP を設定していた。
これは違反をログに記録するのみで、実際のブロックは行わない。
今回、`Content-Security-Policy`（enforce モード）に移行する。

---

## 調査結果

### index.html の CSP meta タグ

開発用の緩いポリシー（`connect-src https:` で全 HTTPS 許可）。
意図的に残しており、`vercel.json` の HTTP ヘッダー CSP が本番で実効的に機能する。

### フロントエンドから直接 fetch している外部 API

以下のサービスは Vercel Edge Function 経由でなく、ブラウザから直接 fetch している:

| サービス | URL | 用途 |
|---|---|---|
| EONET | `https://eonet.gsfc.nasa.gov/api/v3/events` | 自然災害イベント |
| GDACS | `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP` | 自然災害警告 |
| USA Spending | `https://api.usaspending.gov/api/v2` | 米国政府支出 |
| NWS | `https://api.weather.gov/alerts/active` | 気象警報 |
| Polymarket | `https://gamma-api.polymarket.com` | 予測市場 |

→ これらが既存の `connect-src` に未追加だった。enforce 移行時に機能停止するため追加が必要。

### YouTube iframe

`src/components/LiveNewsPanel.ts` で YouTube IFrame API と `youtube.com` iframe を使用。

- `script-src` に `https://www.youtube.com` が必要（IFrame API スクリプト）
- `frame-src` が未設定だった → `https://www.youtube.com https://www.youtube-nocookie.com` を追加

---

## 設計

### アプローチ

**アプローチB: 完全版 CSP を一気に enforce**

- 不足ドメインをすべて追加した完全版 CSP を設計
- `Content-Security-Policy-Report-Only` を削除
- `Content-Security-Policy` として一発で enforce

### 変更後の CSP

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' https://cdn.vercel-insights.com https://browser.sentry-cdn.com https://www.youtube.com;
connect-src 'self' https://*.worldmonitor.app https://*.koide.io https://us.i.posthog.com https://us-assets.i.posthog.com https://*.sentry.io https://*.upstash.io https://basemaps.cartocdn.com https://api.maptiler.com https://eonet.gsfc.nasa.gov https://www.gdacs.org https://api.usaspending.gov https://api.weather.gov https://gamma-api.polymarket.com wss://*.worldmonitor.app;
img-src 'self' data: blob: https:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;
worker-src 'self' blob:;
child-src blob:
```

### 変更点の差分

| ディレクティブ | 変更 |
|---|---|
| ヘッダー名 | `Content-Security-Policy-Report-Only` → `Content-Security-Policy` |
| `script-src` | `+ https://www.youtube.com` |
| `connect-src` | `+ https://eonet.gsfc.nasa.gov https://www.gdacs.org https://api.usaspending.gov https://api.weather.gov https://gamma-api.polymarket.com` |
| `frame-src` | 新規追加 (`https://www.youtube.com https://www.youtube-nocookie.com`) |

### 設計判断

- **`'unsafe-inline'` は `script-src` に含まない** — `vercel.json` の既存セキュリティ方針を維持
- **`img-src https:` は維持** — マップタイル・ニュースサムネイル等が多様なドメインから来るため
- **Railway relay (`VITE_WS_RELAY_URL`) は含まない** — 本番未設定のため。設定後に `connect-src` へ追加

---

## 実装ファイル

- `vercel.json` — CSP ヘッダーを更新

---

## テスト方法

```bash
# デプロイ後に CSP ヘッダーを確認
curl -sI https://japan.koide.io | grep -i "content-security-policy"
# → Content-Security-Policy: ... が返ること
# → Content-Security-Policy-Report-Only: が存在しないこと

# ブラウザで確認
# DevTools → Console に CSP 違反エラーがないこと
# DevTools → Network → 各外部 API リクエストが 200 で成功していること
```

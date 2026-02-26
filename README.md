# Japan Monitor

**CIA / Palantir スタイルのリアルタイムグローバルインテリジェンスダッシュボード**

[World Monitor](https://github.com/koala73/worldmonitor) のプライベートフォーク。
Japan バリアント (`japan.koide.io`) をメインに開発・運用。

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=flat&logo=vercel)](https://japan.koide.io)

---

## 概要

地政学・軍事・経済・インフラを一画面に集約したインテリジェンスダッシュボード。
AIによるニュース要約、リアルタイムマップ、35+ データレイヤーを統合。

| デプロイ先 | URL | フォーカス |
|-----------|-----|-----------|
| **Japan Monitor** | [japan.koide.io](https://japan.koide.io) | 日本・アジア太平洋地域の地政学・安全保障 |

---

## 主要機能

### インタラクティブ 3D マップ
- **WebGL レンダリング** — deck.gl + MapLibre GL JS による 60fps 描画
- **35+ データレイヤー** — 紛争地帯、軍事基地、核施設、海底ケーブル、石油パイプライン、サイバー脅威 IOC、衛星火災検知、自然災害、気象警報など
- **スマートクラスタリング** — ズームレベルに応じてマーカーを自動集約
- **時間フィルタリング** — 1h / 6h / 24h / 48h / 7d のイベントウィンドウ

### AI インテリジェンス
- **World Brief** — LLM によるグローバル情勢の要約（Ollama → Groq → OpenRouter → ブラウザ T5 のフォールバックチェーン）
- **ローカル LLM サポート** — Ollama / LM Studio でデータをローカル処理
- **国家不安定指数 (CII)** — 22 カ国のリアルタイム安定スコア
- **フォーカルポイント検出** — ニュース・軍事・抗議・停電・市場を横断して収束地点を特定
- **トレンドキーワードスパイク検知** — RSS フィード横断の急上昇ワード検出

### リアルタイムデータ
- **150+ RSS フィード** — 地政学・防衛・エネルギー・テック・金融
- **ライブ動画ストリーム** — Bloomberg, Al Jazeera, NHK World など 8 チャンネル
- **7 シグナルマクロレーダー** — BTC、JPY 流動性、Fear & Greed、QLQ / XLP など
- **軍事フライト追跡** — ADS-B リアルタイム追跡
- **AIS 海上船舶追跡** — チョークポイント監視（ホルムズ、スエズ、マラッカ等）

### セキュリティ
- CORS: Allowlist ベース (worldmonitor.app, koide.io, localhost, tauri)
- CSP: `Content-Security-Policy-Report-Only` モード (vercel.json)
- レート制限: `api/_rate-limit.js` 共通モジュール
- ボット対策: middleware.ts による UA ベースブロック

---

## Tech Stack

| カテゴリ | 技術 |
|---------|------|
| **Frontend** | TypeScript, Vite, Deck.GL, MapLibre GL, D3.js |
| **AI / ML** | @xenova/transformers, onnxruntime-web, Ollama, Groq, OpenRouter |
| **Backend** | Vercel Edge Functions (serverless) |
| **キャッシュ** | Upstash Redis |
| **Desktop** | Tauri + Node.js sidecar |
| **CI/CD** | GitHub Actions → Vercel + Cloudflare |

---

## ディレクトリ構造

```
worldmonitor/
├── src/
│   ├── App.ts                  # メインアプリ (3000+ 行)
│   ├── components/
│   │   └── DeckGLMap.ts        # 地図レンダリング (3900+ 行)
│   ├── services/
│   │   ├── ml-worker.ts        # ML ワーカーシングルトン (遅延読み込み)
│   │   ├── country-geometry.ts # GeoJSON 遅延読み込み
│   │   └── ...
│   └── config/                 # フィード設定・バリアント設定
├── api/
│   ├── _rate-limit.js          # 共通レート制限モジュール
│   ├── _cors.js                # CORS ヘルパー
│   ├── rss-proxy.js            # RSS プロキシ
│   └── ...                     # その他 Edge Functions
├── server/                     # Redis キャッシュ・CORS・エラーマッピング
├── docs/plans/                 # 設計・実装計画ドキュメント
├── vercel.json                 # デプロイ設定 + セキュリティヘッダー
└── CLAUDE.md                   # AI 開発ガイド
```

---

## セットアップ

### 前提条件

- Node.js 20+
- npm

### インストール

```bash
git clone https://github.com/Junji-Koide/worldmonitor.git
cd worldmonitor
npm install
```

### 環境変数

`.env.local` を作成し、必要な API キーを設定:

```env
# LLM (任意、フォールバックチェーンあり)
GROQ_API_KEY=...
OPENROUTER_API_KEY=...

# データソース
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 開発コマンド

```bash
# Japan バリアントで開発サーバー起動
npm run dev:japan

# Japan バリアントでビルド
npm run build:japan

# 型チェック
npm run typecheck

# E2E テスト
npm run test:e2e
```

---

## アーキテクチャメモ

### API リクエスト優先度 (3 段階)

```
P1 (即時): news, markets, intelligence signals
P2 (P1完了 or 500ms後): predictions, disasters, weather, military
P3 (P2完了 or 1500ms後): その他フィード
```

### パフォーマンス最適化 (実装済み)

| 最適化 | 詳細 |
|--------|------|
| ML 遅延読み込み | `@xenova/transformers` + ONNX は動的 import で 700KB+ の初期ロードを回避 |
| GeoJSON 非同期 | `preloadCountryGeometry()` を fire-and-forget 化 |
| API 優先度化 | P1/P2/P3 の 3 段階で重要データを先行取得 |
| セキュリティヘッダー | CSP (report-only), X-Frame-Options, Referrer-Policy |
| 共通レート制限 | `api/_rate-limit.js` でエンドポイント横断管理 |

### パフォーマンス最適化 (実装予定)

| 最適化 | 対象 | 詳細 |
|--------|------|------|
| `filterByTime()` メモ化 | `DeckGLMap.ts` | 11 箇所の呼び出しをキャッシュ化 |
| Zoom bailout | `DeckGLMap.ts` | 非表示レイヤーのデータ処理をスキップ |
| Ghost レイヤー条件生成 | `DeckGLMap.ts` | zoom < 3 でヒット検出レイヤーをスキップ |

設計詳細: [`docs/plans/2026-02-26-performance-security-design.md`](docs/plans/2026-02-26-performance-security-design.md)

---

## デプロイ

Vercel + Cloudflare で自動デプロイ。`main` ブランチへの push で自動デプロイ。

```bash
# デプロイ確認
vercel ls

# ログ確認
vercel logs japan.koide.io
```

---

## Upstream との差異

このリポジトリは [koala73/worldmonitor](https://github.com/koala73/worldmonitor) のプライベートフォーク。

主な差異:
- Japan バリアント (`VITE_VARIANT=japan`) をデフォルトターゲットに
- `japan.koide.io` 向けの Vercel 設定
- セキュリティ強化 (CSP, レート制限)
- パフォーマンス最適化の実装

---

## ライセンス

[AGPL-3.0](LICENSE) — upstream の worldmonitor と同ライセンス。

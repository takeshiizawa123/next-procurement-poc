# システムアーキテクチャ — 2026-04 時点の現状

**最終更新**: 2026-04-12
**対象**: next-procurement-poc
**ステータス**: 開発中、本番未稼働（本番はProcurement-Assistant）

このドキュメントは現在のシステム全体像のSingle Source of Truthです。GAS時代の設計経緯は
`design-*.md` に歴史的記録として残っていますが、**実装と乖離している箇所があります**。

---

## 1. システム全体構成

```
┌─────────────────────────────────────────────────────────────────┐
│                          ユーザー                                │
│  従業員30名（@futurestandard.co.jp）                              │
└────────────┬────────────────────────────────────────────────────┘
             │
             ├─ Webブラウザ ──────┐
             └─ Slack ────────────┤
                                  │
             ┌────────────────────▼────────────────────┐
             │  next-procurement-poc (Vercel, Tokyo)   │
             │  ──────────────────────────────────────  │
             │  Next.js 16 App Router                   │
             │  + NextAuth v5 (Google OAuth)            │
             │  + Drizzle ORM                           │
             │  + Upstash Redis (Tokyo) キャッシュ      │
             └──────┬──────────────────┬───────────────┘
                    │                  │
        ┌───────────▼────┐   ┌─────────▼──────────┐
        │ Supabase       │   │ 外部サービス連携    │
        │ Postgres       │   │ ──────────         │
        │ (Tokyo)        │   │ - Slack API        │
        │ ──────────     │   │ - MF会計Plus       │
        │ 15テーブル     │   │ - MF経費           │
        └────────────────┘   │ - Gemini Vision    │
                             │ - Google Drive     │
                             └────────────────────┘
```

---

## 2. Procurement-Assistant との関係（2026-04 時点）

| 項目 | Procurement-Assistant | next-procurement-poc |
|------|----------------------|---------------------|
| **ステータス** | **本番稼働中** | 開発中・テスト環境 |
| **実体** | Google Apps Script（GAS） | Next.js + Vercel |
| **データストア** | Google Sheets「購買管理」 | **Supabase Postgres（Tokyo）** |
| **Slack自動取込** | `main.js` が毎日稼働中 | 未実装（将来移植） |
| **Web UI** | なし | あり |
| **将来方針** | 廃止予定 | 本番置換 |

**重要**: 現在2システムは独立して動作しており、データは共有していません。Procurement-Assistantが本番で動いている間、next-procurement-pocは並行で開発・テストを行います。

---

## 3. データストア (Supabase Postgres)

### 基本情報

| 項目 | 値 |
|------|---|
| プロバイダ | Supabase (Vercel Marketplace経由) |
| リージョン | **ap-northeast-1 (Tokyo)** |
| Postgresバージョン | 17.6 |
| プラン | Free（将来Pro $25/月に昇格予定） |
| 接続方法 | PgBouncer経由 (POSTGRES_URL) + 直接接続 (POSTGRES_URL_NON_POOLING) |
| ORM | Drizzle ORM 0.45 |
| マイグレーション管理 | Drizzle Kit |

### テーブル一覧（15テーブル）

詳細は `docs/db-schema.md` を参照。

| テーブル | 用途 |
|---------|------|
| `purchase_requests` | 購買申請メインテーブル（54列） |
| `employees` | 従業員マスタ（Slack ID, email, card_last4, mf_office_member_id等） |
| `predicted_transactions` | カード照合用予測テーブル |
| `mf_counterparties` | MF取引先マスタ（649件） |
| `mf_departments` | MF部門マスタ（20件） |
| `mf_accounts` | MF勘定科目マスタ（258件） |
| `mf_taxes` | MF税区分マスタ（151件） |
| `mf_sub_accounts` | MF補助科目マスタ（318件） |
| `mf_projects` | MFプロジェクトマスタ（337件） |
| `mf_masters_cache` | MF API全量JSONキャッシュ |
| `journal_stats` | 仕訳統計（RAG用） |
| `journal_rows` | 過去仕訳生データ（RAG検索用） |
| `purchase_drafts` | 下書き保存 |
| `mf_oauth_tokens` | MF OAuthトークン |
| `slack_event_log` | Slackイベント冪等性管理 |

---

## 4. 認証・セキュリティ

### 認証レイヤー

| 対象 | 方式 |
|------|------|
| **Web UI ページ** | NextAuth v5 + Google OAuth（内部ユーザータイプ、@futurestandard.co.jp限定） |
| **API route (一般)** | `requireApiKey()` — `NEXT_PUBLIC_INTERNAL_API_KEY` ヘッダー検証 |
| **API route (管理者)** | `requireBearerAuth()` — `CRON_SECRET` Bearer token |
| **Slack webhook** | HMAC-SHA256 署名検証 + 5分リプレイ防止 |
| **Cron jobs** | `CRON_SECRET` Bearer token |
| **MF会計Plus** | OAuth 2.0 (state cookie CSRF対策) |
| **MF経費** | 独自 Bearer token |

### Next.js 16 proxy設定

`src/proxy.ts`：
- **ページルート**: 未認証時 `/auth/signin` へリダイレクト
- **API route (`/api/*`)**: proxyはバイパス、各route内で独自認証
- **`AUTH_SECRET` 未設定時**: 全リクエスト通過（ローカル開発時）

---

## 5. キャッシュ戦略（3層）

```
Request
  ↓
Layer 1: クライアントサイドSWR (localStorage, 10分TTL)
  ↓ miss
Layer 2: Upstash Redis (Tokyo, 共有キャッシュ, 3分〜4時間TTL)
  ↓ miss
Layer 3: インメモリフォールバック
  ↓ miss
Supabase Postgres
```

**Upstash Redis（共有キャッシュ）**:
- Vercel Marketplace経由で導入
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`
- リージョン: Tokyo
- 用途: Vercelインスタンス間共有、リクエスト合体（inflight dedup）、コールドスタート対応
- キープレフィックス: `gas:`（レガシー）

**キャッシュウォーマー cron** (`/api/cron/cache-warm`):
- 4分ごとに主要データをRedisに先読み
- employees, suppliers, mastersBundle, recentRequests, journalStats
- CDNウォーミングも兼ねて自分自身のAPIも叩く

---

## 6. 外部連携

### Slack API

| 機能 | 実装場所 |
|------|---------|
| スラッシュコマンド (`/purchase`, `/trip`) | `src/app/api/slack/events/route.ts` |
| 承認DMボタン | `src/lib/slack.ts` handleApprove等 |
| リマインダー・通知 | `src/app/api/cron/*` |
| 証憑ファイル受信 | `src/lib/slack.ts` handleFileShared |

### MF会計Plus

| 機能 | API | 備考 |
|------|-----|------|
| OAuth認証 | `/api/mf/auth`, `/api/mf/callback` | Refresh token自動更新 |
| マスタ同期 | `src/lib/mf-accounting.ts` | 4時間キャッシュ |
| 仕訳登録 | `src/app/api/mf/journal/route.ts` | Stage 1 (expense) 作成 |
| 仕訳取得 | `getJournals(entered_by="none")` | Stage 2 カード確定仕訳 |

### MF経費

| 機能 | エンドポイント |
|------|-------------|
| カード明細取得 | `GET /offices/{oid}/me/ex_transactions` |
| 経費登録 | `POST /offices/{oid}/me/ex_transactions` |
| マスタ取得 | `/projects`, `/depts`, `/ex_items` |

**発見済み**: レスポンスに `office_member_id` があり、従業員特定可能。`card_last4` 不要。
詳細は `docs/research/mf-expense-api-inspection.md`（予定）。

### Gemini Vision (OCR)

- 証憑画像から金額・日付・適格請求書番号を抽出
- `src/lib/ocr.ts`
- 信頼度スコアリング

### Google Drive

- 証憑ファイルの保管
- サービスアカウント認証

---

## 7. 自動化 (Cron Jobs)

Vercel Cron Jobs (`vercel.json`):

| Cron | スケジュール (JST) | 機能 |
|------|------------------|------|
| `cache-warm` | 4分毎 | Redis キャッシュ先読み |
| `daily-summary` | 09:00 | 日次サマリをOpsチャンネルに投稿 |
| `voucher-reminder` | 10:00 | 証憑未提出リマインダー（Day1/3/7エスカレーション） |
| `weekly-reminder` | 月曜 09:00 | 承認待ちの週次まとめ |
| `card-reconciliation` | 月曜 11:00 | カード明細照合 |
| `daily-variance` | 12:00 | 金額乖離検知 |

全cronは `CRON_SECRET` Bearer token認証。

---

## 8. 主要APIルート一覧

### 購買関連
- `POST /api/purchase/submit` — 新規申請
- `GET /api/purchase/recent` — 過去申請一覧
- `GET /api/purchase/[prNumber]/status` — 状態取得
- `PUT /api/purchase/[prNumber]/status` — 状態更新
- `POST /api/purchase/upload-voucher` — 証憑添付
- `POST /api/purchase/check-duplicate` — 重複チェック
- `POST /api/purchase/estimate-account` — 勘定科目推定（RAG）

### マスタ・検索
- `GET /api/employees` — 従業員一覧
- `GET /api/suppliers` — 購入先一覧
- `GET /api/mf/masters` — MFマスタ一括
- `POST /api/mf/masters/sync` — MFマスタ再同期

### 管理
- `GET /api/admin/card-matching/execute` — カード照合実行
- `POST /api/admin/card-matching/confirm` — 照合確定
- `GET /api/admin/approval-routes` — 承認ルート
- `GET /api/admin/spending` — 支出分析

### MF連携
- `GET /api/mf/auth` — OAuth開始
- `GET /api/mf/callback` — OAuth callback
- `GET /api/mf/journal` — 仕訳取得
- `POST /api/mf/journal` — 仕訳登録

### Cron (全て `CRON_SECRET` 認証)
- `GET /api/cron/cache-warm`
- `GET /api/cron/daily-summary`
- `GET /api/cron/voucher-reminder`
- `GET /api/cron/weekly-reminder`
- `GET /api/cron/card-reconciliation`
- `GET /api/cron/daily-variance`

---

## 9. 環境変数一覧

### 必須

| 変数名 | 説明 |
|--------|------|
| `POSTGRES_URL` | Supabase接続URL (PgBouncer経由) |
| `POSTGRES_URL_NON_POOLING` | Supabase直接接続URL (マイグレーション用) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis |
| `AUTH_SECRET` | NextAuth セッション暗号化 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` | Slack API |
| `SLACK_PURCHASE_CHANNEL` / `SLACK_OPS_CHANNEL` / `SLACK_TRIP_CHANNEL` | Slackチャンネル |
| `CRON_SECRET` | Cron認証 |
| `INTERNAL_API_KEY` / `NEXT_PUBLIC_INTERNAL_API_KEY` | API認証 |
| `MF_CLIENT_ID` / `MF_CLIENT_SECRET` | MF会計Plus OAuth |
| `MF_EXPENSE_ACCESS_TOKEN` / `MF_EXPENSE_OFFICE_ID` | MF経費 |
| `GEMINI_API_KEY` | Gemini Vision OCR |

### オプショナル

| 変数名 | 説明 |
|--------|------|
| `GAS_WEB_APP_URL` / `GAS_API_KEY` | GAS接続（移行スクリプト用、通常運用では不要） |
| `TEST_MODE` | true時はDMをテストチャンネルにリダイレクト |
| `GOOGLE_ALLOWED_DOMAIN` | Google OAuthドメイン制限 |

---

## 10. 移行済み / 未実装の機能

### ✅ 完了 (2026-04時点)

- Upstash Redis共有キャッシュ導入（GAS 7-8秒→DB 150ms、50倍高速化）
- Google OAuth認証（NextAuth v5）
- 承認権限バイパス防止（CRITICAL修正）
- GAS/Slack更新順序の逆転（データ整合性向上）
- Amazon CSV照合機能
- EC連携サイト証憑催促スキップ
- RAG勘定科目推定（93.3%正答率）
- Supabase Postgres移行（15テーブル、Tokyo region）
- Drizzle ORM統合（gas-client互換ラッパー経由）
- データ移行スクリプト（GAS → Postgres）

### 🚧 未実装 / 保留

| 項目 | 優先度 |
|------|-------|
| Slack自動取込機能（main.js移植） | 低（本番置換時まで不要） |
| 出張バーチャルカード統合（B案） | 中 |
| 立替精算のWebアプリ完結 | 中 |
| Procurement-Assistant廃止 | 将来 |
| 既存ドキュメントの完全再生成 | 低 |

---

## 11. 主要決定事項の履歴

| 日付 | 決定 | 理由 |
|------|------|------|
| 2026-04-11 | GAS→Supabase移行に方針転換 | GAS 7-8秒レイテンシ、複雑クエリ不可、B案実装の前提 |
| 2026-04-11 | Supabase選定（Neon検討済み） | NeonにTokyoリージョンなし |
| 2026-04-11 | Drizzle ORM選定（Prisma検討済み） | Vercelコールドスタート最速 |
| 2026-04-11 | NextAuth v5継続（Supabase Auth採用せず） | 既に導入済み、Supabase Authとの競合回避 |
| 2026-04-10 | Upstash Redis導入 | Vercelインスタンス間キャッシュ共有 |
| 2026-04-10 | Google OAuth内部ユーザータイプ | 会社ドメインのみに制限 |
| 2026-04-09 | Amazon連携はMF会計Plus×App Center（Gmail不要） | MF側で自動仕訳候補化可能 |
| 2026-04-09 | 出張バーチャルカードはB案（購買管理主導） | 仕訳の主導権、二重計上リスク回避 |
| 2026-04-07 | スキーマ列構成を37列にリニューアル | 税込準拠、Web画面と統一 |

---

## 12. 参照ドキュメント

### 現行（Single Source of Truth）
- `docs/architecture-2026-04.md` — このファイル
- `docs/db-schema.md` — 現在のDBスキーマ
- `docs/operational-guide.md` — 運用ガイド（部分更新済み）
- `docs/user-manual.md` — ユーザーマニュアル（部分更新済み）

### 歴史的記録（GAS時代の設計経緯、実装と乖離あり）
- `docs/design-mf-integration-*.md`
- `docs/design-card-statement-matching.md`
- `docs/design-accounting-reconciliation.md`
- `docs/design-journal-entry-by-payment.md`
- `docs/design-voucher-integration-c-vs-g.md`
- `docs/spreadsheet-schema.md` — GAS時代のシート構造

### 引き継ぎ
- `CURRENT_WORK.md` — 最新セッション引き継ぎ
- `docs/handoffs/` — 全セッション履歴

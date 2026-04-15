## [Handoff] "PPT精査+立替精算+仕訳自動化+AI+障害対策+バックアップ" — 2026-04-13 00:11 (branch: master)

### Goal / Scope
- PPTマニュアル3本の実装済み/未実装精査→MD全面更新→PPTX更新
- 未実装機能の実装（立替精算、仕訳Stage2/3、全文検索、Slack AI）
- 障害対策基盤（監査ログ、リトライ/DLQ、DR手順書、日次バックアップ）
- やらないこと: Supabase Proプラン購入、Procurement-Assistant廃止

### Key decisions
- Slack自動取込(main.js)は移植不要 — イベントドリブンで全機能実装済み
- DBトリガーは見送り — APIドリブンで十分、ロジック分散リスク回避
- Supabase Realtime/Storage見送り — Slack通知+GDriveで十分
- バックアップはGDrive永久保持 — Supabase Pro不要の無料戦略

### Done
- [x] PPT3本精査→MD3本全面更新(operational-guide/user-manual/workflow-design-b-route)
- [x] PPTX3本をSupabase版に一括更新(python-pptx)
- [x] /expense/new 立替精算専用ページ + ナビ追加
- [x] 証憑催促Day3 reply_broadcast（チャンネルトップ表示）
- [x] 仕訳Stage2自動化（カード照合確定→未請求→請求）
- [x] 仕訳Stage3自動化（引落消込→請求→普通預金）
- [x] PostgreSQL全文検索（pg_trgm+GIN+マイページ検索バー）
- [x] 仕訳学習ループ（account_corrections+RAGコンテキスト注入）
- [x] Slack対話型AI（/askコマンド+Claude Haiku RAG応答）
- [x] 低信頼度推定時のOPS通知
- [x] 監査ログ（audit_logテーブル+updateStatus自動記録）
- [x] リトライ+DLQ（指数バックオフ+dead_letter_queue+OPS通知）
- [x] 障害復旧手順書（docs/disaster-recovery.md）
- [x] 日次DBバックアップ（GDrive永久保持、cron JST 03:00）
- [x] architecture-2026-04.md 未実装リスト更新
- [x] 全変更コミット・デプロイ済み（d6e63b6〜7db818f）

### Pending
1. Supabase Proプラン購入判断（PITR秒単位リストア、$25/月）
2. Slack App設定: /askコマンド追加（Request URL設定）
3. バーチャルカード配布後の実機テスト（MF経費自動連携検証）
4. 仕訳管理画面で科目変更時にaccount-correction APIを呼ぶUI連携
5. Procurement-Assistant廃止（本番切替時）

### Next actions
1. Slack App管理画面で`/ask`スラッシュコマンドを追加（URL: /api/slack/events）
2. GOOGLE_DRIVE_BACKUP_FOLDER_ID環境変数をVercelに設定（バックアップ専用フォルダ）
3. /admin/journalsで科目変更時にPOST /api/admin/account-correctionを呼ぶように改修
4. バーチャルカード配布後: MFカード→MF経費の自動連携を実機検証
5. 本番切替計画の策定（Procurement-Assistant→next-procurement-poc）

### Affected files
- `src/app/expense/new/page.tsx` — 新規: 立替精算ページ
- `src/app/api/cron/db-backup/route.ts` — 新規: 日次DBバックアップ
- `src/app/api/ai/ask/route.ts` — 新規: Slack対話型AI
- `src/app/api/admin/account-correction/route.ts` — 新規: 修正記録API
- `src/app/api/purchase/search/route.ts` — 新規: 全文検索API
- `src/lib/retry.ts` — 新規: リトライ+DLQ
- `src/db/schema.ts` — audit_log, dead_letter_queue, account_corrections追加
- `src/lib/account-estimator.ts` — 修正履歴RAG注入
- `src/lib/mf-accounting.ts` — リトライ適用
- `src/lib/db-client.ts` — writeAuditLog/getAuditLog/getAccountCorrections
- `src/app/api/admin/card-matching/confirm/route.ts` — Stage2仕訳自動作成
- `src/app/api/admin/card-matching/withdrawal/route.ts` — Stage3仕訳自動作成
- `docs/disaster-recovery.md` — 新規: 障害復旧手順書
- `docs/workflow-design-b-route.md` — 新規: B案設計MD版
- `vercel.json` — db-backup cron追加

### Repro / Commands
```bash
# デプロイ済み
https://next-procurement-poc-tau.vercel.app

# 手動バックアップ実行
curl -H "Authorization: Bearer $CRON_SECRET" https://next-procurement-poc-tau.vercel.app/api/cron/db-backup

# 全文検索テスト
curl "https://next-procurement-poc-tau.vercel.app/api/purchase/search?q=モニター"

# 最新コミット: 7db818f
```

### Risks / Unknowns
- Supabase Free tierのバックアップはGDriveのみ（PITRなし）
- /askコマンドはSlack App管理画面での手動設定が必要
- account_corrections のUI連携が未実装（APIのみ）
- バーチャルカード未配布のため照合フローは未検証

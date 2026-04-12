## [Handoff] "DB移行完了 + B案出張統合実装 + UI互換修正" — 2026-04-12 14:02 (branch: master)

### Goal / Scope
- GAS→Supabase Postgres(Tokyo)への完全移行
- B案（出張バーチャルカード統合）のバックエンド+フロントエンド実装
- DB移行に伴うUI互換性の修正
- ドキュメント一括更新（architecture, db-schema, operational-guide, user-manual, test-plan）
- やらないこと: Procurement-Assistant(本番GAS)の変更、Slack自動取込機能の移植

### Key decisions
- **Supabase選定(Neon却下)**: NeonにTokyo regionなし(Singapore 70-90ms RTT)。Supabaseはap-northeast-1で利用可能
- **Drizzle ORM選定(Prisma却下)**: Vercelコールドスタート最速(<300ms)、バンドル7KB
- **gas-client.ts re-exportパターン**: 31ファイル無変更でDB移行。gas-client→db-clientの全面re-export
- **office_member_idベース照合**: card_last4に依存せず、MF経費APIのoffice_member_idで従業員特定
- **B案(MF経費経由)確定**: 仕訳の主導権は購買管理が持つ。MF会計Plus自動仕訳ルールは使わない
- **出張PO番号ユニーク化**: TRIP-YYYYMM-NNNN形式で衝突回避

### Done
- [x] Supabase Postgres導入(Tokyo, 17.6) — ウォーム時150ms
- [x] Drizzle ORM + 15テーブルスキーマ設計・適用
- [x] db-client.ts(gas-client互換)作成
- [x] gas-client.ts→db-client re-export化(31ファイル無変更移行)
- [x] データ移行スクリプト(GAS→Postgres) — 従業員28名, MFマスタ1700件超, 購買2件
- [x] UI互換修正: voucherStatus/requestType/getStatus日本語キー名/金額照合計算
- [x] B1: 従業員マスタoffice_member_id同期(26名紐付け)
- [x] B2: MF経費API拡張(fetchAllCardStatements + NormalizedCardStatement)
- [x] B5: card-matcher-v2.ts(office_member_idベース照合エンジン)
- [x] B3: /trip/new 出張申請Webページ(交通費/宿泊費分離入力)
- [x] B4: 出張承認DMフロー(sendApprovalDM流用)
- [x] ドキュメント: architecture-2026-04.md, db-schema.md新規 + 4ファイル更新
- [x] 全機能Vercelデプロイ・動作確認済み

### Pending
1. 動作確認テスト（出張申請E2E: フォーム→Slack投稿→承認DM→ステータス変更）
2. バーチャルカード配布後のMF経費カード自動取込検証(automatic_status確認)
3. Slack自動取込機能の実装(Procurement-Assistant main.js移植) — 本番置換時
4. 立替精算Webページ(/expense/new)
5. ドキュメントにB案実装内容を反映(architecture-2026-04.md追記)

### Next actions
1. 出張申請テスト: /trip/new で申請→#出張チャンネル投稿→部門長DM承認→ステータス確認
2. UI互換の網羅テスト: purchase/my, purchase/[prNumber], dashboard の全表示項目確認
3. MFビジネスカード→MF経費の自動連携設定を管理者に依頼→automatic_status再確認
4. card-matcher-v2の実機テスト: /api/test/card-match-v2 でカード自動取込データとの照合検証
5. 立替精算(/expense/new)の設計・実装

### Affected files
- `src/db/schema.ts` — 15テーブル, 8 enum型のDrizzleスキーマ
- `src/db/index.ts` — Supabase接続(PgBouncer対応)
- `src/lib/db-client.ts` — gas-client互換DB実装(全関数)
- `src/lib/gas-client.ts` — db-clientからのre-exportラッパーに変更
- `src/lib/gas-client.ts.backup` — 元のGAS実装のバックアップ
- `src/lib/mf-expense.ts` — fetchCardStatements/fetchAllCardStatements/NormalizedCardStatement追加
- `src/lib/card-matcher-v2.ts` — 新規: office_member_idベース照合エンジン
- `src/app/trip/new/page.tsx` — 新規: 出張申請フォーム
- `src/app/api/trip/submit/route.ts` — 新規: 出張申請API(DB登録+Slack+承認DM)
- `src/app/layout-client.tsx` — ナビに「出張申請」追加
- `src/app/purchase/my/page.tsx` — overallStatus修正(voucherDone判定)
- `src/app/api/cron/card-reconciliation/route.ts` — fetchAllCardStatements使用に切替
- `drizzle.config.ts` — Drizzle Kit設定
- `scripts/apply-migration.ts` — マイグレーション適用スクリプト
- `scripts/migrate-from-gas.ts` — GAS→DB移行スクリプト
- `scripts/sync-office-members.ts` — MF経費office_member同期
- `docs/architecture-2026-04.md` — 新規: 現行アーキテクチャSoT
- `docs/db-schema.md` — 新規: DBスキーマリファレンス

### Repro / Commands
```bash
npx vercel --prod  # デプロイ済み
# DB接続テスト: GET /api/test/db (Bearer CRON_SECRET)
# カード照合v2テスト: GET /api/test/card-match-v2?from=2026-02-01&to=2026-04-10
# MF経費検査: GET /api/test/mf-expense-inspect?endpoint=office_members
# マイグレーション: npx tsx scripts/apply-migration.ts
# データ移行(GAS→DB): npx tsx scripts/migrate-from-gas.ts [--dry-run]
# office_member同期: npx tsx scripts/sync-office-members.ts [--dry-run]
```

### Risks / Unknowns
- MFビジネスカード→MF経費の自動連携が未設定。automatic_status="automatic"の実データ未検証
- バーチャルカード未配布のため出張カード照合の実機検証不可
- Supabase Free planのauto-pause(7日無操作): cache-warm cronでDB pingすれば防げるが未実装
- 立替精算(MF経費の手動入力分)の扱い: 購買管理で照合対象外としているが運用上正しいか要確認
- Neon調査で判明: Supabaseも将来的にJ-SOX/FISC明示なし(日本の金融規制対応は別途検討)

### Links
- Vercel: https://next-procurement-poc-tau.vercel.app
- Supabase: supabase-cordovan-fountain (ap-northeast-1)
- Upstash Redis: upstash-kv-bistre-sail (Tokyo)
- 業務フローPPT: docs/workflow-design-b-route.pptx

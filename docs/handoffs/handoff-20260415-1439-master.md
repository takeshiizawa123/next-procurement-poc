## [Handoff] "システム総合検証+役務契約管理+Notion自動同期" — 2026-04-15 14:39 (branch: master)

### Goal / Scope
- 3観点の詳細検証（本番耐性/UI-UX/サステナビリティ）→35件の指摘を全件対応
- 役務提供・継続契約の請求書管理機能をPhase A-Dで実装
- Notion API自動同期基盤の構築・DB作成・管理UI
- マニュアル7本+PPTX3本の一括整備
- DM誤送信インシデント対応（FORCE_TEST_MODE多重防御）
- やらないこと: Procurement-Assistant廃止、本番切替

### Key decisions
- db-client.ts(1,449行)を7モジュールに分割 — ファサードパターンで呼出し元変更不要
- 役務はpurchase_requestsに混ぜず別テーブル(contracts+contract_invoices)で管理 — 列の意味が曖昧になるため
- FORCE_TEST_MODE=trueをコードにハードコード — 環境変数依存は信用しない（インシデント教訓）
- SlackクライアントをProxy化して全送信を自動リダイレクト — 個別にsafeDmChannelを呼ぶ漏れを防止
- Notion SDK v5のdatabases.createはproperties引数廃止 — REST API直接呼出しで対応
- NextAuth v5-betaはバージョン固定(5.0.0-beta.30) — ^指定だと予期せぬ破壊的更新
- Vercelは既にProプラン — cache-warm 360回/日も問題なし

### Done
- [x] マニュアル7本(MD)+PPTX3本更新(3843b73〜b85c851)
- [x] 仕訳管理画面の科目修正UI連携(3843b73)
- [x] Phase 1: Slack冪等性、楽観的ロック、MF仕訳DLQ、NextAuth固定、ログアウト(0d0d333)
- [x] Phase 2: Cron障害通知(7cron)、ヘルスチェック強化、データ保持policy、.env.example(690e9a0)
- [x] Phase 3: error.tsx(3箇所)、GitHub Actions CI、Admin RBAC分離(983baaa)
- [x] db-client.ts分割: types/purchase/employee/request/prediction/master/audit-repo(13a17a3)
- [x] Vitest導入+41テストケース(53115bf) + CI追加(e452c3f)
- [x] UI改善: フォームバリデーション、検索フィルタバグ、ナビハイライト、モバイル、a11y(c1d081a,460cfa7)
- [x] DM誤送信対応: FORCE_TEST_MODE+Proxy化+CLAUDE.md禁止事項(6c8405d〜14860a0)
- [x] 役務契約Phase A: DB(contracts+contract_invoices)+API(4ルート)+UI(3ページ)(7a00068)
- [x] 役務契約Phase B: 見積計上/リバース/更新アラート+未着督促cron(1c480b8)
- [x] 役務契約Phase C: 仕訳管理画面に「契約仕訳」タブ(b28507c)
- [x] 役務契約Phase D: Notion API基盤+5同期機能+DLQ連携+管理UI(cabd5c5,0ebb724)
- [x] Notion DB5つ自動作成+Vercel環境変数設定+初回同期確認済み
- [x] 全変更デプロイ済み(最新: 0ebb724)

### Pending
1. 役務契約Phase C2: カード明細×契約マスタの自動マッチ（card-matcher-v2拡張）
2. Notion同期の定期実行cron化（現在は手動/契約作成時のみ）
3. notion.tsのSDK v5対応改善（syncContract内のsearch APIがworkaround）
4. Slack App管理画面で`/ask`コマンド追加（手動設定）
5. GOOGLE_DRIVE_BACKUP_FOLDER_ID環境変数設定（手動）
6. 本番切替計画の策定（FORCE_TEST_MODE解除手順はCLAUDE.mdに記載済み）
7. slack.ts(2,264行)の分割（db-client同様にファサード化推奨）
8. オンボーディングガイド作成

### Next actions
1. `/admin/notion-sync`で「全て同期」を実行し、Notionにフロー図・プロンプト・契約が同期されていることを確認
2. `/admin/contracts/new`でテスト契約を登録し、Notionの継続契約マスタDBに自動同期されることを確認
3. card-matcher-v2にcontracts.billing_type="カード自動"の契約マッチロジックを追加
4. Notion同期cronを追加（月次: フロー図+プロンプト同期、日次: 変更履歴記録）
5. slack.ts分割（slack-messages.ts/slack-actions.ts/slack-dm.tsに分離）
6. 本番切替計画書の作成（段階的ロールアウト手順）

### Affected files
- `src/lib/db/` — 7モジュール(types/purchase/employee/request/prediction/master/audit-repo)
- `src/lib/db-client.ts` — ファサード(130行)
- `src/lib/slack.ts:59-150` — FORCE_TEST_MODE+Proxy化+safeDmChannel
- `src/lib/notion.ts` — Notion API基盤(5同期機能+フロー定義)
- `src/lib/slack-signature.ts` — 署名検証ロジック(テスト可能化)
- `src/lib/retry.ts:92-100` — DLQ時Notion連携追加
- `src/lib/api-auth.ts` — requireAdminAuth新設
- `src/lib/cron-helper.ts` — Cronガードユーティリティ
- `src/db/schema.ts` — contracts+contractInvoices+3 enum追加
- `src/app/admin/contracts/` — 3ページ(一覧/新規/詳細)
- `src/app/admin/journals/ContractJournalTab.tsx` — 契約仕訳タブ
- `src/app/admin/notion-sync/page.tsx` — Notion同期管理画面
- `src/app/api/admin/contracts/` — 4 APIルート
- `src/app/api/admin/notion-sync/route.ts` — 同期API
- `src/app/api/cron/contract-accrual/` — 月末見積計上
- `src/app/api/cron/contract-reversal/` — 翌月リバース
- `src/app/api/cron/contract-alerts/` — 更新アラート+未着督促
- `src/app/api/cron/data-cleanup/` — データ保持ポリシー
- `.github/workflows/ci.yml` — lint+test+build CI
- `vitest.config.ts` + 3テストファイル
- `CLAUDE.md` — FORCE_TEST_MODE禁止事項+本番切替手順追加
- `docs/design-service-contracts-and-notion.md` — 統合設計書

### Repro / Commands
```bash
# デプロイ済み
https://next-procurement-poc-tau.vercel.app

# テスト実行
npm test  # 41テストケース

# Notion同期（ブラウザ）
https://next-procurement-poc-tau.vercel.app/admin/notion-sync

# 手動Notion同期（CLI）
curl -X POST ".../api/admin/notion-sync" -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"action":"sync-all"}'

# 最新コミット: 0ebb724
```

### Risks / Unknowns
- Notion SDK v5でdatabases.queryが廃止 → syncContractの重複チェックがsearch APIのworkaround
- Vercel自動デプロイが無効の可能性（git push後に手動`npx vercel --prod`が必要だった）
- FORCE_TEST_MODE=true が有効な限り、全Slack送信はテストチャンネルにリダイレクト
- 契約仕訳タブからのMF仕訳登録はcontractJournal用のパラメータをmf/journal APIに渡すが、API側の対応は未実装（通常の仕訳登録として処理される）
- Notion環境変数6つがVercel Productionにのみ設定済み（Preview/Developmentには未設定）

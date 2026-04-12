## [Handoff] "RAG精度検証 + Amazon CSV照合 + EC連携証憑スキップ" — 2026-04-09 02:53 (branch: master)

### Goal / Scope
- RAG勘定科目推定の精度を実データで検証
- Amazon CSV照合機能を新規実装し、業務フロー（Phase 1〜3）に組み込み
- EC連携サイト（Amazon/MISUMI/楽天/Yahoo）の証憑催促スキップ
- 検収フローに納品書あり/なし選択を追加
- やらないこと: MF会計Plus × Amazon Business App Center連携の有効化（本番影響あり、経理判断待ち）

### Key decisions
- RAG精度検証: 過去仕訳原票をテストデータとして利用（手動テストデータ不要）→ 93.3%正答率
- Amazon照合: クライアントサイド完結（API不要、CSVパース+マッチングをブラウザで実行）
- EC連携サイト判定: `src/lib/ec-sites.ts` に共通ヘルパー。証憑対応="MF自動取得"で催促スキップ
- 納品書: 法人税法上、受領した場合は保存義務あり → 検収時に有無選択 + ありならファイル添付
- MF会計Plus連携: Amazon Business App Centerで連携可能だが本番影響あるため保留

### Done
- [x] RAG精度検証API (`/api/purchase/estimate-account/verify`) — 93.3%正答率、税区分96.7%
- [x] Amazon CSVパーサー + マッチングエンジン (`src/lib/amazon-matcher.ts`)
- [x] Amazon照合タブUI (`src/app/admin/journals/AmazonMatchingTab.tsx`)
- [x] Phase 1: CSVエクスポート、Slack DM事後申請依頼、適格番号GAS書き戻し
- [x] Phase 2: カード照合cronにAmazon注記追加、card-matchingページにAmazonバッジ
- [x] Phase 3: 検収モーダル（納品書あり/なし+添付）、EC連携サイト証憑スキップ（Web+Slack両対応）
- [x] Phase 3: 照合実行時Slack #管理本部サマリ投稿 + 差額±5,000円超アラート

### Pending
1. MF会計Plus × Amazon Business App Center連携の有効化（経理チームと調整後）
2. EC連携サイト（MISUMI/楽天/Yahoo）のApp Center連携有効化
3. Gmail経由のAmazon CSVレポート自動取得（スケジュールレポート設定後に実装可能）
4. GASレスポンス自体の高速化（スプレッドシート読取7-8秒が根本ボトルネック）

### Next actions
1. 経理チームにMF会計Plus × Amazonビジネス連携の有効化を相談（App Centerから「アプリと連携する」）
2. 連携後、MF側にAmazon購買データが仕訳候補として出るか確認
3. Amazon Business管理画面でスケジュールレポート（週次CSV）のGmail配信を設定
4. Gmail API経由のCSV自動取得cron実装（スケジュールレポート設定後）
5. MISUMI/楽天/Yahoo利用状況を確認し、連携有効化の優先度を判断

### Affected files
- `src/lib/amazon-matcher.ts` — 新規: CSVパーサー + スコアリングマッチングエンジン
- `src/lib/ec-sites.ts` — 新規: EC連携サイト判定ヘルパー (`isEcLinkedSite`)
- `src/app/admin/journals/AmazonMatchingTab.tsx` — 新規: Amazon照合タブUI（エクスポート/DM/適格番号保存）
- `src/app/admin/journals/page.tsx` — Tab追加（"amazon"）
- `src/app/api/admin/amazon-matching/notify/route.ts` — 新規: Slack DM事後申請依頼API
- `src/app/api/admin/amazon-matching/summary/route.ts` — 新規: Slackサマリ投稿API
- `src/app/api/purchase/estimate-account/verify/route.ts` — 新規: RAG精度検証API
- `src/app/api/purchase/[prNumber]/status/route.ts` — EC連携判定→証憑対応分岐、納品書ステータス、適格番号allowed追加
- `src/app/api/purchase/upload-voucher/route.ts` — 納品書タイプ(type=delivery_note)対応
- `src/app/api/cron/card-reconciliation/route.ts` — Amazon関連明細の注記追加
- `src/app/api/cron/voucher-reminder/route.ts` — "MF自動取得"催促除外コメント追加
- `src/app/purchase/[prNumber]/page.tsx` — 検収モーダル（納品書有無+添付）、MF自動取得ステータス表示
- `src/app/admin/card-matching/page.tsx` — AmazonバッジUI追加
- `src/lib/reconciliation.ts` — `isAmazonStatement`ヘルパー + `amazonRelated`集計フィールド追加
- `src/lib/slack.ts` — 検収完了メッセージのEC連携対応（Slackボタン+Web両方）

### Repro / Commands
```bash
npx vercel --prod  # デプロイ済み
# RAG精度検証: GET /api/purchase/estimate-account/verify?limit=30
# Amazon照合: /admin/journals → Amazon照合タブ → CSVアップロード
# 検収モーダル: /purchase/[prNumber] → 検収完了ボタン
```

### Risks / Unknowns
- MF会計Plus × Amazon Business連携: 有効化は本番会計データに影響するため経理判断必須
- EC連携サイト判定: supplierNameの表記揺れ（例: "Amazon.co.jp" vs "アマゾンジャパン合同会社"）でマッチしない可能性 → 運用で判明次第パターン追加
- 納品書ステータス: GAS側に「納品書」列が存在しない場合は自動追加される前提（GASのupdateStatusが任意フィールドを受け付ける）
- Gmail API経由のCSV自動取得: 添付ファイルのバイナリ取得がGmail MCPで可能か未検証 → REST API直接呼び出しが確実

### Links
- Amazon Business App Center: https://business.amazon.co.jp (管理画面 → システム連携 → App Center)
- MF会計Plus証憑自動取得対応サービス: https://biz.moneyforward.com/support/ac-plus/guide/business/voucher_aggre.html

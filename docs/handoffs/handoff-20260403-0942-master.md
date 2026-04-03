# [Handoff] "MFカード統一運用・適格請求書管理・概算緊急フロー実装" — 2026-04-03 09:42 (branch: master)

### Goal / Scope
- 出張手配・購買を「会社メール個人アカウント + MFビジネスカード（物理+バーチャル）」で統一する運用設計
- 適格請求書（インボイス）管理の仕組み実装（OCR結果のGAS保存・免税事業者控除率警告）
- 概算フロー・緊急事後報告フローのSlackモーダル＋予測レコード対応
- カード照合時の概算差額検知・未報告カード利用の社員DM通知
- やらないこと: GASスプレッドシートのカラム追加（手動）、管理画面UIへの新項目反映 ← **次のタスク**

### Key decisions
- **法人契約なし（案A）を推奨** — 全サービス個人アカウント+MFカード統一、法人契約は必要に応じて後から追加（案B）
- **PJ紐付けは既存の /trip + HubSpot案件番号で解決済み** — 法人契約のカスタム項目は不要
- **カード払いでも取引先コードを設定** — 適格請求書の発行元管理・購入先別支出分析のため（mf-accounting.ts修正済み）
- **JCSの「与信審査不要」は誤り** — PDF資料にリクルート所定の審査ありと明記（JCS_detail p11）
- **全社員にMFカード（物理+バーチャル）配布が前提** — 現在は一部社員のみ、追加発行が必要
- **緊急時こそMFカード** — 現金立替より管理容易（明細自動記録・未申告検知可能）

### Done
- [x] 出張手配サービス推奨案の提案書（docs/travel-services/recommendation.md）
- [x] PowerPointスライド 13枚（docs/travel-services/出張手配サービス導入_推奨案.pptx + gen_pptx.py）
- [x] JCS vs Racco比較メモの修正（与信審査→所定の審査あり）
- [x] /purchase モーダル: 概算フラグ・緊急事後報告・購入日・緊急理由を追加（slack.ts）
- [x] /trip モーダル: 概算フラグを追加（route.ts）
- [x] PredictedTransaction: is_estimate, is_post_report, emergency_reason フラグ追加（gas-client.ts, prediction.ts）
- [x] 事後報告の処理分岐: 事後承認DM・OPS通知（route.ts handlePurchaseSubmission）
- [x] カード払いでも取引先コード設定（mf-accounting.ts buildJournalFromPurchase）
- [x] OCR結果の適格請求書情報をGASに保存（route.ts handleFileSharedInThread）
- [x] 免税事業者の経過措置控除率警告（ocr.ts getTransitionalDeductionRate）
- [x] 概算差額検知（card-matcher.ts phase1PredictionMatch: ±20%/±5,000円閾値）
- [x] 概算差額超過のOPS通知（execute/route.ts）
- [x] 未報告カード利用の社員DM通知（card-reconciliation/route.ts）
- [x] PastRequest に registrationNumber, isQualifiedInvoice, invoiceVerificationStatus 追加（gas-client.ts）

### Pending
- [ ] GASスプレッドシートに新カラム追加（手動）: 登録番号, 適格請求書, 登録番号検証, 概算フラグ, 事後報告フラグ, 緊急理由, 購入日
- [ ] 管理画面UI（/admin/journals, /purchase/my, ダッシュボード）に新項目を反映
- [ ] スプレッドシートのカラム設計を一括検討（既存カラムとの整合性）
- [ ] MFカード全社員配布（物理+バーチャル）の実施
- [ ] いだてんのカード決済対応をプラス社に確認
- [ ] ANA Biz法人カード利用モデルでMFカード対応確認
- [ ] コミット・デプロイ

### Next actions
1. GASスプレッドシート+UIの一括設計 — 新カラム7項目の配置、管理画面への表示方法、フィルタ・ソート対応を検討
2. /admin/journals に概算バッジ・事後報告バッジ・適格請求書ステータスを表示
3. /purchase/my に概算・事後報告の申請状態表示を追加
4. ダッシュボードに適格請求書の統計（適格率・非適格件数）を追加
5. GASスプレッドシートにカラム追加（手動作業）
6. 変更をコミット・Vercelデプロイ
7. MFカード全社員配布の実施調整（管理本部）

### Affected files
- `src/lib/slack.ts` — buildPurchaseModal（概算CB・事後報告・購入日・緊急理由追加）, PurchaseFormData, parsePurchaseFormValues
- `src/app/api/slack/events/route.ts` — buildTripModal（概算CB追加）, handleTripSubmission（概算フラグ読取・伝搬）, handlePurchaseSubmission（事後報告分岐・概算バッジ）, handleFileSharedInThread（OCR結果GAS保存・控除率警告）
- `src/lib/prediction.ts` — ApprovalInfo, TripPredictionInfo（is_estimate等追加）, generatePrediction, generateTripPredictions（フラグ伝搬）
- `src/lib/gas-client.ts` — PredictedTransaction（is_estimate等）, PastRequest（registrationNumber等）
- `src/lib/ocr.ts` — getTransitionalDeductionRate()（新規関数）
- `src/lib/mf-accounting.ts` — buildJournalFromPurchase（カード払いでも取引先コード設定）
- `src/lib/card-matcher.ts` — ConfidentMatch（isEstimateDiffExceeded等）, phase1PredictionMatch（概算許容差拡大・閾値チェック）
- `src/app/api/admin/card-matching/execute/route.ts` — 概算差額超過OPS通知
- `src/app/api/cron/card-reconciliation/route.ts` — 未報告カード利用の社員DM通知
- `scripts/gen_pptx.py` — PPT生成スクリプト（12→13スライド）
- `docs/travel-services/recommendation.md` — 提案書
- `docs/travel-services/comparison.md` — 比較メモ

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit          # 型チェック
npm run build             # ビルド確認（成功済み）
npm run dev               # localhost:3333
python scripts/gen_pptx.py  # PPT再生成
```

### Risks / Unknowns
- GASスプレッドシートのカラム追加が手動 — 既存データとの整合性を確認してから実施
- 概算差額の閾値（±20%/±5,000円）が適切かは運用で調整が必要
- いだてん・ヨドバシ法人のカード決済対応は未確認
- MFカード全社員配布の実施タイミングと発行手続き

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- PPT: docs/travel-services/出張手配サービス導入_推奨案.pptx
- 提案書: docs/travel-services/recommendation.md
- 比較メモ: docs/travel-services/comparison.md

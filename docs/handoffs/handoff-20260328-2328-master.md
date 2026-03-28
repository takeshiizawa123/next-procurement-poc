# [Handoff] "経理処理精査・入力項目整備完了" — 2026-03-28 23:28 (branch: master)

### Goal / Scope
- 統制強化2件（日次乖離アラート・利用傾向ダッシュボード）の実装
- 経理処理に必要な入力項目の精査・実装（OCR税率・適格検証・固定資産・返品・前払い・出張拡張）
- 消費税仕入税額控除の区分方針の検討・決定
- 全ドキュメント（設計書・マニュアル・運用ガイド・PPTX）への反映
- やらないこと: 手動設定14項目・Vercelデプロイ・E2Eテスト（後日まとめて実施）

### Key decisions
- **二段階承認廃止済み**: 全件申請者が発注、管理本部は経理専任
- **消費税区分**: 全件「課税仕入10%」で統一。5億超時は一括比例配分方式を検討（顧問税理士と相談）
- **固定資産**: 10万円以上は全てFA登録（少額特例不使用）。検収時にOPS自動通知
- **材料費基準**: 1万円以上→材料仕入、1万円未満→消耗品費
- **立替フロー修正**: 申請者がMF経費で経費申請を提出（管理本部確定ではない）
- **外貨対応不要**: MFカード円換算で完結、海外送金は購買管理の範囲外
- **電帳法タイムスタンプ不要**: MF会計Plus・Google Driveの履歴管理で要件充足

### Done
- [x] 日次金額乖離アラート（`/api/cron/daily-variance`）
- [x] 従業員別利用傾向ダッシュボード（`/admin/spending`）
- [x] 発注業務変更の強調（マニュアル・PPTX）
- [x] 検収者フィールド追加（Webフォーム・submit API）
- [x] Gemini OCR拡張（税率・税額・登録番号読取）
- [x] 国税庁API連携（適格請求書発行事業者検証）
- [x] 請求書支払期日（月末締翌月末、修正可）
- [x] 固定資産通知（10万円以上の検収時にOPS通知）
- [x] 材料費1万円基準（勘定科目推定ルール追加）
- [x] 返品ボタン（検収済みに返品フロー追加）
- [x] 前払いフラグ（「請求書払い（前払い）」選択肢）
- [x] 出張: HubSpot案件番号・部門自動取得・日当自動計算
- [x] 消費税区分方針を設計書§13.5に記録
- [x] 全ドキュメント反映（設計書・マニュアル・運用ガイド・PPTX）

### Pending
- [ ] 手動設定14項目（従業員マスタ列追加、clasp push、GCP認証、MF補助科目等）
- [ ] Vercelデプロイ + E2Eテスト
- [ ] セキュリティ・耐障害性の確認（ユーザーが次セッションで確認希望）
- [ ] 部門→課税区分マッピング（5億超になった場合のみ。顧問税理士と相談後）

### Next actions
1. セキュリティ・脆弱性チェック（OWASP Top 10、API認証、環境変数管理）
2. バックアップ・履歴管理の確認（GAS・MF会計・Google Drive・Slack）
3. 障害分離の確認（外部API障害時のフォールバック動作）
4. 手動設定14項目の実施→clasp push→Vercelデプロイ
5. E2Eテスト（test-plan.md Phase 6に沿って）

### Affected files
- `src/lib/ocr.ts:12-28,40-70,135-200` — OCR型定義・プロンプト拡張・国税庁API
- `src/lib/slack.ts:263-335,386-480,852-854,970-980` — 検収(FA通知)・返品ハンドラー・前払い選択肢・支払期日表示
- `src/lib/account-estimator.ts:91-110` — 材料費1万円基準
- `src/app/api/cron/daily-variance/route.ts` — 日次乖離アラート（新規）
- `src/app/admin/spending/page.tsx` — 利用傾向ダッシュボード（新規）
- `src/app/api/admin/spending/route.ts` — 利用傾向API（新規）
- `src/app/api/slack/events/route.ts:470-510,628` — 出張拡張・前払い支払期日
- `src/app/api/purchase/submit/route.ts:15-30,108-168` — 検収者解決・支払期日
- `src/app/purchase/new/page.tsx:384,1110-1130` — 検収者・前払い選択肢
- `docs/design-mf-integration-final.md` — §11,§13.5,§14.5-14.10追加
- `docs/user-manual.md` — §3.1.1返品, §7.1日当, FAQ, 改訂v0.4
- `docs/operational-guide.md` — §5発見統制, §10返品ステータス

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
http://localhost:3333/admin/spending
http://localhost:3333/admin/card-matching?demo=1
python docs/scripts/generate_manual_ppt.py
python docs/scripts/generate_ppt.py
```

### Risks / Unknowns
- 国税庁Web-APIのレート制限未確認（大量証憑添付時）
- card-matchingページのuseSearchParams/Suspense問題（既存・ビルド時のみ）
- 5億超時の一括比例 vs 個別対応は顧問税理士と要相談
- セキュリティ・耐障害性の点検が未実施（次セッションで対応予定）

### Links
- docs/design-mf-integration-final.md（統合設計書）
- docs/user-manual.md / docs/user-manual.pptx
- docs/operational-guide.md / docs/operational-guide.pptx
- docs/test-plan.md

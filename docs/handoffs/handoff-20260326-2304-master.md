## [Handoff] "MF連携調査・会計照合設計" — 2026-03-26 23:04 (branch: master)

### Goal / Scope
- Sprint 0-5全機能実装 + 品質修正7件 + UX改善5件を完了
- MF会計Plus/MF経費/MFビジネスカードの連携モデル設計を調査中
- やらないこと: MFビジネスカードAPI（非公開のため不可）

### Key decisions
- Sprint 0-5: 全完了（署名検証・PO番号GAS発番・承認者修正・証憑検知・日次サマリ・MF会計連携・出張/trip・統制強化）
- 品質修正7件: 署名バイパス修正・発注権限強化・OCR保護・tripバリデーション・税率柔軟化・OAuth永続化
- UX改善5件: 承認リマインド・発注完了リマインド・完了メッセージ・/mystatus・マイページ未対応ダッシュボード+証憑UP
- MF連携: 案B（購買はMF経費バイパス→MF会計Plus直接）を検討中だが、確定前
- 会計照合: 3ステージ未払金管理モデル（未請求債務/請求債務）を検討中だが、確定前
- MF経費API: 申請作成(POST ex_reports)は不可。証憑アップロード(upload_receipt)は可能
- MFビジネスカードAPI: 非公開。カード明細はMF会計Plus「通帳・カード他」経由のみ
- クラウドBox: 証憑→AI-OCR→仕訳候補の自動生成機能あり（新発見・要検討）

### Done
- [x] Sprint 0-5 全機能実装（17コミット）
- [x] 品質修正7件（署名・権限・OCR・バリデーション・税率・OAuth）
- [x] UX改善5件（リマインダー・/mystatus・マイページ刷新）
- [x] 運用ガイド + 利用者マニュアル（MD + PPT）
- [x] テスト計画書作成
- [x] MF経費API全エンドポイント調査
- [x] MF会計Plus連携パターン調査
- [x] 会計照合設計書v2（3ステージモデル）
- [x] MF連携4案比較書
- [x] 証憑のMF経費自動転送（upload_receipt API）実装

### Pending
- [ ] MF連携最終方針の決定（案A/B/C/D or 別案）
- [ ] クラウドBox経由の仕訳候補連携の活用可否検討
- [ ] MF会計Plusの仕訳添付API存在確認
- [ ] 会計照合モデルの確定（未請求/請求分離 or 簡易モデル）
- [ ] カード利用明細の「対象外」処理の自動化方法
- [ ] 環境変数設定 + Vercelデプロイ
- [ ] 内部テスト（Phase 1-5）
- [ ] マニュアル最終化（MF連携部分確定後）

### Next actions
1. **クラウドBox活用案の検討**: 証憑→クラウドBox→AI-OCR仕訳候補という新経路が案Bの代替/補完になり得るか分析
2. **MF会計Plus API仕訳添付の確認**: journals/{id}/attachments エンドポイントの存否をAPI仕様書で確認
3. **4つの金額（納品書・速報・確定・引落）の照合フロー確定**: 御社の会計担当と未請求/請求モデルの要否を確認
4. **MF連携最終方針を決定**: 案B+クラウドBox併用が有力だが、MF経費の既存運用への影響を評価
5. **環境変数設定 + デプロイ**: 方針確定後に実施
6. **内部テスト**: テスト計画書(docs/test-plan.md)に沿ってPhase 1-5を実施

### Affected files
- `src/lib/mf-oauth.ts` — OAuth認証基盤（トークン永続化済み）
- `src/lib/mf-accounting.ts` — MF会計Plus仕訳API（税率柔軟化済み）
- `src/lib/mf-expense.ts` — MF経費API + upload_receipt + じゃらんCSV
- `src/lib/ocr.ts` — Gemini Vision OCR（JSON.parse保護済み）
- `src/lib/reconciliation.ts` — カード明細突合エンジン
- `src/lib/slack.ts` — actionValue 6フィールド拡張・権限強化済み
- `src/app/api/slack/events/route.ts` — 署名検証・/mystatus・/trip・証憑MF転送
- `src/app/api/mf/journal/route.ts` — 仕訳登録API
- `src/app/purchase/my/page.tsx` — マイページ（未対応ダッシュボード+証憑UP）
- `docs/design-mf-integration-options.md` — MF連携4案比較
- `docs/design-accounting-reconciliation.md` — 会計照合3ステージモデル
- `docs/design-plan-b-mf-direct.md` — 案B詳細設計

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run build  # ビルド確認
git log --oneline -20  # 直近コミット確認
```

### Risks / Unknowns
- MF会計Plus APIに仕訳添付(証憑PDF)のエンドポイントがあるか未確認
- クラウドBox APIが公開されているか未確認（UI機能は確認済み）
- MFビジネスカードからMF会計PlusとMF経費に同時連携した場合の重複処理が未検証
- カード確定値の取得方法が未確定（API不可→手動 or MF会計Plus経由）
- 御社のMF会計Plusの現在の補助科目構成が未確認

### Links
- GitHub: https://github.com/takeshiizawa123/next-procurement-poc
- MF経費API: https://expense.moneyforward.com/api/index.html
- MF会計Plus証憑添付: https://biz.moneyforward.com/support/ac-plus/guide/e-book/eb02.html
- クラウドBox仕訳候補連携: https://biz.moneyforward.com/support/account/news/new-feature/20241008.html
- MFビジネスカード会計連携: https://biz.moneyforward.com/support/biz-pay/guide/setting-guide/g069.html

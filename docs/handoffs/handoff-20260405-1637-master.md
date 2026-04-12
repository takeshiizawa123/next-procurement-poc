## [Handoff] "Gemini 2段階アプローチ Phase 1実装完了 + 全体設計確定" — 2026-04-05 16:37 (branch: master)

### Goal / Scope
- OCR読取項目の拡充・仕訳ルール策定・証憑プレビュー・摘要統計・Gemini 2段階設計を実施
- やらないこと: Stage 2実装（Claude Haiku置き換え）、取引先特化度スコア実装、E2Eテスト

### Key decisions
- **Gemini 2段階アプローチ採用**: Stage 1でOCR+分類+科目提案、Stage 2でルールベース検証+条件付きAI（設計確定、Phase 1実装済）
- **証憑プレビュー**: Slack添付をDriveに保存してiframeプレビュー（saveEvidenceToDrive新設）
- **摘要ルール**: `{年月} {PR番号} {品名} {PO番号/予算番号}`、品名は証憑品名優先
- **仕訳日**: 検収日→申請日→今日（変更なし、証憑発行日は使わない）
- **摘要×科目統計**: 追加したが優先度低め。品目カテゴリ統計が本命（Phase 2で実装予定）
- **RAG統計改善方針**: 取引先特化度スコア・品目カテゴリ統計・金額帯統計を新設予定（Phase 2）

### Done
- [x] OCR読取項目: 証憑発行日・証憑品名・DriveファイルIDをメインシートに書き戻し+webApi応答追加
- [x] Gemini OCRプロンプト拡張: itemCategory/itemNature/suggestedAccounts/hasMultipleTaxRates/taxRateBreakdown追加
- [x] GASシート新列: 品目カテゴリ・品目性質・AI科目提案を追加+書き戻し
- [x] 証憑プレビュー: saveEvidenceToDrive関数（Drive保存+ドメイン内共有）
- [x] 摘要ルール: 証憑品名優先+PO番号/予算番号付記
- [x] 摘要×科目統計: extractItemFromRemark_+remarkAccounts統計+キャッシュ対応
- [x] Next.js UI: 比較パネルに発行日・品名・AI分類・AI推定候補を表示
- [x] AI推定API: voucherItemsパラメータ追加（証憑品名最優先）
- [x] GAS push + Vercel deploy 完了
- [x] 設計レポート: docs/research/2026-04-05-gemini-two-stage-account-estimation.md

### Pending
- [ ] computeJournalStats手動再実行（remarkAccounts生成に必要）
- [ ] Phase 2: RAG統計改善（取引先特化度スコア、品目カテゴリ統計、金額帯統計）
- [ ] Phase 3: Stage 2実装（ルールベース検証+条件付きGemini Text）→ Claude Haiku廃止
- [ ] E2Eテスト（実データで一連フロー確認）
- [ ] 既存データへの新列バックフィル（次回OCR実行時に自動）

### Next actions
1. GASエディタで`computeJournalStats`を手動実行 → remarkAccounts生成確認
2. 実データで証憑添付 → OCR実行 → 新フィールド（itemCategory/suggestedAccounts等）の出力確認
3. Phase 2: computeJournalStatsに取引先特化度スコア計算を追加
4. Phase 2: itemCategoryAccounts統計新設（Stage 1データが溜まってから）
5. Phase 3: Stage 2ルールベース検証+条件付きGemini Text実装
6. Phase 3: Claude Haiku廃止、A/Bテスト

### Affected files
**GAS（Procurement-Assistant）**:
- `src/gas/documentClassifier.js:548-580` — Geminiプロンプト拡張（+5項目）
- `src/gas/main.js:1188-1190` — ヘッダ定義（証憑発行日/証憑品名/DriveファイルID/品目カテゴリ/品目性質/AI科目提案）
- `src/gas/main.js:1758-1764` — HEADER_DESCRIPTIONS追加
- `src/gas/main.js:2317-2348` — saveEvidenceToDrive関数（新設）
- `src/gas/main.js:2483-2548` — OCR書き戻し（新列6つ追加）
- `src/gas/mfAccountingApi.js:515-538` — extractItemFromRemark_関数（新設）
- `src/gas/mfAccountingApi.js:543-666` — computeJournalStats（remarkAccounts追加+キャッシュ列変更）
- `src/gas/webApi.js:749-812` — recentRequestsレスポンス（新フィールド6つ追加）

**Next.js（next-procurement-poc）**:
- `src/app/admin/journals/page.tsx:124-140` — OcrData型（+6フィールド）
- `src/app/admin/journals/page.tsx:211-225` — フェッチマッピング
- `src/app/admin/journals/page.tsx:309-314` — 摘要生成（証憑品名優先）
- `src/app/admin/journals/page.tsx:354-395` — 比較パネル（発行日/品名/AI分類/AI推定候補）
- `src/app/api/purchase/estimate-account/route.ts:21-24` — voucherItemsパラメータ
- `src/lib/account-estimator.ts:153,178-244` — RemarkAccountStat型+buildContext品名マッチ
- `src/lib/gas-client.ts:543-556` — RemarkAccountStat/JournalStats型

### Repro / Commands
```bash
# GAS push
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push

# Next.js deploy
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx vercel --prod

# 仕訳統計再計算（GASエディタで実行）
# mfAccountingApi.js → computeJournalStats
```

### Risks / Unknowns
- Gemini OCRの新フィールド（suggestedAccounts等）の出力品質は実データで要検証
- suggestedAccountsのJSON形式がGeminiから安定して返るか要確認
- Driveファイルのドメイン内共有設定がiframeプレビューで動作するか要検証
- 摘要パース（extractItemFromRemark_）のカバレッジ — 形式が合わない摘要はスキップされる

### Links
- 本番: https://next-procurement-poc-tau.vercel.app/admin/journals
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- 設計レポート: docs/research/2026-04-05-gemini-two-stage-account-estimation.md

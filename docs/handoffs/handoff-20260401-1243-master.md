# [Handoff] "出張手配サービス検討・仕訳管理UI・MF取引先連携・一部返品対応" — 2026-04-01 12:43 (branch: master)

### Goal / Scope
- システム全体精査 → Tier 1-4 の改善実施（セキュリティ・整合性・UX・新機能）
- 仕訳管理UI（/admin/journals）新規作成 — 証憑プレビュー・仕訳編集・一括登録
- MF会計Plus API仕様準拠（致命的バグ3件修正）+ 取引先マスタ連携（請求書払い）
- 一部返品対応（数量指定モーダル・按分取消仕訳）
- 出張手配サービス比較検討（JCS vs Racco）→ 案4推奨の資料作成中（中断）
- やらないこと: MF認証の実施、手動設定14項目、E2Eテスト

### Key decisions
- **仕訳日は検収日ベース**（申請日ではない）— 摘要も「YYYY/MM PO番号 購入先」
- **請求書払いにcounterparty_code必須** — 買掛金の消込に取引先コードが必要
- **カード払いはcounterparty不要** — 補助科目(MFカード:未請求)で消込
- **出張手配は案4推奨**: JCS（宿泊）+ ANA Biz/JAL直（航空券）— API将来性・変更容易性
- **Slackショートカット日本語対応・管理本部カード代行購入** — 将来実装としてメモ
- **DB移行不要** — 月50件ならスプレッドシート(GAS)で十分

### Done
- [x] Tier 1: セキュリティ（認証バイパス防止・サニタイズ・数値検証）
- [x] Tier 2: データ整合性（GAS更新検証・仕訳冪等性・カード警告・OAuth通知）
- [x] Tier 3: UX改善（エラー表示・証憑リトライ・入力ヒント・下書き期限）
- [x] Tier 4: 新機能（遅延一括フォロー・モバイルモーダル・mystatusエラー）
- [x] 仕訳管理UI（/admin/journals）— 編集・証憑プレビュー・AI推定バッジ・一括登録
- [x] MF API仕様準拠（journalラッパー・start_date/end_date・マスタレスポンスキー）
- [x] MF取引先マスタ連携（請求書払い時のcounterparty_code自動セット）
- [x] 一部返品（数量指定モーダル・按分取消仕訳・ステータス「一部返品」）
- [x] 申請画面に未処理タスクサマリ表示
- [x] 検収手順の詳細化（品目・数量・外観チェックリスト）
- [x] マニュアルv1.1・運用ガイド・設計書の同期更新
- [x] 出張手配サービス比較メモ（docs/travel-services/comparison.md）

### Pending
- [ ] 出張手配サービス推奨案（案4）の資料作成 ← **次のアクション**
- [ ] MF会計Plus OAuth初回認証（/api/mf/auth）
- [ ] 手動設定14項目（従業員マスタ、clasp push、GCP認証等）
- [ ] E2Eテスト（test-plan.md Phase 6）
- [ ] Vercel GitHub連携

### Next actions
1. 出張手配サービス推奨案4の資料作成（JCS+ANA Biz/JAL直の提案書）
2. JCS予約照会APIのNDA締結検討 → 詳細仕様取得
3. MF会計Plus OAuth初回認証の実施
4. 仕訳管理UIの本番UIにも証憑プレビュー大型化・データソース区分を反映
5. 手動設定14項目の実施 → clasp push → Vercelデプロイ
6. E2Eテスト実施（test-plan.md Phase 6）

### Affected files
- `src/lib/mf-accounting.ts` — 取引先マスタ連携、API仕様修正（journalラッパー等）
- `src/lib/slack.ts` — safeUpdateStatus、一部返品モーダル(handleReturn/handleReturnSubmit)
- `src/app/admin/journals/page.tsx` — 仕訳管理UI（編集・証憑プレビュー）
- `src/app/mock/journals/page.tsx` — 仕訳管理モック（データソース区分・大型証憑プレビュー）
- `src/app/api/mf/counterparties/route.ts` — 取引先マスタ検索API（新規）
- `src/app/api/mf/journal/route.ts` — 検収日ベース・両認証対応
- `src/app/purchase/new/page.tsx` — 未処理タスクサマリ・MF取引先サジェスト
- `docs/travel-services/comparison.md` — 出張手配サービス比較検討メモ
- `docs/user-manual.md` — v1.1（検収詳細化・仕訳管理UI・返品手順更新）

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run build && npm run dev  # localhost:3333
vercel --prod --scope futurestandard  # 本番デプロイ
# 本番URL
https://next-procurement-poc-tau.vercel.app
https://next-procurement-poc-tau.vercel.app/admin/journals
https://next-procurement-poc-tau.vercel.app/mock/journals
```

### Risks / Unknowns
- MF会計Plus認証未実施 — API連携は全てコード準備済みだが実動作未確認
- 楽天RaccoのAPI連携可否 — 回答待ち
- JCS予約照会APIの詳細仕様 — NDA締結後に取得可能
- Vercelの月額$340が高い — 不要アドオン(Speed Insights等)の整理を推奨

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- Vercel: https://vercel.com/futurestandard/next-procurement-poc
- 出張手配資料: docs/travel-services/
- 比較検討メモ: docs/travel-services/comparison.md

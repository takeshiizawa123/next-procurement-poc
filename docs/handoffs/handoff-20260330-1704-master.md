# [Handoff] "セキュリティ強化・整合性検証・税区分修正・Vercel法人移行・Slack動作確認" — 2026-03-30 17:04 (branch: master)

### Goal / Scope
- セキュリティ監査（OWASP Top 10）→ P0/P1/P2の全項目対応
- 設計書・マニュアル vs 実装の整合性検証 → 抜け漏れ修正
- 消費税区分を科目マスタCSV（FS税区分）に準拠 → 課仕/共-課仕の正しい使い分け
- Vercel法人チーム（futurestandard）への移行 → デプロイ・動作確認
- やらないこと: E2Eテスト、手動設定14項目（clasp push等）

### Key decisions
- **全販管費 → 共-課仕 10%**: 科目マスタCSVのFS税区分に準拠。5億未満全額控除で実質影響なし
- **研究開発費 → 課仕 10%**: 税理士コメント「課税売上に対応する支出」に基づく
- **地代家賃 → 共-課仕 10%**: 事務所賃貸は課税取引（非課税から修正）
- **OCR税率 → 仕訳反映**: 8%軽減税率検出時に共-課仕 8%に自動切替
- **/purchaseコマンド → モーダル表示**: プライベートチャンネルでephemeral失敗を回避

### Done
- [x] セキュリティ: API認証(14ルート)、タイムアウト(17箇所)、GASリトライ、OAuth CSRF防止
- [x] Slack障害時データ保全（purchase/submit）
- [x] カード照合: 差額調整仕訳自動作成（execute + confirm API）
- [x] 出張予測レコード生成（交通費・宿泊費を別行）
- [x] 返品取消仕訳の自動ドラフト作成
- [x] 部分検収機能（モーダル入力、進捗表示、全数到達で自動完了）
- [x] 二段階承認コード整理（ApprovalRouteインターフェース簡素化）
- [x] 差戻しDMに再申請リンク、重複チェック確認必須化、ファイル10MB制限
- [x] 消費税区分を科目マスタCSV準拠（共-課仕/課仕の使い分け）
- [x] OCR読取の税率を仕訳に反映（8%軽減対応）
- [x] マニュアル・運用ガイド・設計書への全反映
- [x] Vercel法人チーム移行 + 環境変数設定 + デプロイ成功
- [x] Slack /purchase, /trip コマンド動作確認

### Pending
- [ ] 手動設定14項目（従業員マスタ列追加、clasp push、GCP認証等）
- [ ] E2Eテスト（test-plan.md Phase 6）
- [ ] SLACK_DEFAULT_APPROVER / SLACK_ADMIN_MEMBERS の設定
- [ ] GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_DRIVE_ROOT_FOLDER_ID の設定
- [ ] SLACK_SIGNING_SECRET の本番値確認（現在は設定済みだがテスト中）
- [ ] GitHub連携（Vercel futurestandard → GitHub repo自動デプロイ）
- [ ] エイリアス辞書管理UI（C5、運用データが溜まってから）

### Next actions
1. 従業員マスタにcard_last4/card_holder_name列を追加 → GAS clasp push
2. GCPサービスアカウント設定 → GOOGLE_SERVICE_ACCOUNT_KEY / DRIVE_ROOT_FOLDER_ID をVercelに追加
3. SLACK_DEFAULT_APPROVER / SLACK_ADMIN_MEMBERS をVercelに設定
4. Slack Appの全機能テスト（承認→発注→検収→証憑→仕訳の一連フロー）
5. Vercel GitHub連携設定（futurestandard team → repo接続）
6. E2Eテスト実施（test-plan.md Phase 6）

### Affected files
- `src/lib/api-auth.ts` — 新規: API認証ヘルパー
- `src/lib/api-client.ts` — 新規: クライアント側fetchラッパー
- `src/lib/mf-accounting.ts:363-397` — EXPENSE_ACCOUNT_MAP税区分修正、OCR税率対応
- `src/lib/slack.ts:278-340,398-453,852-915` — 部分検収、返品自動仕訳、/purchase モーダル化
- `src/lib/prediction.ts:113-210` — generateTripPredictions追加
- `src/lib/gas-client.ts:16-18,64-106` — リトライロジック追加
- `src/lib/approval-router.ts:6-15` — 二段階承認フィールド削除
- `src/app/api/admin/card-matching/confirm/route.ts` — 新規: 照合確定+調整仕訳API
- `src/app/api/slack/events/route.ts:232-244,405-480,950-1072` — 部分検収モーダル、出張予測、OCR税率
- `docs/user-manual.md` — v0.5: 部分検収、返品自動仕訳、差戻しリンク等
- `docs/operational-guide.md` — セキュリティ対策、環境変数追加、ステータス遷移更新
- `docs/design-mf-integration-final.md` — §13.5消費税区分方針更新

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
# 本番
https://next-procurement-poc-tau.vercel.app
https://next-procurement-poc-tau.vercel.app/purchase/new
https://next-procurement-poc-tau.vercel.app/admin/card-matching
https://next-procurement-poc-tau.vercel.app/admin/spending
# Vercelデプロイ
vercel --prod --scope futurestandard
```

### Risks / Unknowns
- Vercel GitHub連携が未設定（手動デプロイは可能）
- Google Drive連携が未設定（証憑のDrive保存が動作しない）
- 従業員マスタのカード情報列が未設定（カード予測テーブルが機能しない）
- MF会計Plusの税マスタに「共-課仕 10%」「共-課仕 8%」が存在するか未確認
- Slack Botの全機能テストは未実施（/purchase の起動のみ確認）

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- Vercelダッシュボード: https://vercel.com/futurestandard/next-procurement-poc
- docs/design-mf-integration-final.md（統合設計書）
- docs/user-manual.md / docs/operational-guide.md
- docs/test-plan.md

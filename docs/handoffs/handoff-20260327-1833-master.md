# [Handoff] "カード明細照合システム実装完了" — 2026-03-27 18:33 (branch: master)

### Goal / Scope
- カード明細照合の全バックエンド実装（マッチングエンジン+API+予測テーブル+GAS連携）
- 照合UIの全5タブをモックデータ→実API接続に切替
- やらないこと: 手動設定（GCP認証、MF補助科目、従業員マスタ列追加等）、Vercelデプロイ

### Key decisions
- **2フェーズマッチング採用**: Phase1=予測マッチ（card_last4×金額×日付）、Phase2=スコアリング（金額50+日付30+加盟店名20）
- **予測テーブルはGASシート**: 月間50件以下の規模にはGASで十分。シート名「予測カード明細」で自動作成
- **承認時に予測自動生成**: handleApprove内でカード払い判定→従業員カード解決→GAS書込
- **引落照合はMF会計Plus仕訳集計**: 未払金(請求)の貸方仕訳をカード別に集計してCSV引落額と突合

### Done
- [x] `card-matcher.ts` — 2フェーズマッチングエンジン（mf-card-reconciler TS移植）
- [x] `POST /api/admin/card-matching/execute` — 照合実行API
- [x] `POST /api/admin/card-matching/withdrawal` — 引落照合API（未払金集計）
- [x] `mf-accounting.ts` — `getJournals()` 追加（entered_by=noneフィルタ対応）
- [x] `gas-client.ts` — 予測テーブルCRUD + 従業員カード情報取得
- [x] `prediction.ts` — 承認時の予測明細自動生成ロジック
- [x] `slack.ts` — handleApproveにカード払い→予測生成フック追加
- [x] `page.tsx` — 全5タブのモックデータ→API接続切替（ローディング/エラー表示付き）
- [x] GAS `webApi.js` — createPrediction/getPredictions/updatePrediction/employeeCardsアクション追加

### Pending
- [ ] 従業員マスタにG列(card_last4)・H列(card_holder_name)追加 + データ入力
- [ ] `clasp push` でGASデプロイ
- [ ] GCPサービスアカウント作成 + Google Driveフォルダ設定
- [ ] MF会計Plus補助科目作成（MFカード:未請求/請求）
- [ ] 環境変数設定 + Vercelデプロイ + 内部テスト
- [ ] M1問題（upload_receiptトークン所有者）対策確定
- [ ] 運用マニュアル・テスト計画の更新（照合機能追加分）

### Next actions
1. **運用マニュアル更新**: operational-guide.mdにカード明細照合の月次運用手順を追記
2. **テスト計画更新**: test-plan.mdに照合機能のテストシナリオ追加
3. **従業員マスタ列追加**: GASスプレッドシートにG列H列を追加、カード情報入力
4. **clasp push**: GAS変更をデプロイ
5. **環境変数設定**: Google/MF関連の環境変数をVercelに設定
6. **E2Eテスト**: テスト購買申請→承認→予測生成→CSV照合の一連フロー確認

### Affected files
- `src/lib/card-matcher.ts` — 新規（マッチングエンジン全体）
- `src/lib/prediction.ts` — 新規（予測明細生成）
- `src/lib/mf-accounting.ts:209-243` — getJournals(), JournalListItem型追加
- `src/lib/gas-client.ts:283-348` — 予測テーブルCRUD, EmployeeCard型
- `src/lib/slack.ts:1-3,110-121` — import追加, 予測生成フック
- `src/app/admin/card-matching/page.tsx` — 全面改修（モック→API）
- `src/app/api/admin/card-matching/execute/route.ts` — 新規
- `src/app/api/admin/card-matching/withdrawal/route.ts` — 新規
- `Procurement-Assistant/src/gas/webApi.js:89-119,175-181,889-1088` — GAS側予測テーブル+employeeCards

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
# 照合UI: http://localhost:3333/admin/card-matching
npx tsc --noEmit  # 型チェック
npm run build     # ビルド確認
```

### Risks / Unknowns
- GAS側の`employeeCards`は従業員マスタのG/H列を前提。列がなければ空文字で返る
- MF会計Plus APIの`/journals`レスポンス形式は実環境で要検証
- 予測IDの一意性はタイムスタンプ下4桁ベース。高頻度同時承認では衝突リスクあり
- ファジーマッチはbigram overlapの簡易実装。rapidfuzzほどの精度はない

### Links
- 統合設計書: `docs/design-mf-integration-final.md`
- 照合UI: `src/app/admin/card-matching/page.tsx`
- GASプロジェクト: `C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas/`

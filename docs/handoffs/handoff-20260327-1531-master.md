## [Handoff] "MF連携実装・カード明細照合UI完成" — 2026-03-27 15:31 (branch: master)

### Goal / Scope
- 前回引き継ぎのNext actions 6件を全て完了 + カード明細照合UIの設計・実装
- やらないこと: Vercelデプロイ、実データでのE2Eテスト

### Key decisions
- **予測テーブル方式B採用**: card_last4×金額×日付で高精度照合。スコアリングはフォールバック
- **H3問題解決**: MFビジネスカード→MF経費の明細連携は手動選択方式。連携停止不要、運用ルール周知で対応
- **UI設計**: タブ式（5タブ）+ プログレスバー + 差異のみ赤字強調 + 自然言語タグ
- **CSV入力起点**: 利用明細CSV/入出金履歴CSVをドロップ→自動判定→照合実行
- **引落照合追加**: mf-card-reconcilerのロジックを参考に、請求明細CSV貼付→未払金合計と突合

### Done
- [x] design-mf-integration-final.md に方式B（予測テーブル）設計追記（§4.1-4.3）
- [x] マッチング結果確認UI設計・実装（§7, /admin/card-matching）
- [x] H3問題調査→結論（§14に追記）
- [x] mf-accounting.ts 貸方科目修正（resolveCreditAccount + resolveSubAccountCode）
- [x] Google Drive API連携（src/lib/google-drive.ts 新規作成）
- [x] events/route.ts 分岐ロジック（立替→MF経費 / カード・請求書→Drive+API仕訳）
- [x] 照合UI v5: タブ式+差異強調+自然言語タグ+完了バナー
- [x] 引落照合タブ: CSV貼付→未払金突合+差額原因ガイド
- [x] CSVパーサー: MFビジネスカード利用明細/入出金履歴の自動判定対応

### Pending
- [ ] マッチングエンジンのバックエンドAPI実装（mf-card-reconcilerの3フェーズをTSに移植）
- [ ] 予測テーブル（predicted_card_transactions）のGASシート or SQLite実装
- [ ] 照合UIとバックエンドAPIの接続（モックデータ→実データ）
- [ ] upload_receiptのトークン所有者問題の対策確定（M1問題）
- [ ] 環境変数設定 + Vercelデプロイ + 内部テスト

### Next actions
1. **マッチングAPI実装**: POST /api/admin/card-matching/execute — CSVパース+GAS購買台帳取得+3フェーズマッチング
2. **予測テーブル構築**: GASシートにpredicted_card_transactions追加、/purchase申請時に予測明細を自動生成
3. **照合UIのAPI接続**: モックデータをfetch()に置換、照合実行ボタンでAPIコール
4. **手動作業リスト実施**: CURRENT_WORK.md「手動作業リスト」の14項目（GCP認証、MF会計Plus補助科目、従業員マスタ等）
5. **mf-card-reconcilerのTS移植**: matcher.pyの3フェーズ（金額一致→ファジー→N:1）をTypeScript化

### Affected files
- `docs/design-mf-integration-final.md` — §4.1-4.8（予測テーブル）、§7（UI設計）、§11（実装スコープ更新）、§14（H3問題）
- `src/lib/mf-accounting.ts:120-195` — resolveSubAccountCode, resolveCreditAccount 追加
- `src/lib/google-drive.ts` — 新規（サービスアカウント認証+フォルダ管理+アップロード）
- `src/app/api/slack/events/route.ts:777-870` — 支払方法分岐（立替→MF経費 / その他→Drive+API仕訳）
- `src/app/admin/card-matching/page.tsx` — 新規（照合UI 5タブ+CSVパーサー）
- `package.json` — googleapis追加

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
# 照合UI: http://localhost:3333/admin/card-matching
npx tsc --noEmit  # 型チェック
```

### Risks / Unknowns
- CSVパーサーのダブルクォート内カンマ対応は簡易実装。"GITHUB, INC."等は対応済みだが複雑なケースは未検証
- mf-card-reconcilerのファジーマッチング（rapidfuzz）のTS版ライブラリ選定が必要
- 予測テーブルをGASシートにするかSQLiteにするかは規模次第（月間50件以下ならGASで十分）
- entered_by=noneフィルタにカード以外（銀行引落等）も含まれる→debit_sub_account_idで追加フィルタ必要

### Links
- 統合設計書: `docs/design-mf-integration-final.md`
- mf-card-reconciler: `C:/Users/takeshi.izawa/.claude/projects/mf-card-reconciler/`
- 照合UI: `src/app/admin/card-matching/page.tsx`

## [Handoff] "MF連携統合設計確定・マッチング方式B設計" — 2026-03-27 12:00 (branch: master)

### Goal / Scope
- MF連携の統合設計を確定（ハイブリッド案: 案G+案C）
- カード明細マッチングの方式B（予測テーブル）を設計
- やらないこと: MFクラウド債務支払（未契約）、実装着手

### Key decisions
- **ハイブリッド方式確定**: 会社カード/請求書→案G（Drive+API仕訳）、従業員立替→案C（MF経費精算）
- **MF経費の役割を限定**: 従業員立替精算のみ。購買・出張はMF経費を経由しない
- **出張旅費もMF経費から購買システムに一本化**: /trip経由で管理、MF経費での出張申請を廃止
- **カード明細=Stage 2仕訳として活用**: 自動仕訳ルールで未払金(未請求)/未払金(請求)を自動登録→API取得→マッチング
- **自動仕訳ルールはカード番号別に設定可能**: MF会計Plus実データで確認済み（HIROSHI OKA *3815）
- **仕訳は「申請前仕訳」として登録される**: GET /journalsで取得可能（確認済み）
- **マッチング方式B（予測テーブル）採用**: カード番号×金額×日付で高精度照合。未マッチ=未申請アラート
- **管理本部カードを2枚に分離**: カードA（購買用）とカードB（サブスク用）
- **MF会計Plus証憑添付APIは存在しない**: OpenAPI仕様で確認済み。証憑はDrive管理
- **電帳法**: Google Drive + Vault（7年保持）+ ファイル命名規則で対応

### Done
- [x] MF経費API/MF会計PlusAPI/クラウドBox/債務支払/インボイスの網羅的調査
- [x] 案C vs 案G 運用シナリオ詳細比較（`design-voucher-integration-c-vs-g.md`）
- [x] 支払方法別仕訳設計（`design-journal-entry-by-payment.md`）
- [x] カード明細マッチング設計（`design-card-statement-matching.md`）
- [x] MF連携統合設計書（決定版）（`design-mf-integration-final.md`）
- [x] 運用問題22件の洗い出しと重大度分類
- [x] C1（カード番号分岐）C2（仕訳登録状態）の実環境検証 → 問題なし

### Pending
- [ ] 方式B（予測テーブル）の詳細設計をdesign-mf-integration-final.mdに反映
- [ ] マッチング結果確認UI（経理向け管理画面）の設計
- [ ] MFビジネスカード→MF経費の連携停止可否の確認（H3問題）
- [ ] upload_receiptのトークン所有者問題の対策確定（M1問題）
- [ ] 会計照合モデルの最終確定（3ステージモデルは方針OK、実装詳細未着手）
- [ ] mf-accounting.tsの貸方科目ロジック修正（補助科目対応）
- [ ] Google Drive API連携の実装
- [ ] 環境変数設定 + Vercelデプロイ + 内部テスト

### Next actions
1. **design-mf-integration-final.mdに方式Bの予測テーブル設計を追記**: 従業員マスタ拡張（カード下4桁）、予測テーブルスキーマ、出張の予測明細生成ロジック
2. **マッチング結果確認UIの画面設計**: 一発マッチ/複数候補/未マッチの3区分表示、経理の承認・修正フロー
3. **MFビジネスカード→MF経費の連携停止可否を確認**: 停止可能なら設定変更、不可なら従業員への運用ルール周知
4. **mf-accounting.ts修正**: resolveCreditAccount関数の実装（カード→未払金:未請求、請求書→買掛金、立替→案C経由）
5. **Google Drive API連携の実装**: サービスアカウント認証、uploadVoucherToDrive、フォルダ自動作成
6. **events/route.tsの分岐ロジック実装**: payment_method判定（立替→MF経費、その他→Drive+API）

### Affected files
- `docs/design-mf-integration-final.md` — 統合設計書（決定版）★最重要
- `docs/design-card-statement-matching.md` — カード明細マッチング設計
- `docs/design-journal-entry-by-payment.md` — 支払方法別仕訳設計
- `docs/design-voucher-integration-c-vs-g.md` — 案C vs G比較（検討過程の記録）
- `src/lib/mf-accounting.ts:194-197` — 貸方科目ロジック（要修正: 補助科目対応）
- `src/lib/mf-expense.ts:85-114` — upload_receipt（立替分のみ使用に変更）
- `src/app/api/slack/events/route.ts:808-826` — 証憑処理フロー（分岐ロジック追加）
- `src/app/api/mf/journal/route.ts` — 仕訳登録API（Driveリンク埋込対応）

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run build
git log --oneline -5
# MF会計Plus OpenAPI仕様（別プロジェクト）
ls C:/Users/takeshi.izawa/.claude/projects/MF会計Plus連携個別原価計算システム/openapi*.yaml
```

### Risks / Unknowns
- MFビジネスカード→MF経費の自動連携を停止できるか未確認（従業員の重複申請リスク）
- upload_receiptのAPIトークン所有者問題（立替者と名義不一致）→備考記載で回避予定だが要検証
- Stage 2がStage 1より先に登録される→月次消込で問題ないと判断済みだが、日次残高は一時的に異常
- entered_by=noneフィルタにカード以外（銀行引落等）も含まれる→debit_sub_account_idで追加フィルタ必要
- 出張の証憑添付が遅れがち→未提出自動リマインドで対応予定
- MF会計Plus APIにPUT /journals（仕訳更新）が存在しない→差額調整は追加仕訳で対応

### Links
- 統合設計書: `docs/design-mf-integration-final.md`
- MF会計Plus OpenAPI: `C:/Users/takeshi.izawa/.claude/projects/MF会計Plus連携個別原価計算システム/openapi_journals.yaml`
- MF経費API: https://expense.moneyforward.com/api/index.html
- MF債務支払API: https://payable.moneyforward.com/api/index.html（参考・未契約）

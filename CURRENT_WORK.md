# CURRENT_WORK

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

---

## [Handoff] "MF連携調査・会計照合設計" — 2026-03-26 23:04 (branch: master)

### Goal / Scope
- Sprint 0-5全機能実装 + 品質修正7件 + UX改善5件を完了
- MF会計Plus/MF経費/MFビジネスカードの連携モデル設計を調査中
- やらないこと: MFビジネスカードAPI（非公開のため不可）

### Key decisions
- Sprint 0-5: 全完了（17コミット）
- 品質修正7件 + UX改善5件: 全完了
- MF連携: 案B（購買はMF経費バイパス→MF会計Plus直接）を検討中だが確定前
- 会計照合: 3ステージ未払金管理モデル（未請求債務/請求債務）を検討中だが確定前
- MF経費API: 申請作成不可、証憑アップロード可
- MFビジネスカードAPI: 非公開
- クラウドBox: 証憑→AI-OCR→仕訳候補の自動生成機能あり（新発見・要検討）

### Done
- [x] Sprint 0-5全機能、品質修正7件、UX改善5件
- [x] 運用ガイド + 利用者マニュアル（MD + PPT）
- [x] MF経費API/MF会計Plus連携/クラウドBox調査
- [x] 会計照合設計書v2、MF連携4案比較書

### Pending
- [ ] MF連携最終方針の決定（クラウドBox活用含む）
- [ ] 会計照合モデルの確定
- [ ] 環境変数設定 + デプロイ + 内部テスト

### Next actions
1. クラウドBox活用案の分析（案Bの代替/補完）
2. MF会計Plus API仕訳添付エンドポイント確認
3. 4つの金額照合フロー確定（会計担当と確認）
4. MF連携最終方針決定 → 環境変数設定 → デプロイ → テスト

### Affected files
- `docs/design-mf-integration-options.md` — MF連携4案比較
- `docs/design-accounting-reconciliation.md` — 会計照合3ステージモデル
- `docs/design-plan-b-mf-direct.md` — 案B詳細設計
- 全src/lib/*.ts, src/app/api/**/*.ts — 実装済み

### Links
- MF経費API: https://expense.moneyforward.com/api/index.html
- クラウドBox仕訳候補: https://biz.moneyforward.com/support/account/news/new-feature/20241008.html

---

## [Handoff] "購買管理Phase1 - Wave2完了・GAS連携調査前" — 2026-03-22 02:20 (branch: master)

### Goal / Scope
- Phase 1: 購買申請Bot + 証憑ブロック + Webフォームの実装
- やらないこと: Phase 2（Webダッシュボード）、Phase 3（MF会計連携）

### Key decisions
- フォーム方針: Slackモーダル(A) + Webフォーム(B)を並行提供（/purchase で2択表示）
- 権限: 厳密（承認者のみ承認可、申請者のみ取消可、検収者のみ検収可）
- actionValue統一形式: `poNumber|applicantSlackId|approverSlackId|inspectorSlackId`
- 承認者DM: チャンネルメッセージとDM両方から承認/差戻し可能
- 購入済フロー: 承認・発注スキップ→即「検収済・証憑待ち」
- Webフォーム独自機能: 条件分岐、ファイルアップロード、下書き保存、確認画面、URL自動解析
- 改善ロードマップ: 本線Sprint + Wave方式で25機能を計画済み

### Done
- [x] Sprint 0: POC完了
- [x] Sprint 1-1: /purchase モーダル（デプロイ・動作確認済み）
- [x] 権限チェック実装（全ボタン: 承認/差戻し/発注/検収/取消）
- [x] 承認者DM通知（DMから承認/差戻し→チャンネル反映）
- [x] 差戻し時の申請者DM通知
- [x] メッセージ情報引き継ぎ（ハードコード→実データ表示）
- [x] Webフォーム実装（条件分岐、ファイルアップロード、2択選択）
- [x] Wave 0: 金額カンマフォーマット、下書き保存、確認画面、モバイル最適化、カメラ撮影
- [x] Sprint 1-2: 購入済フロー（発注スキップ）+ #purchase-ops通知
- [x] Wave 2: 商品URL自動解析（Amazon/モノタロウ/ASKUL/ヨドバシ/ビックカメラ）
- [x] 改善ロードマップ作成（11_Webフォーム改善ロードマップ.md）
- [x] API連携調査（HubSpot Deals, KATANA MRP）

### Pending
- [ ] Sprint 1-3: GAS側 doPost 拡張（購買申請の登録・更新受付）
- [ ] Sprint 1-4: Next.js → GAS 疎通
- [ ] Sprint 1-5: モーダル/Webフォーム → GAS登録 → Slack投稿の一連フロー
- [ ] Sprint 1-6: 従業員マスタ連携
- [ ] Wave 1: 購入先名サジェスト、重複チェック、過去申請複製（GAS連携後）
- [ ] Wave 2残: HubSpot案件サジェスト（トークン取得待ち）
- [ ] Wave 3: 承認ルートプレビュー、勘定科目推定、ステップ分割（マスタ後）
- [ ] origin への push（9コミット先行中）
- [ ] viewport修正コミット済み（モバイル見切れ対応）

### Next actions
1. 既存GASコード調査（Procurement-Assistant/src/gas/）
   - main.js の doPost 構造を把握
   - slackApi.js の現在の処理を確認
   - スプレッドシート書き込み処理の構造を理解
2. Sprint 1-3: GAS側に doPost エンドポイント追加（購買申請CRUD）
3. Sprint 1-4: Next.js API Route → GAS Web App の疎通
4. Sprint 1-5: 申請→GAS登録→ステータス更新の一連フロー
5. HubSpot Private App Token を取得（Wave 2残）
6. origin に push + Vercel デプロイ

### Affected files（next-procurement-poc）
- `src/lib/slack.ts` — 全アクションハンドラー、権限チェック、DM承認、ops通知、購入済ブロック
- `src/app/api/slack/events/route.ts` — /purchase コマンド、購入済分岐、ops通知
- `src/app/api/purchase/submit/route.ts` — Webフォーム送信API、購入済分岐
- `src/app/purchase/new/page.tsx` — Webフォーム（条件分岐、D&D、下書き、確認画面、URL解析）
- `src/app/api/util/ogp/route.ts` — 商品URL OGP解析API

### Affected files（設計ドキュメント - 購買管理フロー見直し/）
- `11_Webフォーム改善ロードマップ.md` — 25機能のロードマップ
- `docs/research/2026-03-21-api-integration-plan.md` — HubSpot/KATANA API調査
- `docs/research/2026-03-21-web-form-possibilities.md` — Webフォームアイデア集

### GAS連携の事前調査メモ
- 既存GASプロジェクト: `C:\Users\takeshi.izawa\.claude\projects\Procurement-Assistant\src\gas\`
- 18ファイル構成（main.js 257KB が最大）
- clasp push でデプロイ
- scriptId: `1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze`
- 主要ファイル: main.js, slackApi.js, parser.js, mfJournalGenerator.js, documentClassifier.js
- OAuth2ライブラリ使用、タイムゾーン: Asia/Tokyo

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run build
npx vercel --prod --yes
curl -s https://next-procurement-poc.vercel.app/api/test/health
```

### Risks / Unknowns
- 既存GASの main.js が 257KB と巨大 — 慎重に調査が必要
- Amazonサーバーサイドfetchがブロックされる — OGP解析はモノタロウ等では動作確認済み
- HubSpot Private App Token 未取得
- 証憑ファイルの保存先未決定（Drive / Blob / Supabase）
- origin に8コミット先行、未push

### Links
- GitHub: https://github.com/takeshiizawa123/next-procurement-poc
- Vercel: https://next-procurement-poc.vercel.app
- 設計ドキュメント: C:\Users\takeshi.izawa\.claude\projects\購買管理フロー見直し\
- GASプロジェクト: C:\Users\takeshi.izawa\.claude\projects\Procurement-Assistant\src\gas\

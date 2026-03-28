# CURRENT_WORK

## [Handoff] "経理処理精査・入力項目整備完了" — 2026-03-28 23:28 (branch: master)

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
- [x] 用語集拡充（4→12項目）、PPTXフォント拡大

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
# 管理画面
http://localhost:3333/admin/spending
http://localhost:3333/admin/card-matching?demo=1
# PPTX再生成
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

---

## [Handoff] "マニュアル整備完了・統制強化実装前" — 2026-03-28 16:24 (branch: master)

### Goal / Scope
- マニュアル・PPTX全面改訂（ロール別構成、スクショ埋込、二段階承認廃止の反映）
- 運用フロー変更: 二段階承認廃止、全件申請者発注、管理本部は経理専任
- やらないこと: 統制強化実装（次セッション）

### Key decisions
- **二段階承認を廃止**: 部門長承認のみに統一。管理本部の承認ステップを削除
- **全件申請者発注**: カード・請求書問わず申請者が発注。請求書は証憑として提出
- **管理本部は経理専任**: 仕訳・照合・支払処理に特化。発注代行を廃止
- **証憑提出は2経路**: Slackスレッド + マイページ（/purchase/my）を全パターンで明記
- **購買パターンを3つに整理**: A:カード、B:請求書、C:立替（旧4パターンから統合）
- **PPTX構成をロール別に再編**: Part A申請者 / Part B承認者 / Part C管理本部 + スクショ7枚埋込
- **統制強化2件を承認**: ①日次金額乖離アラート ②従業員別利用傾向ダッシュボード

### Done
- [x] マニュアルPPTX: ロール別構成（49スライド）、スクショ7枚埋込、出張詳細フロー、マイページ・ブックマークレット詳細化
- [x] user-manual.md: 全体フロー図、証憑2方法、立替+MF経費関係、承認後操作、FAQ、トラブルシューティング更新
- [x] operational-guide.md: 購買パターン3つ、承認ルール、統制設計、MF連携マップ、定期タスク、遷移図を全面更新
- [x] 運用ガイドPPTX: 照合セクション追加、パターン・承認・権限マトリクス・遷移図を修正
- [x] コード変更: 二段階承認廃止（approval-router.ts, slack.ts handleApprove/handleOrderComplete）
- [x] スクリーンショット14枚撮影、docs/images/に保存
- [x] 照合UIにデモモード追加（?demo=1）
- [x] /trip モーダルにレンタカー/タイムズカー追加
- [x] 購入先を必須に（マニュアル表記修正、コードは既に必須）

### Pending
- [ ] **日次金額乖離アラート**: 予測テーブル vs MF仕訳を日次バッチで突合→乖離時にSlack即通知
- [ ] **従業員別利用傾向ダッシュボード**: /admin/spending — 月別推移、逸脱検知、ランキング
- [ ] 手動設定14項目（従業員マスタ列追加、clasp push、GCP認証、MF補助科目等）
- [ ] Vercelデプロイ + E2Eテスト

### Next actions
1. **日次乖離アラートバッチ実装**: POST /api/cron/daily-variance — 予測テーブル×MF仕訳突合→差異Slack通知
2. **従業員別利用傾向ダッシュボード**: /admin/spending — GAS購買台帳集計→月別推移チャート+逸脱アラート
3. **統制方針をドキュメントに追記**: operational-guide.md §5統制設計に日次アラート+サンプリング監査を追加
4. **手動設定の実施**: 従業員マスタ列追加→clasp push→環境変数→Vercelデプロイ
5. **E2Eテスト**: test-plan.md Phase 6に沿って照合機能を検証

### Affected files
- `src/lib/slack.ts:73-140` — handleApprove: 二段階承認廃止、全件申請者DM通知
- `src/lib/slack.ts:204-250` — handleOrderComplete: 管理本部限定チェック廃止
- `src/lib/approval-router.ts:66-67` — requiresSecondApproval=false固定
- `src/app/api/slack/events/route.ts:345` — /trip placeholderにレンタカー追加
- `src/app/admin/card-matching/page.tsx` — デモモード追加
- `docs/user-manual.md` — 全章修正
- `docs/operational-guide.md` — §2,3,5,6,9,10修正
- `docs/scripts/generate_manual_ppt.py` — ロール別構成+スクショ埋込
- `docs/scripts/generate_ppt.py` — パターン・承認・遷移図修正
- `docs/images/*.png` — 14枚

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
# 照合UIデモ: http://localhost:3333/admin/card-matching?demo=1
python docs/scripts/generate_manual_ppt.py  # PPTX再生成
python docs/scripts/generate_ppt.py
```

### Risks / Unknowns
- 日次乖離アラートはMF会計Plus APIのポーリング頻度に依存（APIレート制限未確認）
- 従業員別ダッシュボードのデータソースはGAS購買台帳。月間データ量が増えると取得速度に影響
- Webフォーム（/purchase/new）のスクショはGAS未接続でローディング中のため未撮影

### Links
- 統合設計書: `docs/design-mf-integration-final.md`
- ユーザーマニュアル: `docs/user-manual.md` / `docs/user-manual.pptx`
- 運用ガイド: `docs/operational-guide.md` / `docs/operational-guide.pptx`
- テスト計画: `docs/test-plan.md`

---

## [Handoff] "カード明細照合システム実装完了" — 2026-03-27 18:33 (branch: master)

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
# GASデプロイ（Procurement-Assistantディレクトリで）
# cd ../Procurement-Assistant && clasp push
```

### Risks / Unknowns
- GAS側の`employeeCards`は従業員マスタのG/H列を前提。列がなければ空文字で返る（エラーにはならない）
- MF会計Plus APIの`/journals`エンドポイントのレスポンス形式は実環境で要検証（OpenAPI仕様ベースで実装）
- 予測IDの一意性はタイムスタンプ下4桁ベース。高頻度の同時承認では衝突リスクあり（月間50件なら問題なし）
- ファジーマッチはbigram overlapの簡易実装。rapidfuzzほどの精度はない

### Links
- 統合設計書: `docs/design-mf-integration-final.md`
- 照合UI: `src/app/admin/card-matching/page.tsx`
- GASプロジェクト: `C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas/`
- mf-card-reconciler: `C:/Users/takeshi.izawa/.claude/projects/mf-card-reconciler/`

---

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

---

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
- [x] MFビジネスカード→MF経費の連携停止可否の確認（H3問題）→ 手動選択方式のため重複リスク低、運用ルール周知で対応
- [ ] upload_receiptのトークン所有者問題の対策確定（M1問題）
- [ ] 会計照合モデルの最終確定（3ステージモデルは方針OK、実装詳細未着手）
- [x] mf-accounting.tsの貸方科目ロジック修正（補助科目対応）→ resolveCreditAccount + resolveSubAccountCode実装済み
- [x] Google Drive API連携の実装 → src/lib/google-drive.ts（サービスアカウント認証+フォルダ管理+電帳法ファイル名+アップロード）
- [x] events/route.tsの分岐ロジック実装 → 支払方法で立替(MF経費) / カード・請求書(Drive+API仕訳)に分岐
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

### 手動作業リスト（izawaさんが実施する必要があるもの）

#### 環境変数・認証（Vercel + ローカル）
1. **Google サービスアカウント作成** → GCPコンソールでサービスアカウント作成 → JSON鍵をダウンロード → Base64エンコードして `GOOGLE_SERVICE_ACCOUNT_KEY` に設定
2. **Google Drive ルートフォルダ作成** → Google Driveに「購買証憑」フォルダ作成 → サービスアカウントに編集権限付与 → フォルダIDを `GOOGLE_DRIVE_ROOT_FOLDER_ID` に設定
3. **Vercel環境変数の追加** → `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` を追加

#### MF会計Plus 初期設定（管理画面で手動・1回のみ）
4. **補助科目作成** → MF会計Plus → 各種設定 → 補助科目 → 未払金に「MFカード:未請求」「MFカード:請求」を追加
5. **自動仕訳ルール設定（従業員カード）** → 全明細 → 借方:未払金(MFカード:未請求) / 貸方:未払金(MFカード:請求)
6. **自動仕訳ルール設定（管理本部カードA）** → 同上
7. **自動仕訳ルール設定（管理本部カードB）** → 加盟店名別に費用科目を設定
8. **自動仕訳ルール設定（銀行引落）** → 借方:未払金(MFカード:請求) / 貸方:普通預金

#### Google Workspace 設定
9. **Google Vault保持ルール** → 購買証憑フォルダに7年保持ルールを設定（電帳法対応）

#### GASスプレッドシート 拡張
10. **従業員マスタにカード情報追加** → 従業員シートに `card_last4`, `card_holder_name` 列を追加 → 各従業員のMFビジネスカード下4桁と券面名義を登録
11. **予測テーブルシート作成** → `predicted_card_transactions` シートを新規追加（スキーマは設計書セクション4.3参照）

#### 従業員への周知
12. **運用ルール周知** → MF経費でカード明細を経費登録しないこと（H3問題対策）。カード決済の購買・出張は /purchase, /trip で申請済みのため不要

#### テスト
13. **Driveアップロード動作確認** → テスト証憑で /purchase → 証憑添付 → Drive保存 + 仕訳登録の一連フローを確認
14. **補助科目の名前解決テスト** → MF会計Plus APIで `GET /masters/sub_accounts` を叩き、「MFカード:未請求」が正しく返ることを確認

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

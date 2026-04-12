# CURRENT_WORK

## [Handoff] "DB移行完了 + B案出張統合実装 + UI互換修正" — 2026-04-12 14:02 (branch: master)

### Goal / Scope
- GAS→Supabase Postgres(Tokyo)完全移行 + B案出張統合実装 + UI互換修正 + ドキュメント更新
- やらないこと: Procurement-Assistant変更、Slack自動取込移植

### Key decisions
- Supabase(Tokyo)選定(Neonは東京なし)、Drizzle ORM(コールドスタート最速)
- gas-client re-exportで31ファイル無変更DB移行
- office_member_idベース照合(card_last4非依存)
- 出張PO番号: TRIP-YYYYMM-NNNN形式

### Done
- [x] Supabase Postgres 15テーブル構築(Tokyo, 150ms)
- [x] db-client.ts + gas-client re-export(31ファイル無変更移行)
- [x] B1-B5全完了: office_member_id同期, MF経費API拡張, card-matcher-v2, /trip/new, 承認DM
- [x] UI互換修正: voucherStatus/requestType/getStatus日本語キー/金額照合
- [x] ドキュメント: architecture-2026-04.md, db-schema.md, 4ファイル更新

### Pending
1. 動作確認テスト（出張E2E + UI網羅）
2. MFビジネスカード→MF経費自動連携設定+検証
3. 立替精算(/expense/new)
4. Slack自動取込(main.js移植、本番置換時)

### Next actions
1. 出張申請テスト: /trip/new→Slack投稿→承認DM→ステータス確認
2. UI互換テスト: purchase/my, purchase/[prNumber], dashboard全項目
3. MFカード自動連携設定依頼→automatic_status検証
4. 立替精算設計・実装

---

## [Handoff] "出張バーチャルカード統合設計 + 実装検証修正完了" — 2026-04-09 22:46 (branch: master)

### Goal / Scope
- 本番投入前検証: 全CRITICAL/HIGH/MEDIUM問題修正
- Upstash Redis共有キャッシュ導入（GAS 7-8秒→数十ms）
- Google OAuth認証（NextAuth v5）導入・動作確認済み
- 出張バーチャルカード統合フロー設計検討（未実装、次セッション継続）

### Key decisions
- Redis: Vercel Marketplace Upstash。キープレフィックス`gas:`。インメモリフォールバック付き
- NextAuth: proxy.tsでAUTH_SECRET未設定時パススルー。Google内部ユーザータイプで制限
- 承認権限: approverSlackId空→拒否、allowed空→拒否に修正
- GAS/Slack順序: GAS先行、失敗時ephemeralエラー。safeUpdateStatus→boolean化
- 出張: 従業員別バーチャルカード×各サービス個人アカウント（じゃらんも個人契約）
- カード明細: MF会計Plus直接/MF経費経由/MFビジネスカードAPI直接の3パターン
- Amazon: Gmail CSV不要。MF会計Plus×App Center連携で進める

### Done
- [x] Upstash Redis + リクエスト合体 + cache-warm改善
- [x] Google OAuth認証 + サインインページ + SessionProvider
- [x] CRITICAL: 承認権限バイパス/GAS-Slack順序/fire-and-forget/追加品目エラー
- [x] HIGH: 税率警告/API失敗通知/キャッシュリフレッシュ/TSフォールバック
- [x] MEDIUM: cache-warm認証/journals空警告/RAG失敗ガード
- [x] トップページ→ダッシュボードリダイレクト
- [x] Vercelデプロイ・動作確認完了

### Pending
1. 出張バーチャルカード統合フロー詳細設計・実装
2. ドキュメント更新（Redis/OAuth/EC連携反映）
3. H1: 部分検収数量競合（GAS側要対応）
4. M2: DM送信失敗OPS通知

### Next actions
1. **出張バーチャルカード統合設計**（照合・連携方式の詳細検討）
2. 従業員マスタ拡張（cards配列化）
3. /trip承認フロー追加（部門長承認）
4. カード照合マルチカード対応
5. **ドキュメント一括更新**（operational-guide, user-manual, spreadsheet-schema, test-plan）
   - Google OAuth / Redis / Amazon照合 / EC連携 / 検収モーダル / RAG推定 / スキーマ37列化 / テスト計画

---

## [Handoff] "RAG精度検証 + Amazon CSV照合 + EC連携証憑スキップ" — 2026-04-09 02:53 (branch: master)

### Goal / Scope
- RAG勘定科目推定の精度を実データで検証
- Amazon CSV照合機能を新規実装し、業務フロー（Phase 1〜3）に組み込み
- EC連携サイト（Amazon/MISUMI/楽天/Yahoo）の証憑催促スキップ
- 検収フローに納品書あり/なし選択を追加
- やらないこと: MF会計Plus × Amazon Business App Center連携の有効化（本番影響あり、経理判断待ち）

### Key decisions
- RAG精度検証: 過去仕訳原票をテストデータとして利用 → 93.3%正答率
- Amazon照合: クライアントサイド完結（CSVパース+マッチングをブラウザで実行）
- EC連携サイト判定: `src/lib/ec-sites.ts` に共通ヘルパー。証憑対応="MF自動取得"で催促スキップ
- 納品書: 法人税法上、受領した場合は保存義務あり → 検収時に有無選択 + ありならファイル添付
- MF会計Plus連携: Amazon Business App Centerで連携可能だが本番影響あるため保留

### Done
- [x] RAG精度検証API — 93.3%正答率、税区分96.7%
- [x] Amazon CSVパーサー + マッチングエンジン + 照合タブUI
- [x] Phase 1: CSVエクスポート、Slack DM事後申請依頼、適格番号GAS書き戻し
- [x] Phase 2: カード照合cronにAmazon注記、card-matchingページにAmazonバッジ
- [x] Phase 3: 検収モーダル（納品書あり/なし+添付）、EC連携サイト証憑スキップ（Web+Slack両対応）
- [x] Phase 3: Slack #管理本部サマリ投稿 + 差額±5,000円超アラート

### Pending
1. MF会計Plus × Amazon Business App Center連携の有効化（経理チームと調整後）
2. EC連携サイト（MISUMI/楽天/Yahoo）のApp Center連携有効化
3. Gmail経由のAmazon CSVレポート自動取得
4. GASレスポンス自体の高速化

### Next actions
1. 経理チームにMF会計Plus × Amazonビジネス連携の有効化を相談
2. 連携後、MF側にAmazon購買データが仕訳候補として出るか確認
3. Amazon Business管理画面でスケジュールレポート（週次CSV）のGmail配信を設定
4. Gmail API経由のCSV自動取得cron実装
5. MISUMI/楽天/Yahoo利用状況を確認し、連携有効化の優先度を判断

### Affected files
- `src/lib/amazon-matcher.ts` — 新規: CSVパーサー + マッチングエンジン
- `src/lib/ec-sites.ts` — 新規: EC連携サイト判定ヘルパー
- `src/app/admin/journals/AmazonMatchingTab.tsx` — 新規: Amazon照合タブUI
- `src/app/api/admin/amazon-matching/notify/route.ts` — 新規: Slack DM API
- `src/app/api/admin/amazon-matching/summary/route.ts` — 新規: Slackサマリ投稿API
- `src/app/api/purchase/estimate-account/verify/route.ts` — 新規: RAG精度検証API
- `src/app/api/purchase/[prNumber]/status/route.ts` — EC連携判定、納品書ステータス
- `src/app/api/purchase/upload-voucher/route.ts` — 納品書タイプ対応
- `src/app/purchase/[prNumber]/page.tsx` — 検収モーダル、MF自動取得ステータス
- `src/lib/reconciliation.ts` — amazonRelated集計追加
- `src/lib/slack.ts` — 検収完了メッセージEC連携対応

### Risks / Unknowns
- MF会計Plus連携有効化は本番会計データに影響 → 経理判断必須
- EC連携サイト判定のsupplierName表記揺れ → 運用で判明次第パターン追加
- GAS「納品書」列が未存在の可能性 → updateStatusが任意フィールドを受け付ける前提

---

## [Handoff] "勘定科目RAG改善 + Slack連動 + パフォーマンス最適化" — 2026-04-08 15:03 (branch: master)

### Goal / Scope
- 勘定科目推定を「申請時ルールベース」→「証憑添付時RAG（過去仕訳原票ベース）」に再設計
- Web操作時にSlackメッセージのステータス表示を連動更新
- 全ページのGAS起因の読み込み遅延を大幅改善
- やらないこと: 本番(購買管理)シート・main.jsの変更、DB移行

### Key decisions
- 申請時の勘定科目推定を廃止→証憑添付時にRAG推定（原票パススルー方式）
- GASに`getMastersBundle`追加（6回→1回）、`cacheResolvedJournals`+`searchJournalRows`追加
- CDN s-maxage + cronウォーマー(4分) + クライアントSWR(localStorage)の3層キャッシュ
- UserProviderをlocalStorage即時復元に変更
- 操作後にSWRキャッシュをinvalidate（データ鮮度対策）

### Done
- [x] 勘定科目推定を証憑添付時RAGに移行（全関連ファイル更新済み）
- [x] Web操作→Slackメッセージ書き換え連動
- [x] 3層キャッシュ（CDN + Vercelインメモリ + クライアントSWR）
- [x] cronキャッシュウォーマー、申請ボタンローディング表示、SWR invalidate

### Pending
1. RAG推定の精度検証（実データ）
2. Amazon CSV照合機能（後続タスク）
3. GASレスポンス自体の高速化検討

### Next actions
1. AI再推定ボタンで精度を実データ検証
2. cronウォーマーのログ確認（数日後）
3. Amazon CSV照合機能の設計・実装

---

## [Handoff] "カラム構成リニューアル＋推定ロジック再設計" — 2026-04-08 00:15 (branch: master)

### Goal / Scope
- 購買管理_testシートのカラムを業務フロー順に再構成（41→40列）
- Web申請画面のラベルとシート列名を完全一致させる
- 購買番号の採番を本番/テストで分離
- 勘定科目推定ロジックの再設計（証憑添付時に集約）
- やらないこと: 本番(購買管理)シート・main.jsの変更、Supabase移行

### Key decisions
- 金額は税込統一（MF会計Plus準拠）
- 購買番号: webApi.jsに独立採番関数(generatePrNumberForWebApi)
- Slackリンク列廃止、スレッドTSのみ残す
- 備考の混在データを「購入品の用途」「購入理由」に分離、[Web申請]自動付与廃止
- Amazon注文照合: 列削除→仕訳管理のCSV機能に移行（後続）
- MF会計（計上済）廃止→MF仕訳IDの有無で判定
- 勘定科目推定: 申請時廃止→証憑添付時RAG推定に一本化（承認済み、未実装）
- 伊澤(U04FBAX6MEK)にSlack全承認権限付与

### Done
- [x] 購買番号採番分離、カラム名全リネーム、新列追加(検収者/購入理由/差戻し理由/取消日/MF仕訳ID)
- [x] 列削除(次のアクション/Amazon注文照合/Slackリンク/受取場所/使用場所/納品予定日/MF会計)
- [x] webApi.js/gas-client.ts/submit/route.ts/全ページの列名参照更新
- [x] Slack承認権限(5箇所)、setupWebApiHeaders関数、GAS+Vercelデプロイ完了

### Pending
1. 勘定科目推定ロジック再設計（証憑添付時に集約）

### Next actions
1. submit/route.tsからestimateAccount呼び出し削除
2. 証憑添付時(slack/events, upload-voucher)にestimateAccountFromHistory追加
3. journals/page.tsxに再推定ボタン追加
4. Amazon CSV照合機能（後続）
5. GASレスポンス改善

### Affected files
- `Procurement-Assistant/src/gas/webApi.js`, `src/lib/gas-client.ts`, `src/lib/slack.ts`
- `src/app/api/purchase/submit/route.ts`, `src/app/api/slack/events/route.ts`, `src/app/api/mf/journal/route.ts`
- `src/app/purchase/[prNumber]/page.tsx`, `my/page.tsx`, `new/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/admin/journals/page.tsx`

### Repro / Commands
```bash
npx vercel --prod
cd Procurement-Assistant/src/gas && echo y | clasp push
# GASエディタから setupWebApiHeaders → 新デプロイ → Vercel GAS_WEB_APP_URL更新
```

### Risks / Unknowns
- GASデプロイURL変更のたびにVercel環境変数更新が必要
- clasp pushだけではWeb App未反映（新デプロイ必須）
- 証憑添付時RAG推定のレイテンシ懸念
- 本番移行時は列マッピング変換が必要

---

## [Handoff] "Web購買システム機能追加・パフォーマンス改善・権限制御・本番テスト分離" — 2026-04-07 12:10 (branch: master)

### Goal / Scope
- 7件バグ修正 + パフォーマンス改善 + 権限制御(RBAC) + Web UIステータス管理 + 承認ルート設定 + 本番/テスト分離
- やらないこと: E2Eテスト、Slack OAuth認証

### Key decisions
- 権限判定: 従業員マスタの`departmentName === "管理本部"`でisAdmin判定（Slack OAuth不要）
- UserContext: localStorageの`purchase_user_id`(Slack ID) + `purchase_applicant_name`でフォールバック
- 本番/テスト分離: webApi.jsに`WEBAPI_SHEET = '購買管理_test'`を独立定義、main.jsのCONFIGとは分離
- TEST_MODE: 全DM送信をプライベートチャンネルにリダイレクト（safeDmChannel関数）
- clasp deploy禁止: 権限破壊するため。clasp pushのみ、デプロイはGASエディタ手動

### Done
- [x] 7件バグ修正（MF取引先ページネーション、固定資産判定、未処理タスク、HubSpot PJサジェスト、仕訳管理フィルタ、申請取消、Botスレッド分裂）
- [x] パフォーマンス改善（Promise.all並列化、GASキャッシュ追加、MFキャッシュバグ修正、レンダー中API呼出し修正）
- [x] RBAC（UserContext、ナビ出し分け、ダッシュボード/マイ申請のユーザーフィルタ、管理ページアクセスガード）
- [x] Web UIステータス管理（承認/差戻し/発注完了/検収完了/証憑UP/取消）
- [x] 承認ルート設定ページ（/admin/approval-routes）+ GAS updateApprover/bulkUpdateEmployees
- [x] 従業員マスタ全員のSlack ID・英語名別名を一括設定
- [x] 本番/テスト分離（WEBAPI_SHEET分離、TEST_MODE、safeDmChannel）
- [x] GASメニューに「Web申請画面を開く」追加
- [x] GAS recentRequestsのlimit上限30→200、申請者フィルタの別名・括弧内名・スペース除去対応
- [x] CLAUDE.mdに本番/テスト分離ルール明記

### Pending
1. **概算申請**: page.tsxにチェックボックス追加済み、submit APIにフラグ追加済み、GASに列追加済み → **スプレッドシートに「概算」「事後報告」列ヘッダーの手動追加が必要**
2. **事後報告**: 「購入済」選択時にisPostReport自動設定済み → 同上
3. **GASデプロイ未反映**: 概算・事後報告の列読み書きはGAS pushのみでWeb Appデプロイ未実施

### Next actions
1. スプレッドシート`購買管理_test`に「概算」「事後報告」列をヘッダーに手動追加
2. GASエディタで新デプロイ → Vercel GAS_WEB_APP_URL更新 → `npx vercel --prod`
3. 概算申請・事後報告のE2Eテスト（Web申請→ダッシュボード集計確認）
4. 承認ルート設定ページのテスト（部門ごとの承認者変更→申請時の承認者確認）
5. 適格請求書の仕訳管理ページへの移動（ダッシュボードからは削除済み）

### Affected files
- `src/lib/user-context.tsx` — 新規: UserProvider, useUser, safeDmChannel
- `src/app/layout-client.tsx` — 新規: 権限ナビ
- `src/app/layout.tsx` — LayoutClient化
- `src/app/purchase/new/page.tsx` — 概算チェック、isPostReport、useUser、Promise.all並列化
- `src/app/dashboard/page.tsx` — ユーザーフィルタ、適格請求書削除
- `src/app/purchase/my/page.tsx` — ユーザーフィルタ
- `src/app/purchase/[prNumber]/page.tsx` — 承認/差戻し/取消、権限ガード
- `src/app/admin/journals/page.tsx` — Promise.all、管理本部ガード
- `src/app/admin/card-matching/page.tsx` — 管理本部ガード、useEffect修正
- `src/app/admin/approval-routes/page.tsx` — 新規: 承認ルート設定
- `src/app/api/admin/approval-routes/route.ts` — 新規: 承認者CRUD API
- `src/app/api/purchase/[prNumber]/status/route.ts` — approve/reject/cancel追加
- `src/lib/slack.ts` — TEST_MODE、safeDmChannel、thread_ts修正
- `src/lib/gas-client.ts` — キャッシュ追加、updateApprover、bulkUpdateEmployees
- `src/lib/mf-accounting.ts` — counterpartyCache/subAccountCacheバグ修正
- `Procurement-Assistant/src/gas/webApi.js` — WEBAPI_SHEET分離、申請者フィルタ改善、limit拡大、概算/事後報告列
- `Procurement-Assistant/src/gas/katanaMenu.js` — Web申請画面リンク追加

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc && npx vercel --prod
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas && echo y | clasp push
# GASデプロイはGASエディタから手動実行。clasp deploy禁止！
```

### Risks / Unknowns
- UserContext認証がSlack ID + localStorageキャッシュのフォールバックに依存。本番運用にはSlack OAuth等が必要
- GASプロジェクトがgit管理されていないため、clasp push時にmain.jsの意図しない変更が本番に反映されるリスク
- Vercel環境変数GAS_WEB_APP_URLはGAS新デプロイのたびに更新が必要

---

## [Handoff] "Web購買申請フォーム7件バグ一括修正" — 2026-04-05 23:52 (branch: master)

### Goal / Scope
- Web購買申請フォーム(`/purchase/new`)と仕訳フロー全体の7件のバグ・要望を**一括修正**する
- **最重要**: 全体を調査・理解してから修正に着手すること。部分的逐次修正は厳禁（ユーザーから複数回指摘済み）
- やらないこと: E2Eテスト、新規機能追加（7件以外）

### Key decisions
- Slack数量フィールド: number_input → plain_text_input に戻す（UX問題: 値が消せない）
- 下書き保存: インメモリMap → GASスプレッドシート永続化（1か月自動消去）に変更済み
- 購入理由バリデーション: response_action:"errors" でモーダル内エラー表示に変更済み
- 固定資産判定: totalAmount → amount（単価）ベースに変更（着手済み・未完）

### Done（前回ハンドオフ後に実施、デプロイ済み）
- [x] AI推定プロンプト改善（数量1でも品名性質優先）`account-estimator.ts:270-291`
- [x] 購入理由: モーダル内エラー表示 `events/route.ts:248-259`
- [x] formDataデバッグログ追加 `events/route.ts:758-769`
- [x] 下書き保存GAS永続化 `gas-client.ts:606-650`, `slack.ts:1256-1259`, GAS `webApi.js:1544-1666`
- [x] HubSpot→PJ: buildJournalFromPurchaseにhubspotDealIdパラメータ追加 `mf-accounting.ts:409,453,487`
- [x] resolveProjectCode新設 `mf-accounting.ts:269-272`
- [x] GAS列名修正「HubSpot案件番号」→「HubSpot/案件名」`events/route.ts:1346`

### Pending — 7件の未修正バグ（次回で全て一括修正すること）
1. **MF取引先が一部しか出ない**: `/api/mf/counterparties`のページネーション未対応 or フィルタ問題。page.tsxでは請求書払い時のみ取得→常時取得に着手済みだが未完
2. **HubSpot→PJマスタ連携なし**: フリーテキストのみ。PJマスタからdatalistサジェストが必要
3. **固定資産判定が常に工具器具備品**: page.tsx:461で`totalAmount>=100000`判定→`amount>=100000`に着手済み未完。**根本原因**: estimate-account APIに`unitPrice`と`department`を渡していない(`page.tsx:727-731`)
4. **証憑添付前に仕訳管理にデータが飛ぶ**: admin/journals の取得条件を調査必要。却下しても残る
5. **未処理タスクが常に「なし」**: fetchMyTasks関数のAPIとフィルタ条件を調査必要
6. **申請取り消し機能**: Slack側handleCancelは存在するがWeb UIからの取り消しUIなし
7. **Botメッセージが別スレッドに分裂**: handleApprove/handleOrderComplete等のthread_ts設定を全て確認必要。actualThreadTs修正はhandleFileSharedInThreadのみ適用済み

### Next actions
1. **全ファイルを通読して原因特定**（page.tsx全体、events/route.ts全Bot投稿箇所、admin/journals、MF counterparties API）
2. MF取引先API: ページネーション対応 or 全件取得に修正 `src/app/api/mf/counterparties/route.ts`
3. page.tsx: estimate-account APIに`unitPrice`(=amount)と`department`を渡す `:727-731`
4. page.tsx: PJマスタ取得→HubSpotフィールドにdatalistサジェスト追加
5. page.tsx: 固定資産判定を`amount>=100000`に修正（isHighValue）
6. Botスレッド統一: 全handleXxx関数のthread_ts設定を確認・修正 `slack.ts`
7. 仕訳管理データ流入: admin/journals取得条件に「証憑確認済」フィルタ追加
8. 未処理タスク: fetchMyTasks APIレスポンスとフィルタ条件をデバッグ
9. 全修正完了後にtsc→ビルド→デプロイ（1回のみ）

### Affected files
- `src/app/purchase/new/page.tsx:461,727-731,534-541` — 固定資産判定、API params、MF取引先取得
- `src/app/api/slack/events/route.ts` — Bot投稿thread_ts全箇所
- `src/app/api/mf/counterparties/route.ts` — ページネーション
- `src/lib/slack.ts:113-264,265-315,377-461` — handleApprove/OrderComplete/InspectionComplete thread_ts
- `src/app/admin/journals/page.tsx` — データ取得条件
- `src/lib/mf-accounting.ts:269-272` — resolveProjectCode（実装済み）
- GAS `webApi.js` — 下書きAPI（実装済み）

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc && npx vercel --prod
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas && echo y | clasp push
```

### Risks / Unknowns
- MF取引先APIのページネーション仕様が不明（API docsで要確認: docs/api-specs/）
- PJマスタのcode列=HubSpot Deal IDの前提が全件で成立するか未検証
- Botスレッド分裂の根本原因がthread_ts設定漏れか、Slack API側の挙動か不明
- admin/journals のデータソースがGAS直接取得かMF API経由か要確認
- page.tsxの中途半端な修正（MF取引先常時取得、isHighValue変更）が未デプロイ状態で混在

---

## [Handoff] "Slack購買申請フォーム改善 + 下書き保存機能" — 2026-04-05 21:47 (branch: master)

### Goal / Scope
- Slack購買申請モーダルのUX問題7件を修正 + 仕訳統計のremarkAccounts修正
- 新規要望: 申請の下書き保存・再開機能
- やらないこと: E2Eテスト、Phase 2/3のRAG統計改善

### Key decisions
- remarkAccountsが0件だった原因: MF APIからremark取得済だがシート未同期 → syncJournalHistory再実行+extractItemFromRemark_修正で1007件に
- 購入先マスタ: static_select → 検索不可で使いにくいためplain_text_inputに戻した
- 金額フィールドラベル: 「金額（税込・円）」→「単価（税込・円）」に変更

### Done
- [x] remarkAccounts修正（1007件生成）、JSON分割保存対応
- [x] 数量: number_input化（min_value/initial_value削除）
- [x] 固定資産判定: estimateAccount()にunitPrice追加、単価ベース判定
- [x] 固定資産通知: actionValueにunitPrice追加、Block Kit化
- [x] 購入理由: hint改善+記載例+サーバーバリデーション
- [x] safeUpdateStatus/gas-client: エラーログ詳細化
- [x] Botスレッド分裂: actualThreadTs探索ロジック
- [x] 金額比較: 税抜同士比較

### Pending — 深く調査してから対応すべき
- [ ] 数量入力UX: number_input(min_valueなし)の実機挙動未確認
- [ ] 購入理由: optional:trueなのに必須と感じる問題。formDataパース結果要確認
- [ ] AI推定: 数量1だとunitPrice=totalAmountで固定資産になる。プロンプト改善必要
- [ ] 金額不一致: 税抜比較ロジックの実データ検証
- [ ] MF会計との金額体系統一（税込ベース）
- [ ] **下書き保存・再開機能（新規要望）**

### Next actions
1. formDataデバッグログ追加 → 各フィールドの値をVercelログで確認
2. number_input実機検証（空欄送信の挙動）
3. AI推定プロンプト: 数量1でも総額と単価の区別を明示
4. GAS「合計額（税抜）」列との整合性確認
5. 下書き保存機能の設計
6. 全修正後に1回だけテスト

### Affected files
- `src/lib/slack.ts` — parseActionValue, buildActionValue, handleInspection, notifyOps, safeUpdateStatus, buildPurchaseModal
- `src/lib/account-estimator.ts:86-416` — estimateAccount, callClaudeForEstimation, estimateAccountFromHistory
- `src/app/api/slack/events/route.ts:749-1150` — handlePurchaseSubmission, handleFileSharedInThread, 金額比較
- `src/app/api/purchase/estimate-account/route.ts` — unitPriceパラメータ
- GAS: `mfAccountingApi.js`(extractItemFromRemark_, JSON分割), `webApi.js`(列未発見ログ)

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc && npx vercel --prod
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas && echo y | clasp push
```

### Risks / Unknowns
- number_input空欄送信でSlackエラーの可能性
- 購入理由バリデーション: katanaPo等が空文字だとhasReference=falseで常に必須
- 下書き保存: Slackモーダルprivate_metadata 3000文字上限あり

---

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

---

## [Handoff] "MFマスタRAG仕訳推定 — 全体像と未解決課題" — 2026-04-05 11:09 (branch: master)

### システム全体像

**目的**: 購買申請→証憑確認→MF会計Plus仕訳登録を自動化する購買管理システム

```
[Slack購買チャンネル]
    ↓ 購買申請（品目名・取引先・金額・部門）
[Procurement-Assistant (GAS)]
    ↓ GASスプレッドシートに記録、Slackスレッドで証憑添付を待つ
    ↓ 証憑添付 → OCR読取（金額・T番号・税区分）
    ↓ T番号 → 国税庁API → 適格請求書発行事業者の法人名確認
[GASスプレッドシート] ← 全データの永続化層（DB移行なし）
    ↑↓
[next-procurement-poc (Vercel)]
    ├─ /admin/journals — 仕訳管理UI（★今回の主な作業対象）
    │   ├─ 発注データ vs 証憑データ比較パネル
    │   ├─ AI科目推定（RAG: 過去仕訳統計 + MFマスタ + Claude Haiku）
    │   ├─ 仕訳プレビュー＋編集フォーム
    │   └─ MF会計Plus仕訳登録ボタン
    ├─ /api/mf/journal — 仕訳登録API → MF会計Plus API
    ├─ /api/mf/masters — MFマスタ取得（GASシートから。MF認証不要）
    ├─ /api/purchase/estimate-account — AI科目推定API
    └─ /api/slack/events — Slack連携（証憑添付→自動仕訳）
[MF会計Plus API] ← 仕訳登録先
[MFマスタ（GASシート6種）] ← 勘定科目・税区分・部門・取引先・補助科目・PJ
```

**データの流れ（1件の購買の一生）**:
1. 社員がSlackで購買申請 → GASが記録
2. 購入後、Slackスレッドに証憑（領収書/請求書）添付
3. GASがOCR読取（金額・T番号・税区分）→ 国税APIで法人名確認
4. /admin/journals で経理が確認: 発注データと証憑データを比較
5. AI が科目・税区分を推定（過去仕訳+MFマスタのRAG）
6. 経理が確認・修正 → MF会計Plusに仕訳登録

### Goal / Scope
- 仕訳管理UIの科目推定精度向上とフォーム整合性修正
- AI推定をMFマスタ準拠 + 証憑データ優先に改善
- やらないこと: GAS→DB移行、GAS側OCR処理の改修（今回スコープ外）

### Key decisions
- **MFマスタ名リストをAIプロンプトに渡す**: AIがマスタに存在しない科目名を返す問題を根本解決
- **snapToOption**: 全selectのvalueをMFマスタ選択肢に正規化。マスタにない値は最近似マッチ
- **OCR→AI推定の直列化**: OCR到着後にAI推定を呼ぶ（証憑の取引先・金額・税区分を優先）
- **estimateTaxPrefix → buildJournalFromPurchase接続**: 過去仕訳統計ベースの税区分決定
- **プロンプトから固定業務ルール削除**: 品名重視・過去仕訳パターン最優先（ただし少額減価償却の会計基準は残す）

### Done
- [x] estimateTaxPrefix → buildJournalFromPurchase内の税区分決定に接続
- [x] /admin/journals UI: 非適格バッジに「80%控除」、AI推定根拠カード表示
- [x] GAS: computeJournalStats日次トリガー設定関数追加・プッシュ・実行済
- [x] snapToOption/snapToCreditOption: 全selectフィールドのMFマスタ正規化
- [x] AI推定: MFマスタの科目名・税区分名リストをプロンプトに含める
- [x] AI推定: OCR到着後に証憑データ（取引先・金額・税区分）優先で呼出し
- [x] AI推定: 少額減価償却資産の会計基準をプロンプトに追加
- [x] Vercelデプロイ済み

### Pending — 仕様未定の課題（次回要議論）

**1. OCR読取項目の不足**
| 項目 | 現状 | 必要性 |
|------|------|--------|
| 取引先名 | ❌ T番号→国税APIの法人名のみ | 証憑から直接読取すべき |
| 証憑日付（請求日/納品日） | ❌ 未読取 | 仕訳日の決定に必要 |
| 品名・明細 | ❌ 未読取 | 科目推定の最重要入力 |
| 明細単位の税率・税額 | △ 「課税10%」のみ | 軽減税率混在に対応必要 |
| 証憑金額 | ✅ | — |
| 適格番号 | ✅ | — |

**2. 仕訳ルール未定事項**
| 項目 | 現状 | 要決定 |
|------|------|--------|
| 仕訳日 | 検収日→申請日→今日 | 検収日確定？証憑日付？ |
| 摘要 | 申請の品目名ベース | 証憑の品名にすべき？ |
| 科目推定入力 | 申請品目名+証憑取引先+金額 | 証憑品名・明細を使うべき |

**3. 証憑プレビュー**
- DriveファイルIDが空でiframeプレビューが表示されない（GAS側でDriveアップロードが必要）

**4. 過去仕訳RAGの精度向上**
- 現在: 取引先×科目、部門×科目の集計のみ
- 課題: Amazon等の汎用取引先では取引先集計が役に立たない
- 改善案: GAS computeJournalStatsに摘要（remark）×科目の統計を追加

### Next actions
1. OCR読取項目の仕様策定 — 証憑から読み取るべき項目を確定（取引先名・日付・品名・明細）
2. 仕訳ルール策定 — 仕訳日・摘要・科目推定入力のルール確定
3. GAS側OCR処理の改修 — 確定した仕様に基づきOCR読取項目を拡充
4. 証憑プレビュー — GAS側でDriveファイルID保存 or Slack画像URL取得
5. 摘要×科目統計の追加 — computeJournalStatsにremark解析を追加
6. E2Eテスト — 実データで仕訳編集→保存→MF登録の一連フロー確認

### Affected files
- `src/lib/account-estimator.ts` — RAG推定: MFマスタ名リスト渡し、プロンプト改善、OCR税区分対応
- `src/lib/mf-accounting.ts:9,434-437` — estimateTaxPrefix import・接続
- `src/app/admin/journals/page.tsx:71-95` — snapToOption/snapToCreditOption追加
- `src/app/admin/journals/page.tsx:171-270` — JournalDetail値解決・OCR→AI推定直列化・masters/estimation反映useEffect
- `src/app/admin/journals/page.tsx:944-958` — 一覧テーブル行のsnapToOption適用
- `src/app/api/purchase/estimate-account/route.ts` — 証憑データパラメータ追加
- `Procurement-Assistant/src/gas/mfAccountingApi.js:1546-1568` — setupJournalStatsTrigger追加

### Repro / Commands
```bash
# Next.js
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
npx vercel --prod

# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push

# AI推定テスト（証憑データ付き）
curl "本番URL/api/purchase/estimate-account?itemName=ノートPC&supplierName=Amazon&totalAmount=16000&department=管理本部&verifiedSupplierName=日本電気&voucherAmount=24200&ocrTaxCategory=課税10%" -H "x-api-key: INTERNAL_API_KEY"
```

### Risks / Unknowns
- OCR読取項目の拡充はGAS側（Procurement-Assistant）の改修が必要 — Next.js側だけでは完結しない
- 証憑の品名読取精度 — 手書き領収書やフォーマット多様な請求書への対応
- 過去仕訳の摘要パース — 「2025/09 PR-202509-0001 USBケーブル」のような形式からの品名抽出ロジック
- MF APIのdeductible_50（2026/10〜50%控除）は未対応

### Links
- 本番: https://next-procurement-poc-tau.vercel.app/admin/journals
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit

## [Handoff] "MFマスタGAS統合・仕訳RAG推定・システム全体像" — 2026-04-04 23:44 (branch: master)

### システム全体像

**2つのリポジトリが同一GASプロジェクトを共有**:

| リポジトリ | 役割 | 技術 |
|---|---|---|
| `Procurement-Assistant` | 本番Slackボット。購買依頼/報告をSlackから取得→GASスプレッドシートに自動記録。GAS時間トリガー（5分毎）で動作。MF会計Plus APIとOAuth連携 | Google Apps Script |
| `next-procurement-poc` | 管理UI・仕訳管理・API。購買申請のWeb UI、証憑OCR、MF会計仕訳登録、カード照合、支出分析 | Next.js 16 + Vercel |

**共有GASプロジェクト** (scriptId: `1pFr4xGx-...`):
- SlackボットはGAS時間トリガーで動作（デプロイURL不使用）
- Next.jsはGAS Web App URL経由でHTTPアクセス
- デプロイは2つのみ: @HEAD(開発) + `...rsEPI`(本番v40)

**データフロー**:
```
Slack購買チャンネル → [Procurement-Assistant GASトリガー] → GASスプレッドシート
                                                              ↑↓
Next.js Vercel → [GAS Web App API] → GASスプレッドシート
                → [MF会計Plus API] → 仕訳登録
                → [国税庁API] → 適格請求書検証
```

**MFマスタ構成（今回確立）**: 全マスタをGASシートに保持、MF認証不要で即時取得
- 取引先マスタ_MF (627件), 部門マスタ_MF (20件)
- 勘定科目マスタ_MF (258件), 税区分マスタ_MF (151件), 補助科目マスタ_MF (318件), PJマスタ_MF (336件)
- MF認証後にsyncAllMfMasters/syncMfMastersFromApiで差分同期
- 過去仕訳_MF (4237件/15020行) + 仕訳統計_MF (集計キャッシュ)

### Goal / Scope
- MFマスタを全てGASシート化（MF認証不要で読取可能に）
- 過去仕訳データ（2025/9〜）によるRAGベース勘定科目・税区分推定
- 非適格事業者の経過措置（invoice_transitional_measures）対応
- やらないこと: GAS→DB移行、MFマスタのJSONキャッシュ方式への回帰

### Key decisions
- **マスタ2層→1層**: JSONキャッシュ廃止、全マスタをGASシート個別管理に統一
- **RAG推定**: Claude Haiku 4.5 + 過去仕訳統計コンテキスト。フォールバック: 頻度ベース→ルールベース(54パターン)
- **非適格**: MF APIの`invoice_transitional_measures: deductible_80`を使用（MF側が自動計算）
- **GASデプロイ運用**: clasp pushでコード更新→clasp versionでバージョン作成→GASエディタで手動デプロイ更新（clasp deploy禁止）

### Done
- [x] GASデプロイ整理（11→2）、古い9デプロイ削除
- [x] GAS_WEB_APP_URL末尾\n修正
- [x] 勘定科目・税区分・補助科目・PJの4シート作成＋GASハンドラ追加
- [x] syncAllMfMasters: GASエディタからMF API→シート一括同期
- [x] syncMfMastersFromApi: Next.js認証後→GASシートへ差分同期
- [x] /api/mf/masters: 全6マスタをGASシートから直接取得（source: gas-sheets）
- [x] 過去仕訳_MF: 2025/9〜2026/4の4237件・15020行をGASシートに保存
- [x] 仕訳統計_MF: 取引先×科目(503パターン)・部門×科目(322パターン)の頻度集計
- [x] estimateAccountFromHistory: RAGベース推定（Claude API + 過去統計コンテキスト）
- [x] estimateTaxPrefix: 部門×科目→共通/課税推定
- [x] buildJournalFromPurchase: isQualifiedInvoice + invoice_transitional_measures対応
- [x] estimate-account API・journal API・slack events統合済み
- [x] Vercelデプロイ済み、GASデプロイv40

### Pending
- [ ] buildJournalFromPurchaseの税区分決定にestimateTaxPrefixを統合（現在未接続）
- [ ] RAG推定のtaxTypeをbuildJournalFromPurchaseに渡す仕組み
- [ ] /admin/journals UIに推定根拠・非適格バッジ表示
- [ ] 仕訳統計の定期更新（日次GASトリガー or MF認証時）
- [ ] Vercel環境変数ANTHROPIC_API_KEYのdevelopment環境追加

### Next actions
1. estimateTaxPrefixをbuildJournalFromPurchase内の税区分決定ロジックに接続（現在EXPENSE_ACCOUNT_MAPハードコード）
2. RAG推定で返るtaxTypeを仕訳作成フローに反映（estimate→build→MF APIの一貫性）
3. /admin/journals UIに非適格バッジ・推定根拠表示を追加
4. computeJournalStatsをGAS時間トリガーで日次自動実行に設定
5. 仕訳編集→保存→MF登録のE2Eテスト（実データで確認）

### Affected files
- `src/lib/account-estimator.ts` — estimateAccountFromHistory(RAG), estimateTaxPrefix, buildContext, callClaudeForEstimation
- `src/lib/mf-accounting.ts:14-23` — BranchSide.invoice_transitional_measures追加
- `src/lib/mf-accounting.ts:374-390` — getTransitionalMeasure, buildJournalFromPurchase(isQualifiedInvoice)
- `src/lib/gas-client.ts:458-510` — JournalStats, getJournalStats, 4マスタ取得関数
- `src/app/api/mf/masters/route.ts` — 全マスタGASシート直接取得に変更
- `src/app/api/mf/masters/sync/route.ts` — syncMfMastersFromApiアクション呼出しに変更
- `src/app/api/mf/journal/route.ts:83` — isQualifiedInvoice判定追加
- `src/app/api/slack/events/route.ts:1282` — isQualifiedInvoice判定追加
- `src/app/api/purchase/estimate-account/route.ts` — estimateAccountFromHistoryに切替
- `Procurement-Assistant/src/gas/mfAccountingApi.js` — getMfSubAccounts, getMfProjects, syncAll系, computeJournalStats, syncJournalHistory
- `Procurement-Assistant/src/gas/webApi.js` — getMfAccounts/Taxes/SubAccounts/Projects/getJournalStats/syncMfMastersFromApi

### Repro / Commands
```bash
# Next.js
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
npx vercel --prod

# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push
clasp version "説明"
# → GASエディタで「デプロイを管理」→バージョン更新（clasp deploy禁止）

# マスタ確認
curl -sL "GAS_URL?action=getMfAccounts&key=GAS_KEY"
curl -sL "本番URL/api/mf/masters" -H "x-api-key: INTERNAL_API_KEY"

# RAG推定テスト
curl -sL "本番URL/api/purchase/estimate-account?supplierName=XXX&itemName=YYY&totalAmount=ZZZ&department=DDD" -H "x-api-key: INTERNAL_API_KEY"

# GASエディタ手動実行: syncAllMfMasters, computeJournalStats, syncJournalHistoryFromMfAccounting
```

### Risks / Unknowns
- MF APIの`deductible_50`（2026/10〜50%控除期間）は現在enumになく、その時期のAPI仕様変更を要確認
- Claude Haiku APIのレート制限・コスト（1推定約$0.001、月100件で$0.1程度）
- GAS computeJournalStatsの実行時間（15K行集計で約5秒、6分制限内）
- 仕訳統計が古くなる問題（現在手動実行のみ、日次トリガー設定推奨）

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- 仕訳管理: https://next-procurement-poc-tau.vercel.app/admin/journals
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- GAS本番デプロイ: https://script.google.com/macros/s/AKfycbwrsEPItLW2TsqdmlMOzqYe6k120wbbp24XVYL3sc0wf1uaycTPrqU2cmwxUNri5iBSVA/exec
- 実装計画: .claude/plans/smooth-doodling-bumblebee.md

---

## [Handoff] "仕訳管理GASマスタ連携・デプロイ復旧" — 2026-04-04 19:39 (branch: master)

### Goal / Scope
- 仕訳データを証憑ベースに改修（金額・取引先・摘要）
- MFマスタを既存GASシート（取引先マスタ_MF・部門マスタ_MF）から取得する仕組みの構築
- MF OAuth期限管理・認証UIの追加
- やらないこと: GAS→DB移行（方針として不採用）

### Key decisions
- 仕訳金額: 証憑（OCR税込額）を正、発注データはフォールバック
- 再承認時: 差額仕訳→廃止、証憑金額で本仕訳1本（A案）
- 取引先解決: T番号→国税API→MFマスタ照合
- マスタ2層構成: 取引先・部門はGASシート直読、科目・税区分・PJ・補助科目はMF API+JSONキャッシュ
- ハードコードフォールバック削除: マスタ未読込時はテキスト入力
- 保存と登録を分離: 編集→GAS保存→MF会計仕訳登録の2ステップ

### Done
- [x] 仕訳金額を証憑ベースに変更、再承認時は保留→承認後に本仕訳作成
- [x] T番号→国税API→MFマスタ取引先照合
- [x] 摘要フォーマット改修、GAS登録にkatanaPo・budgetNumber追加
- [x] GASフィールド名を実カラム名に修正
- [x] MF OAuth cookie更新・期限通知・auth/status・認証バナー
- [x] 仕訳UI: 比較パネル、保存/登録分離、overrides対応
- [x] GAS webApi.js: 4アクション追加、clasp push、新デプロイ作成

### Pending
- [ ] GASデプロイのバージョン確認（v34か？）→ GASエディタで確認
- [ ] MFマスタがGASから読めるかの検証
- [ ] MF認証後のマスタ自動同期の動作確認
- [ ] 古いGASデプロイの整理

### Next actions
1. GASエディタで新デプロイのバージョンが34か確認、違えば更新
2. `/admin/journals`でDevTools Networkタブで`/api/mf/masters`レスポンス確認
3. MF認証→マスタ同期→科目・PJドロップダウン表示確認
4. 仕訳編集→保存→MF登録の一連フローテスト

### Risks / Unknowns
- clasp deployは権限設定を引き継がない（手動デプロイのみ安全）
- 旧デプロイID群が壊れている（新URL`AKfycbwrsEPI...`で復旧済み）
- GASデプロイのバージョンが未確認

### Links
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- GAS新デプロイ: https://script.google.com/macros/s/AKfycbwrsEPItLW2TsqdmlMOzqYe6k120wbbp24XVYL3sc0wf1uaycTPrqU2cmwxUNri5iBSVA/exec


## [Handoff] "MF会計マスタ動的取得・金額差異承認フロー完成" — 2026-04-04 11:25 (branch: master)

### Goal / Scope
- 前回Pendingの5項目（金額差異承認・証憑金額上書き・差額仕訳・ページ速度・ログ整理）を全消化
- 仕訳管理UIに証憑プレビュー+OCR結果バーを横並び表示
- MF会計PlusマスタデータをAPI経由で動的取得（6種: 科目・税区分・部門・補助科目・PJ・取引先）
- MF OAuth認証のトークンローテーション問題を解決（cookie永続化）
- やらないこと: GAS→DB移行（詳細ページ速度の根本対策）

### Key decisions
- **金額差異閾値**: 20%超 & ¥1,000超で再承認要求 — 軽微な差異は自動許容
- **差額仕訳科目**: 証憑>申請→雑損失、証憑<申請→仕入値引 — 経理標準に準拠
- **詳細ページキャッシュ**: Vercel KVではなくインメモリTTL 60秒 — 外部依存なし・即効性優先
- **MFマスタ取得**: ハードコード定数をフォールバックとして残しAPI優先 — MF未認証時も動作
- **MF OAuthトークン永続化**: Vercel env varではなくhttpOnly cookie — ローテーション自動追従
- **MF env var末尾\n**: CLIENT_ID・CLIENT_SECRETに改行混入が認証エラーの原因だった

### Done
- [x] 金額差異再承認フロー（Slackボタン送信・approve/rejectハンドラ）
- [x] 証憑金額で発注データ自動上書き（一致時は即時、差異承認時も上書き）
- [x] 差額仕訳の自動生成（`buildAmountDiffJournal` + MF会計API登録）
- [x] OCR診断ログ整理（成功時の冗長ログ削除）
- [x] 詳細ページ速度改善（`src/lib/cache.ts` TTLキャッシュ + `updateStatus`自動無効化）
- [x] 仕訳管理UIに証憑プレビュー+OCR結果バー横並び表示
- [x] MF会計マスタAPI `/api/mf/masters`（6種一括取得）
- [x] 仕訳管理UIのドロップダウンをマスタAPI動的取得に切替
- [x] MF OAuth: force再認証・callback→journals自動リダイレクト・cookie永続化
- [x] MF OAuth: env var末尾\n修正（CLIENT_ID・CLIENT_SECRET）
- [x] OpenAPI仕様書を `docs/api-specs/` にコピー・メモリに参照ルール保存

### Pending
- [ ] MF OAuthトークンの恒久的永続化（Vercel KV等への移行）— 現在はcookie依存
- [ ] GAS→DB移行（詳細ページの根本的速度改善）
- [ ] 送料等の追加費目をOCR明細から分離して別勘定で仕訳

### Next actions
1. `MF OAuth cookie有効期限管理` — 30日で切れるため、期限前の自動再認証 or KV移行を検討
2. `仕訳登録の実テスト` — /admin/journalsから実際にMF会計へ仕訳登録してマスタコード反映を確認
3. `GAS→Supabase移行` — 詳細ページ・一覧のGASフェッチ遅延の根本解決

### Affected files
- `src/lib/ocr.ts` — `requiresReapproval`フラグ追加、REAPPROVAL閾値定数
- `src/lib/slack.ts` — `sendAmountDiffApproval`, `handleAmountDiffApprove/Reject`, `buildAmountDiffJournal`呼出し
- `src/lib/mf-accounting.ts` — `buildAmountDiffJournal`, `getProjects`, MasterItem型拡張, SubAccountItem/fetchSubAccountsエクスポート
- `src/lib/mf-oauth.ts` — cookie永続化, フォールバック試行, saveTokensでprocess.env更新
- `src/lib/cache.ts` — 新規: インメモリTTLキャッシュ
- `src/lib/gas-client.ts` — `updateStatus`にキャッシュ自動無効化追加
- `src/app/api/mf/masters/route.ts` — 新規: 6種マスタ一括取得
- `src/app/api/mf/auth/route.ts` — force再認証パラメータ追加
- `src/app/api/mf/callback/route.ts` — cookie保存+journals自動リダイレクト
- `src/app/api/purchase/[prNumber]/status/route.ts` — キャッシュ層追加
- `src/app/admin/journals/page.tsx` — 証憑プレビュー+OCR結果バー、マスタ動的取得ドロップダウン
- `src/app/api/slack/events/route.ts` — 金額差異再承認ボタン送信、証憑金額で合計額上書き
- `docs/api-specs/` — MF会計Plus OpenAPI仕様書4ファイル

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
vercel --prod
# MF認証: ブラウザで /api/mf/auth?force=true → 自動リダイレクト
```

### Risks / Unknowns
- MF OAuthトークンはcookie（30日有効）依存 — ブラウザcookie削除で再認証必要
- MFリフレッシュトークンは1回使い切りローテーション — 並行リクエストで競合の可能性
- 差額仕訳の勘定科目（雑損失/仕入値引）がMF会計マスタに存在しない場合エラー

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- 仕訳管理: https://next-procurement-poc-tau.vercel.app/admin/journals
- MF認証: https://next-procurement-poc-tau.vercel.app/api/mf/auth?force=true
- MF API仕様: docs/api-specs/openapi*.yaml

---

## [Handoff] "証憑添付フロー完成・OCR修正・詳細ページ・金額差異フロー設計" — 2026-04-04 02:56 (branch: master)

### Goal / Scope
- 証憑添付→Bot返信→GAS更新→OCR金額照合→適格請求書検証の一連フローを完成させる
- OCR（Gemini）が動かない問題を修正し、読取データをスプレッドシートに反映
- My申請→個別詳細ページ（発注・検収・証憑アクション対応）を新規作成
- 金額差異発生時の承認フロー設計（次回実装対象）
- やらないこと: DB移行、MF会計仕訳の差額自動処理

### Key decisions
- **PO番号正規表現**: `PR-\d{4,}` → `PR-\d{6}-\d{1,4}` — 不完全マッチが根本原因だった
- **GAS「証憑種別」除外**: GAS allowedFieldsに未登録で更新全体が400エラーになっていた
- **Gemini 3 Flash Preview**: `gemini-2.0-flash` → `gemini-3-flash-preview` — 登録番号読取精度向上
- **OCRレスポンス配列対応**: Geminiが `[{...}]` で返すため先頭要素を抽出
- **国税庁API修正**: `id`=アプリケーションID, `number`=T付き14桁（T prefix必須）
- **GASフィールド名マッピング**: 証憑金額/金額照合/適格番号/税区分 → GASカラム名に合わせた
- **金額照合の税込変換**: GAS「合計額（税抜）」×(1+税率) でOCR税込金額と比較
- **maxDuration 60秒**: OCR+Drive+仕訳処理で10秒タイムアウトしていた
- **金額差異の再承認閾値**: 20%超 かつ 差額¥1,000以上で再承認要求（次回実装）
- **詳細ページのキャッシュ**: sessionStorage v2 で即時表示 + バックグラウンドGASフェッチ

### Done
- [x] 証憑添付フロー全修正（PO正規表現・GASフィールド・タイムアウト・フォールバック返信）
- [x] OCR修正（Gemini 3、配列対応、プロンプト強化、登録番号読取）
- [x] 適格請求書検証（国税庁API: NTA_APP_ID + T prefix 14桁）
- [x] 金額照合（税抜→税込変換、GASフィールド名対応）
- [x] OCR結果のGAS保存（証憑金額・金額照合・適格番号・税区分）
- [x] GAS allowedFields拡張（証憑種別/証憑金額/金額照合/適格番号/税区分/仕訳ID/Stage）
- [x] GAS recentRequests拡張（OCR・検収フィールド追加）
- [x] 個別詳細ページ `/purchase/[prNumber]` 新規作成
- [x] ステータス更新API `/api/purchase/[prNumber]/status` 新規作成
- [x] My申請カードをクリック可能に（詳細ページ遷移）
- [x] OPS通知チャンネル設定（SLACK_OPS_CHANNEL）
- [x] 全コミット・push済（3コミット: 5887493, 9574721, 0520210, 30e837a）

### Pending
- [ ] 金額差異時の承認フロー実装（20%超 & ¥1,000以上で再承認）
- [ ] 証憑金額で発注データ自動上書き（合計額を証憑ベースに更新）
- [ ] 送料等の追加費目をOCR明細から分離して別勘定で仕訳
- [ ] 詳細ページの表示速度改善（GASフェッチ遅延、根本的にはDB移行）
- [ ] デバッグログの最終整理（OCR result等の診断ログが残っている）
- [ ] GASの不要デプロイ整理（アーカイブ）

### Next actions
1. `金額差異承認フロー実装` — events/route.ts の照合結果に基づき、20%超&¥1,000超で申請者/上長にSlack確認ボタン送信
2. `証憑金額で発注データ上書き` — OCR金額をGAS「合計額（税抜）」に反映（subtotal使用）
3. `差額仕訳の自動生成` — 雑損失/仕入値引の調整仕訳をMF会計APIで作成
4. `詳細ページ速度改善` — GAS→Supabase移行 or Vercel KVキャッシュ層追加
5. `OCR診断ログ削除` — ocr.ts と events/route.ts の一時ログを削除してコミット

### Affected files
- `src/app/api/slack/events/route.ts` — 証憑添付ハンドラ全修正（PO正規表現:1064, OCR結果保存:1113-1167, 金額照合:1087-1101）
- `src/lib/ocr.ts` — Gemini 3モデル:8, 配列対応:117, プロンプト強化:43-79, 国税庁API:213-220, ダウンロードログ:304
- `src/app/purchase/[prNumber]/page.tsx` — 詳細ページ新規（キャッシュ即時表示+バックグラウンドGAS）
- `src/app/api/purchase/[prNumber]/status/route.ts` — ステータス更新API新規（GET/POST）
- `src/app/purchase/my/page.tsx` — カードクリック遷移、sessionStorageキャッシュ
- `src/lib/slack.ts` — notifyOpsデバッグログ削除
- `GAS webApi.js:487-492` — allowedFields拡張（証憑種別/証憑金額/金額照合/適格番号/税区分/仕訳ID/Stage）
- `GAS webApi.js:693-747` — recentRequests拡張（OCR・検収フィールド追加）

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
vercel --prod
# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push
# GASエディタから「新しいデプロイ」→ ウェブアプリ → 全員 → デプロイ
# 新URLをVercel env GAS_WEB_APP_URL に設定 → vercel --prod --force
```

### Risks / Unknowns
- 詳細ページのGASフェッチ遅延（3-5秒）が目立つ — DB移行が根本解決だが大規模変更
- GAS新デプロイのたびにURL変更+Vercel再デプロイが必要 — 運用負荷が高い
- 金額差異の再承認フロー未実装 — Slackボタンハンドラの追加が必要
- OCR読取精度はGemini依存 — 手書き領収書等では精度低下の可能性
- `after()` の信頼性 — Next.js 16 + Vercelでは動作するが、エッジケースあり

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- 詳細ページ例: https://next-procurement-poc-tau.vercel.app/purchase/PR-202604-0004
- GASスプレッドシート: https://docs.google.com/spreadsheets/d/1gqUdC60X0eIPsjKQOKwYAmJFqRv_AkDjtokybhSVVb8/edit
- GAS Apps Script: https://script.google.com/u/0/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- 現在のGAS Web App URL: https://script.google.com/macros/s/AKfycbxp466YYIG72Bt44CYtsfepuZmoudyrCBVfKsLdexKgZ_fueGqniEcEEQTQYtUNnBFg/exec

---

## [Handoff] "GASテストシート切替・Slack連携テスト・証憑添付デバッグ" — 2026-04-03 16:45 (branch: master)

### Goal / Scope
- GAS購買管理の書込先を本番シートからテスト用シート（`購買管理_test`）に切替
- Next.js Web申請 → GAS → スプレッドシートのE2Eテスト
- Slack `/purchase` コマンド → 承認 → 検収 → 証憑添付のフロー動作確認
- やらないこと: Web側での承認〜検収ステータス操作UI（次タスク）

### Key decisions
- **GAS CONFIG.SHEET_PROCUREMENT を `購買管理_test` に変更** — 本番シート保護のため
- **支払方法「会社カード」→「MFカード」に全箇所統一** — MFビジネスカード運用に合わせて
- **証憑ステータス初期値: 購入前は `-`** — 購入前は証憑不要、検収後に「要取得」へ遷移
- **添付ラベル: 購入前は「添付資料（見積書・発注書ドラフト等）」** — 証憑は検収後
- **`clasp deploy -i` は使わず、GASエディタから新規デプロイ** — `-i` だとアクセス権限リセットされる
- **overallStatus判定: `voucherStatus !== "添付済"` で証憑待ち判定** — `-` も含めるため

### Done
- [x] GAS `購買管理_test` / `予測カード明細_test` シート切替（main.js, webApi.js）
- [x] テストシート自動作成（本番ヘッダーコピー）
- [x] clasp push + GASエディタで新規デプロイ（v20）
- [x] Vercel環境変数更新（GAS_WEB_APP_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_PURCHASE_CHANNEL）
- [x] 支払方法「会社カード」→「MFカード」全ソース変更
- [x] 購入前の証憑ステータス初期値 `-` に変更（GAS webApi.js）
- [x] 添付ファイルラベル変更（purchase/new/page.tsx）
- [x] KATANA PO番号をGASに送信（submit/route.ts → poNumber）
- [x] 承認者名をGASに送信（submit/route.ts → approver）
- [x] 共通ナビゲーションバー追加（layout.tsx）
- [x] overallStatus判定修正（purchase/my, dashboard）
- [x] file_shared イベント検知の条件緩和（events/route.ts:298-320）
- [x] Slack `/purchase` → 承認 → 検収フロー動作確認OK
- [x] Web申請 → GAS `購買管理_test` 書込み確認OK

### Pending
- [ ] 証憑添付後のBot返信が来ない — `after()` 内の `handleFileSharedInThread` がサイレント失敗
- [ ] Web側で承認・発注完了・検収完了のステータス操作UI追加
- [ ] スプレッドシートスキーマ新カラム追加（GAS手動）
- [ ] 未コミットの変更をコミット・push
- [ ] GASの不要デプロイ整理（アーカイブ）

### Next actions
1. `handleFileSharedInThread` のデバッグ — `after()` 内のエラーをログ出力してVercelログで確認（events/route.ts:298-320）
2. `after()` の代わりに同期処理でテストし、エラー内容を特定
3. 証憑添付 → GASステータス更新 → Slack返信の一連フロー修正
4. Web側ステータス操作UI: `/purchase/my` に承認・発注・検収ボタン追加
5. 変更をコミット・push・Vercelデプロイ
6. 仕訳管理画面のE2Eテスト（証憑添付完了後）

### Affected files
- `src/app/api/slack/events/route.ts:298-320` — file_shared検知条件の緩和・ログ追加
- `src/app/api/purchase/submit/route.ts:136-168` — 承認者名・KATANA PO送信追加
- `src/app/purchase/new/page.tsx:1231,1648-1664` — MFカード選択肢・添付ラベル変更
- `src/app/purchase/my/page.tsx:51` — overallStatus証憑判定修正
- `src/app/dashboard/page.tsx:34` — overallLabel証憑判定修正
- `src/app/layout.tsx:28-46` — 共通ナビゲーションバー追加
- `src/app/admin/journals/page.tsx:22` — CREDIT_MAP MFカード
- `src/lib/slack.ts` — MFカード置換
- `src/lib/mf-accounting.ts` — MFカード置換
- `src/app/mock/journals/page.tsx` — MFカード置換
- GAS: `Procurement-Assistant/src/gas/main.js:24` — SHEET_PROCUREMENT → 購買管理_test
- GAS: `Procurement-Assistant/src/gas/webApi.js:893` — PREDICTION_SHEET_NAME → 予測カード明細_test
- GAS: `Procurement-Assistant/src/gas/webApi.js:273-281` — 証憑ステータス初期値変更

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
vercel --prod
# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push
# GASエディタから「新しいデプロイ」→ ウェブアプリ → 全員 → デプロイ
# 新URLをVercel env GAS_WEB_APP_URL に設定 → vercel --prod
```

### Risks / Unknowns
- `after()` 内のエラーがVercelログに出ない場合がある — 同期処理に切り替えてデバッグ必要
- GAS新デプロイのたびにURL変更+Vercel再デプロイが必要 — 運用負荷
- `file_shared` イベントの `thread_ts` がない場合のスレッド特定方法
- Slack OPS_CHANNEL 未設定でOPS通知がサイレント失敗している可能性

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- GASスプレッドシート: https://docs.google.com/spreadsheets/d/1gqUdC60X0eIPsjKQOKwYAmJFqRv_AkDjtokybhSVVb8/edit
- GAS Apps Script: https://script.google.com/u/0/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- Slack App: https://api.slack.com/apps/A0AN1D89XDX
- 現在のGAS Web App URL: https://script.google.com/macros/s/AKfycbzZiMUrzD92LyL0oZaVAy3JqPMy68OQTd1f3qDkBj0DIJj1gR0zHgbkPIX5-qtMJDaK7Q/exec

## [Handoff] "MFカード統一運用・適格請求書管理・概算緊急フロー実装" — 2026-04-03 09:42 (branch: master)

### Goal / Scope
- 出張手配・購買を「会社メール個人アカウント + MFビジネスカード（物理+バーチャル）」で統一する運用設計
- 適格請求書（インボイス）管理の仕組み実装（OCR結果のGAS保存・免税事業者控除率警告）
- 概算フロー・緊急事後報告フローのSlackモーダル＋予測レコード対応
- カード照合時の概算差額検知・未報告カード利用の社員DM通知
- やらないこと: GASスプレッドシートのカラム追加（手動）、管理画面UIへの新項目反映 ← **次のタスク**

### Key decisions
- **法人契約なし（案A）を推奨** — 全サービス個人アカウント+MFカード統一
- **PJ紐付けは既存の /trip + HubSpot案件番号で解決済み**
- **カード払いでも取引先コードを設定** — 適格請求書の発行元管理のため
- **JCSの「与信審査不要」は誤り** — リクルート所定の審査あり（JCS_detail p11）
- **全社員にMFカード（物理+バーチャル）配布が前提**
- **緊急時こそMFカード** — 現金立替より管理容易

### Done
- [x] 提案書・PPT 13枚（docs/travel-services/）
- [x] /purchase: 概算フラグ・緊急事後報告・購入日・緊急理由追加
- [x] /trip: 概算フラグ追加
- [x] 予測レコードに is_estimate, is_post_report, emergency_reason 追加
- [x] 事後報告の処理分岐（事後承認DM・OPS通知）
- [x] カード払いでも取引先コード設定（mf-accounting.ts）
- [x] OCR結果の適格請求書情報をGASに保存
- [x] 免税事業者の経過措置控除率警告（ocr.ts）
- [x] 概算差額検知（card-matcher.ts ±20%/±5,000円）
- [x] 未報告カード利用の社員DM通知

### Pending
- [ ] **GASスプレッドシート+UIの一括設計**（次のタスク）
- [ ] GASに新カラム7項目追加（手動）
- [ ] /admin/journals, /purchase/my, ダッシュボードに新項目反映
- [ ] コミット・デプロイ

### Next actions
1. GASスプレッドシート+UIの一括設計
2. /admin/journals に概算・事後報告・適格請求書ステータス表示
3. GASスプレッドシートにカラム追加
4. コミット・デプロイ

### Affected files
- `src/lib/slack.ts`, `src/app/api/slack/events/route.ts`, `src/lib/prediction.ts`, `src/lib/gas-client.ts`, `src/lib/ocr.ts`, `src/lib/mf-accounting.ts`, `src/lib/card-matcher.ts`, `src/app/api/admin/card-matching/execute/route.ts`, `src/app/api/cron/card-reconciliation/route.ts`, `scripts/gen_pptx.py`, `docs/travel-services/`

### Repro / Commands
```bash
npx tsc --noEmit && npm run build  # ビルド確認済み
python scripts/gen_pptx.py         # PPT再生成
```

---

## [Handoff] "出張手配サービス検討・仕訳管理UI・MF取引先連携・一部返品対応" — 2026-04-01 12:43 (branch: master)

### Goal / Scope
- システム全体精査 → Tier 1-4改善、仕訳管理UI、MF API修正・取引先連携、一部返品、出張手配比較
- やらないこと: MF認証実施、手動設定14項目、E2Eテスト

### Done
- [x] Tier 1-4 全改善（セキュリティ・整合性・UX・新機能）
- [x] 仕訳管理UI（/admin/journals）— 編集・証憑プレビュー・一括登録
- [x] MF API仕様準拠（致命的バグ3件）+ 取引先マスタ連携
- [x] 一部返品（数量指定モーダル・按分取消仕訳）
- [x] 出張手配比較メモ（docs/travel-services/comparison.md）

### Pending
- [ ] 出張手配推奨案4の資料作成（JCS+ANA Biz/JAL直）← **中断箇所**
- [ ] MF会計Plus OAuth初回認証
- [ ] 手動設定14項目 / E2Eテスト / Vercel GitHub連携

### Next actions → docs/handoffs/handoff-20260401-1243-master.md 参照

---

## [Handoff] "セキュリティ強化・整合性検証・税区分修正・Vercel法人移行・Slack動作確認" — 2026-03-30 17:04 (branch: master)

### Goal / Scope
- セキュリティ監査（OWASP Top 10）→ P0/P1/P2の全項目対応
- 設計書・マニュアル vs 実装の整合性検証 → 抜け漏れ修正
- 消費税区分を科目マスタCSV（FS税区分）に準拠
- Vercel法人チーム（futurestandard）への移行・デプロイ・Slack動作確認

### Done
- [x] セキュリティ: API認証(14ルート)、タイムアウト(17箇所)、GASリトライ、OAuth CSRF防止
- [x] カード照合差額調整仕訳、出張予測レコード、返品取消仕訳、部分検収
- [x] 消費税区分修正（共-課仕/課仕）、OCR税率→仕訳反映、研究開発費→課仕
- [x] Vercel futurestandard移行、環境変数17件設定、/purchase動作確認

### Pending
- [ ] 手動設定14項目（従業員マスタ、clasp push、GCP認証等）
- [ ] SLACK_DEFAULT_APPROVER / SLACK_ADMIN_MEMBERS / Google Drive環境変数
- [ ] Vercel GitHub連携、E2Eテスト

### Next actions → docs/handoffs/handoff-20260330-1704-master.md 参照

---

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

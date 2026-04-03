# [Handoff] "GASテストシート切替・Slack連携テスト・証憑添付デバッグ" — 2026-04-03 16:45 (branch: master)

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

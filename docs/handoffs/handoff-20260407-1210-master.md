## [Handoff] "Web購買システム機能追加・パフォーマンス改善・権限制御・本番テスト分離" — 2026-04-07 12:10 (branch: master)

### Goal / Scope
- 7件バグ修正 + パフォーマンス改善 + 権限制御(RBAC) + Web UIステータス管理 + 承認ルート設定 + 本番/テスト分離
- やらないこと: E2Eテスト、Slack OAuth認証

### Key decisions
- 権限判定: 従業員マスタの`departmentName === "管理本部"`でisAdmin判定
- 本番/テスト分離: webApi.jsに`WEBAPI_SHEET = '購買管理_test'`を独立定義
- TEST_MODE: 全DM送信をプライベートチャンネルにリダイレクト（safeDmChannel関数）
- clasp deploy禁止: clasp pushのみ、デプロイはGASエディタ手動

### Done
- [x] 7件バグ修正（MF取引先、固定資産判定、未処理タスク、HubSpot PJ、仕訳管理フィルタ、申請取消、Botスレッド）
- [x] パフォーマンス改善（Promise.all、GASキャッシュ、MFキャッシュバグ修正）
- [x] RBAC（UserContext、ナビ出し分け、ページガード、データフィルタ）
- [x] Web UIステータス管理（承認/差戻し/発注完了/検収完了/証憑UP/取消）
- [x] 承認ルート設定ページ + GAS API
- [x] 従業員マスタ全員のSlack ID・英語名別名一括設定
- [x] 本番/テスト分離（WEBAPI_SHEET、TEST_MODE、safeDmChannel、CLAUDE.md明記）

### Pending
1. スプレッドシート`購買管理_test`に「概算」「事後報告」列ヘッダー手動追加
2. GASエディタで新デプロイ → Vercel GAS_WEB_APP_URL更新
3. 概算申請・事後報告のテスト

### Next actions
1. スプレッドシートに「概算」「事後報告」列追加
2. GAS新デプロイ → URL更新 → Vercelデプロイ
3. 概算・事後報告のE2Eテスト
4. 承認ルート設定テスト
5. 適格請求書を仕訳管理ページへ移動

### Affected files
- `src/lib/user-context.tsx`, `src/app/layout-client.tsx` — 新規
- `src/app/admin/approval-routes/page.tsx`, `src/app/api/admin/approval-routes/route.ts` — 新規
- `src/app/purchase/new/page.tsx`, `dashboard/page.tsx`, `my/page.tsx`, `[prNumber]/page.tsx` — 権限+フィルタ
- `src/lib/slack.ts` — TEST_MODE, safeDmChannel
- `src/lib/gas-client.ts` — キャッシュ追加
- `Procurement-Assistant/src/gas/webApi.js` — WEBAPI_SHEET分離、フィルタ改善

### Repro / Commands
```bash
npx vercel --prod  # Next.jsデプロイ
cd Procurement-Assistant/src/gas && echo y | clasp push  # GASコード反映（deploy禁止！）
```

### Risks / Unknowns
- GASプロジェクトがgit管理なし → clasp push時のmain.js誤変更リスク
- UserContext認証がlocalStorageフォールバック → 本番運用にはSlack OAuth必要

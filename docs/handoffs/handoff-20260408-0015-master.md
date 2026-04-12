## [Handoff] "カラム構成リニューアル＋推定ロジック再設計" — 2026-04-08 00:15 (branch: master)

### Goal / Scope
- 購買管理_testシートのカラムを業務フロー順に再構成（41→40列）
- Web申請画面のラベルとシート列名を完全一致させる
- 購買番号の採番を本番/テストで分離
- 勘定科目推定ロジックの再設計（証憑添付時に集約）
- やらないこと: 本番(購買管理)シート・main.jsの変更、Supabase移行

### Key decisions
- 金額は税込統一（MF会計Plus準拠）。旧: 税抜
- 購買番号の採番: webApi.js内に`generatePrNumberForWebApi()`を新設、WEBAPI_SHEETから独立採番
- Slackリンク列を廃止。Webが原本、スレッドTSのみ残す
- 備考に混在していた「購入品の用途」「購入理由」「[Web申請]」を独立列に分離
- Amazon注文照合: シート列から削除→仕訳管理のCSVアップロード機能に移行（後続タスク）
- MF会計（計上済）列を廃止。MF仕訳IDの有無で動的判定
- 勘定科目推定: 申請時のルールベース推定を廃止→証憑添付時のRAG推定に一本化（未実装）
- 伊澤(U04FBAX6MEK)にSlack全承認権限付与（DEV_ADMIN_SLACK_ID）

### Done
- [x] 購買番号の採番分離（generatePrNumberForWebApi）
- [x] カラム名リネーム: 種別→申請区分、購入先→購入先名、PO番号→KATANA PO番号 等
- [x] 新列追加: 検収者、購入理由、差戻し理由、取消日、MF仕訳ID
- [x] 削除列: 次のアクション、Amazon注文照合、Slackリンク、受取場所、使用場所、納品予定日、MF会計（計上済）
- [x] webApi.js: setCol/headers.indexOf/allowedFieldsを全更新
- [x] gas-client.ts: registerPurchaseにinspector追加、slackLink削除
- [x] submit/route.ts: inspector渡し、slackLink除去、スレッドTS更新修正
- [x] purchase/[prNumber]/page.tsx: 全列名参照更新、Slackリンク表示削除
- [x] purchase/my/page.tsx: slackLink参照削除
- [x] dashboard/page.tsx: slackLink→詳細ページリンクに変更
- [x] journals/page.tsx: PO番号→KATANA PO番号、HubSpot/案件名→HubSpot案件番号
- [x] slack/events/route.ts: スレッドTS更新をスプレッドシート列名に合わせて修正
- [x] mf/journal/route.ts: 仕訳ステータス→MF仕訳IDに変更
- [x] 申請確認画面から勘定科目推定表示を削除
- [x] setupWebApiHeaders関数作成・実行（40列ヘッダー設定）
- [x] Slack承認権限: 伊澤に全操作権限付与（5箇所）
- [x] GAS新デプロイ + Vercelデプロイ完了

### Pending
1. **勘定科目推定ロジック再設計**（承認済み、未実装）
   - submit/route.tsからestimateAccount呼び出しを削除
   - 証憑添付時（slack/events, upload-voucher）にestimateAccountFromHistory呼び出し追加
   - journals/page.tsxに再推定ボタン追加

### Next actions
1. submit/route.tsから`estimateAccount`呼び出しを削除、`accountTitle`を空で送る
2. slack/events/route.tsの証憑OCR後に`estimateAccountFromHistory`呼び出し＋GAS保存を追加
3. upload-voucher/route.tsにも同様のRAG推定を追加
4. journals/page.tsxに再推定ボタンを追加（経理が手動で再推定可能に）
5. estimate-account/route.ts（確認画面用API）を削除 or 無効化
6. Amazon CSV照合機能を仕訳管理ページに実装（後続タスク）
7. GASレスポンス改善の検討

### Affected files
- `Procurement-Assistant/src/gas/webApi.js` — 列名全更新、setupWebApiHeaders追加、generatePrNumberForWebApi追加
- `src/lib/gas-client.ts` — registerPurchaseにinspector追加、slackLink削除
- `src/lib/slack.ts` — DEV_ADMIN_SLACK_ID追加、5箇所の権限チェック修正
- `src/app/api/purchase/submit/route.ts` — inspector渡し、slackLink除去
- `src/app/api/slack/events/route.ts` — スレッドTS列名修正
- `src/app/api/mf/journal/route.ts` — MF仕訳ID列名修正
- `src/app/purchase/[prNumber]/page.tsx` — 全列名更新
- `src/app/purchase/my/page.tsx` — slackLink削除
- `src/app/purchase/new/page.tsx` — 勘定科目推定表示削除
- `src/app/dashboard/page.tsx` — slackLink→詳細ページリンク
- `src/app/admin/journals/page.tsx` — 列名更新

### Repro / Commands
```bash
npx vercel --prod  # Next.jsデプロイ
cd Procurement-Assistant/src/gas && echo y | clasp push  # GASコード反映
# GASエディタから setupWebApiHeaders 実行でヘッダーリセット
# GASエディタから新デプロイ → Vercel GAS_WEB_APP_URL更新
```

### Risks / Unknowns
- GASデプロイURL変更のたびにVercel環境変数更新が必要（今回4回変更）
- clasp pushだけではWeb Appに反映されない（新デプロイ必須）を再確認
- 証憑添付時のRAG推定がClaude API呼び出しを伴うためレイテンシ増加の可能性
- 旧データとの互換性: 購買管理_testはクリア済みだが、本番移行時は列マッピング変換が必要

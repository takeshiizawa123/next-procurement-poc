# [Handoff] "仕訳管理GASマスタ連携・デプロイ復旧" — 2026-04-04 19:39 (branch: master)

### Goal / Scope
- 仕訳データを証憑ベースに改修（金額・取引先・摘要）
- MFマスタを既存GASシート（取引先マスタ_MF・部門マスタ_MF）から取得する仕組みの構築
- MF OAuth期限管理・認証UIの追加
- やらないこと: GAS→DB移行（方針として不採用）

### Key decisions
- **仕訳金額**: 証憑（OCR税込額）を正とし、発注データはフォールバック
- **再承認時**: 差額仕訳→廃止、証憑金額で本仕訳1本に変更（A案）
- **取引先解決**: T番号→国税API→MFマスタ照合の優先順
- **摘要**: `年月 PO番号 予算番号 KATANA_PO 品名` 形式
- **マスタ2層構成**: 取引先・部門はGASシート直読（認証不要）、科目・税区分・PJ・補助科目はMF API+JSONキャッシュ
- **ハードコードフォールバック削除**: FALLBACK_ACCOUNTS等を完全削除、マスタ未読込時はテキスト入力
- **保存と登録を分離**: 編集→GAS保存→MF会計仕訳登録の2ステップ

### Done
- [x] 仕訳金額を証憑ベースに変更（全3箇所: slack/events, mf/journal, slack.ts）
- [x] 再承認時に仕訳保留→承認後に証憑金額で本仕訳作成
- [x] T番号→国税API→MFマスタ取引先照合（GAS「MF取引先」カラムに保存）
- [x] 摘要フォーマット改修（buildJournalFromPurchaseにitemName/katanaPo/budgetNumber追加）
- [x] GAS登録にkatanaPo・budgetNumber追加
- [x] GASフィールド名を実カラム名に修正（品目名・PO番号・予算番号・MF取引先等）
- [x] MF OAuth cookie毎回更新・期限7日前Slack通知・auth/statusエンドポイント
- [x] 仕訳管理UIにMF認証バナー（mastersErrorから判定）
- [x] 仕訳プレビューに発注/証憑比較パネル
- [x] 仕訳登録ボタンを展開パネル内に移動（金額明示）
- [x] 保存/登録ボタン分離（PUT /api/purchase/[prNumber]/status追加）
- [x] /api/mf/journal: overridesパラメータで編集内容反映
- [x] GAS webApi.js: getMfCounterparties/getMfDepartments/getMfMasters/saveMfMasters追加
- [x] clasp push + 新デプロイ作成（v34、URL更新済み）

### Pending
- [ ] **GASデプロイのバージョン確認**: 手動デプロイ時にv34が選択されたか未確認。GASエディタで「デプロイを管理」→新デプロイのバージョンが34か確認
- [ ] **MFマスタがGASから読めるかの検証**: `/api/mf/masters`がGAS取引先・部門を返すか、ブラウザコンソールで確認
- [ ] MF認証後のマスタ自動同期（/api/mf/masters/sync）の動作確認
- [ ] 勘定科目・税区分・PJ・補助科目のJSONキャッシュ（MFマスタシート）動作確認
- [ ] 古いGASデプロイの整理（壊れたデプロイIDの削除）

### Next actions
1. GASエディタで新デプロイ(`AKfycbwrsEPI...`)のバージョンが34か確認。違えば34に更新して再デプロイ
2. `/admin/journals`をリロードし、ブラウザDevToolsのNetworkタブで`/api/mf/masters`のレスポンスを確認
3. レスポンスにcounterparties/departmentsがあればGAS連携成功。なければGASログ（実行数→webApi.js）を確認
4. MF認証ボタンで認証→マスタ同期トリガー→科目・税区分・PJのドロップダウンが動的表示されるか確認
5. 仕訳編集→保存→MF仕訳登録の一連フローを実データでテスト

### Affected files
- `src/lib/mf-oauth.ts` — saveTokens cookie更新、checkCookieExpiry、getAuthStatus
- `src/lib/mf-accounting.ts:373` — buildJournalFromPurchase（itemName/katanaPo/budgetNumber/摘要改修）
- `src/lib/gas-client.ts:420-450` — getGasCounterparties/getGasDepartments/saveMfMasters/getMfMasters
- `src/lib/slack.ts:1047-1090` — handleAmountDiffApprove（差額仕訳→本仕訳に変更）
- `src/app/api/slack/events/route.ts:1082-1300` — 証憑金額優先、再承認保留、国税API名保存
- `src/app/api/mf/masters/route.ts` — GASシート優先→MF APIフォールバック
- `src/app/api/mf/masters/sync/route.ts` — 新規: 科目・税区分・PJ・補助科目をGASにJSON保存
- `src/app/api/mf/journal/route.ts` — overrides対応、証憑金額優先、国税API名優先
- `src/app/api/mf/auth/status/route.ts` — 新規: 認証状態確認
- `src/app/api/mf/callback/route.ts` — マスタ同期バックグラウンド実行
- `src/app/api/purchase/[prNumber]/status/route.ts` — PUT追加（仕訳編集保存用）
- `src/app/admin/journals/page.tsx` — 比較パネル、認証バナー、保存/登録分離、マスタドロップダウン
- `Procurement-Assistant/src/gas/webApi.js` — GAS側4アクション追加

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
npx vercel --prod

# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
clasp push
# ※ clasp deployは権限が消えるので手動デプロイ必須

# GAS新デプロイURL
# https://script.google.com/macros/s/AKfycbwrsEPItLW2TsqdmlMOzqYe6k120wbbp24XVYL3sc0wf1uaycTPrqU2cmwxUNri5iBSVA/exec

# Vercel GAS_WEB_APP_URL は上記URLに更新済み
```

### Risks / Unknowns
- **clasp deployは権限設定を引き継がない**: `clasp deploy -i`で既存デプロイを更新すると「全員がアクセス可能」設定が消える。GASエディタから手動デプロイのみ安全
- **旧デプロイID群が壊れている可能性**: `clasp deploy -i`で7つの既存デプロイを更新した結果、全て「ページが見つかりません」になった。新デプロイ`AKfycbwrsEPI...`で復旧済みだが、Slackボット等が旧URLを参照している場合は要確認
- **GASデプロイのバージョン未確認**: 手動デプロイ時にv34が選択されたか不明。古いバージョンだとgetMfCounterparties等のアクションが存在しない

### Links
- 本番: https://next-procurement-poc-tau.vercel.app
- 仕訳管理: https://next-procurement-poc-tau.vercel.app/admin/journals
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit
- GAS新デプロイ: https://script.google.com/macros/s/AKfycbwrsEPItLW2TsqdmlMOzqYe6k120wbbp24XVYL3sc0wf1uaycTPrqU2cmwxUNri5iBSVA/exec

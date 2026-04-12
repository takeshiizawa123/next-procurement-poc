## [Handoff] "Slack購買申請フォーム改善 + 下書き保存機能" — 2026-04-05 21:47 (branch: master)

### Goal / Scope
- Slack購買申請モーダルのUX問題7件を修正 + 仕訳統計のremarkAccounts修正
- 新規要望: 申請の下書き保存・再開機能
- やらないこと: E2Eテスト、Phase 2/3のRAG統計改善

### Key decisions
- remarkAccountsが0件だった原因: MF APIからremark取得済だがシート未同期 → syncJournalHistory再実行+extractItemFromRemark_修正で1007件に
- 50000文字セル上限 → writeLargeJson_/readLargeJson_で分割保存に対応
- 購入先マスタ: static_select → 検索不可で使いにくいため plain_text_input に戻した
- 金額フィールドラベル: 「金額（税込・円）」→「単価（税込・円）」に変更

### Done
- [x] remarkAccounts修正（extractItemFromRemark_: MF摘要をそのまま品名として返す）
- [x] 仕訳統計JSON分割保存（writeLargeJson_/readLargeJson_）
- [x] 数量input: plain_text_input → number_input（min_value/initial_value削除済）
- [x] 固定資産判定: estimateAccount()にunitPriceパラメータ追加、単価ベース判定
- [x] 固定資産通知: actionValueに7番目フィールドunitPrice追加、parseActionValue対応
- [x] 承認画面メッセージ: 「単価10万円以上」に変更
- [x] 購入理由: hint改善+記載例+サーバーバリデーション（PO/HubSpot/予算番号あれば省略可）
- [x] notifyOps: blocks引数追加、固定資産通知をBlock Kit化
- [x] safeUpdateStatus: エラー原因をSlackスレッドに表示
- [x] gas-client: console.warn → console.error
- [x] GAS webApi: 列未発見時の警告ログ追加
- [x] Botスレッド分裂: actualThreadTs探索ロジック追加
- [x] 金額比較: 税抜同士で比較（3%以内なら一致とみなす）
- [x] Vercel deploy + GAS push 完了

### Pending — 深く調査してから対応すべき問題
- [ ] **数量入力UX未検証**: number_inputでmin_value削除後、Slackの挙動（空欄許可？送信時バリデーション？）を実機確認必要
- [ ] **購入理由が必須のまま？**: optional:trueなのにユーザーが必須と感じている。サーバーバリデーションが誤発火している可能性。formData.katanaPo/hubspotDealId/budgetNumberのパース結果をログで確認すべき
- [ ] **AI推定がまだ固定資産**: 数量1で入力すると unitPrice=totalAmount のため当然固定資産になる。数量入力が正しく動けば解決するが、AI推定プロンプト自体も「税抜単価約997,500円」と総額を単価と誤認している可能性あり
- [ ] **金額不一致（税込/税抜）**: 申請¥940,500 vs 証憑¥1,097,250。税抜比較ロジックを追加したが、実データでの検証未完了
- [ ] **MF会計との金額体系統一**: MF会計は税込+税額。申請フォームも税込にすべき（ラベル変更済だがGAS側の「合計額（税抜）」列との整合性が未確認）
- [ ] **下書き保存・再開機能（新規要望）**: Slackモーダルのprivate_metadataまたはGASシートに下書きを保存し、再開時にモーダルにプリフィルする仕組み

### Next actions
1. **全Slackモーダルフィールドの挙動を実機検証**: number_input(min_valueなし)、optional:trueの購入理由、パーサーの出力をVercelログで確認
2. **formData のデバッグログ追加**: route.ts の handlePurchaseSubmission 冒頭で formData を console.log し、各フィールドの値を確認
3. **AI推定プロンプト修正**: unitPrice が totalAmount と同じ場合（数量1）でも「これは総額であり単価不明」と明示するロジック検討
4. **GAS「合計額（税抜）」列の扱い統一**: 申請時に税込金額を保存するか、比較時に税込変換するか方針決定
5. **下書き保存機能の設計**: GASシートに「下書き」ステータスの行を作るか、Slackのprivate_metadata+DBか
6. **全問題の修正後に1回だけテスト**: 中途半端な修正でテストを繰り返さない

### Affected files
**Next.js（変更済）**:
- `src/lib/slack.ts` — parseActionValue(unitPrice追加)、buildActionValue、handleInspection(固定資産単価判定)、notifyOps(blocks引数)、safeUpdateStatus(エラー詳細化)、buildPurchaseModal(数量number_input、金額ラベル、購入理由hint)
- `src/lib/account-estimator.ts:86-148` — estimateAccount(unitPrice引数追加、assetJudgeAmount)
- `src/lib/account-estimator.ts:256-300` — callClaudeForEstimation(unitPrice+プロンプト改善)
- `src/lib/account-estimator.ts:354-416` — estimateAccountFromHistory(unitPriceパススルー)
- `src/app/api/slack/events/route.ts:749-800` — handlePurchaseSubmission(totalAmount計算、unitPrice追加)
- `src/app/api/slack/events/route.ts:1054-1095` — handleFileSharedInThread(actualThreadTs探索)
- `src/app/api/slack/events/route.ts:1130-1150` — 金額比較(税抜同士比較)
- `src/app/api/purchase/estimate-account/route.ts:21-29` — unitPriceパラメータ追加
- `src/app/api/purchase/submit/route.ts:133` — estimateAccount呼び出しにunitPrice追加
- `src/app/purchase/new/page.tsx:333` — 固定資産メッセージ「単価10万円以上」
- `src/lib/gas-client.ts:58,116` — console.warn → console.error

**GAS（Procurement-Assistant、clasp push済）**:
- `src/gas/mfAccountingApi.js:522-538` — extractItemFromRemark_(MF摘要をそのまま返す)
- `src/gas/mfAccountingApi.js:674-697` — writeLargeJson_(分割保存)、readLargeJson_(分割読取)
- `src/gas/webApi.js:569-577` — handleUpdate(列未発見警告ログ)

### Repro / Commands
```bash
# Next.js deploy
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx vercel --prod

# GAS push
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push

# TypeScript check
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
```

### Risks / Unknowns
- number_input(min_valueなし)のSlack実機挙動が未確認（空欄送信でエラーになる可能性）
- 購入理由バリデーションが formData のパース結果に依存。katanaPo等が空文字で返されていると hasReference=false になり常に必須扱い
- 金額比較の税抜同士ロジックがエッジケースで誤判定する可能性
- 下書き保存機能はSlackモーダルの制約（private_metadata 3000文字上限）により設計の検討が必要

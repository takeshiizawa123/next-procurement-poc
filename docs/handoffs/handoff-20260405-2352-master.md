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

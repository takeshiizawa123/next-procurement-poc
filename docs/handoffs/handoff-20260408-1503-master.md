## [Handoff] "勘定科目RAG改善 + Slack連動 + パフォーマンス最適化" — 2026-04-08 15:03 (branch: master)

### Goal / Scope
- 勘定科目推定を「申請時ルールベース」→「証憑添付時RAG（過去仕訳原票ベース）」に再設計
- Web操作時にSlackメッセージのステータス表示を連動更新
- 全ページのGAS起因の読み込み遅延を大幅改善
- やらないこと: 本番(購買管理)シート・main.jsの変更、DB移行

### Key decisions
- 申請時の勘定科目推定を廃止（submit/route.ts, slack/events/route.ts）→ 証憑添付時にRAG推定
- RAGコンテキストを集計統計→過去仕訳原票パススルーに変更（品目ごとの科目判断が可能に）
- GASに`cacheResolvedJournals`（11,706行キャッシュ）+ `searchJournalRows`（取引先・品名検索）追加
- GASに`getMastersBundle`追加（6回のGAS往復→1回に統合）
- CDN `s-maxage` + `stale-while-revalidate` ヘッダーで主要APIをVercel Edgeキャッシュ
- 4分間隔のcronキャッシュウォーマーでCDNを常にfreshに維持
- クライアント側localStorage SWRキャッシュ（5分fresh / 30分stale）
- UserProviderをlocalStorageから即時復元に変更（GAS待ちなしでuser.loaded=true）
- 操作後（申請・承認・証憑アップ等）にSWRキャッシュを明示的にinvalidate

### Done
- [x] submit/route.ts, slack/events/route.tsからestimateAccount削除、accountTitle空で送信
- [x] 証憑添付時（slack/events, upload-voucher）にestimateAccountFromHistory呼び出し＋GAS保存
- [x] estimate-account/route.tsをPOST再推定API専用に変更
- [x] journals/page.tsxに「AI」再推定ボタン追加
- [x] GAS: cacheResolvedJournals + searchJournalRows + getMastersBundle
- [x] account-estimator.ts: buildContextを原票パススルー方式に差し替え
- [x] Web操作→Slackメッセージ書き換え（updateSlackMessageForWebAction）
- [x] スレッドTS数値精度問題の対策（conversations.historyで正確なTS特定）
- [x] upload-voucher/route.ts: slackLink→slackTs+PURCHASE_CHANNEL方式に修正
- [x] CDNキャッシュ（employees 5分, masters 10分, recent 1分, approval-routes 5分）
- [x] cronキャッシュウォーマー（/api/cron/cache-warm、4分間隔）
- [x] apiFetchSWR（localStorage stale-while-revalidate）を全主要ページに適用
- [x] UserProvider: localStorage即時復元＋従業員マスタ10分キャッシュ
- [x] 申請ボタン「確認中...」「送信中...」ローディング表示追加
- [x] 操作後のSWRキャッシュinvalidate（申請・承認・証憑・仕訳登録）

### Pending
1. RAG推定の精度検証（実データで正答率を計測、改善余地の確認）
2. Amazon CSV照合機能（仕訳管理ページ、後続タスク）
3. GASレスポンス自体の高速化検討（スプレッドシート読取7-8秒が根本ボトルネック）

### Next actions
1. 仕訳管理画面でAI再推定ボタンを使い、推定精度を実データで検証する
2. 精度が不十分なら品名embeddingベースの類似検索（B案）を検討
3. cronウォーマーのログを数日後に確認し、GAS呼び出し頻度・レイテンシを評価
4. CDNキャッシュ期限とcron間隔のチューニング（現状: employees 5分/cron 4分）
5. Amazon CSV照合機能の設計・実装（後続タスク）

### Affected files
- `Procurement-Assistant/src/gas/mfAccountingApi.js` — cacheResolvedJournals, searchJournalRows追加
- `Procurement-Assistant/src/gas/webApi.js` — getMastersBundle, searchJournalRowsルーティング追加
- `src/lib/account-estimator.ts` — buildContext原票方式、estimateAccountFromHistory改修
- `src/lib/gas-client.ts` — getMastersBundle, searchJournalRows, invalidateRecentRequests, キャッシュTTL変更
- `src/lib/api-client.ts` — apiFetchSWR, swrInvalidate追加
- `src/lib/user-context.tsx` — localStorage即時復元、従業員マスタキャッシュ
- `src/lib/slack.ts` — updateSlackMessageForWebAction追加
- `src/app/api/purchase/submit/route.ts` — estimateAccount削除、invalidateRecentRequests
- `src/app/api/purchase/[prNumber]/status/route.ts` — Slack連動更新、invalidate
- `src/app/api/purchase/estimate-account/route.ts` — GET→POST再推定API
- `src/app/api/purchase/upload-voucher/route.ts` — slackTs方式、RAG推定追加
- `src/app/api/slack/events/route.ts` — estimateAccount削除、証憑添付時RAG推定
- `src/app/api/employees/route.ts` — CDN Cache-Control追加
- `src/app/api/suppliers/route.ts` — CDN Cache-Control追加
- `src/app/api/mf/masters/route.ts` — getMastersBundle使用、CDN Cache-Control
- `src/app/api/purchase/recent/route.ts` — CDN Cache-Control追加
- `src/app/api/admin/approval-routes/route.ts` — CDN Cache-Control追加
- `src/app/api/cron/cache-warm/route.ts` — 新規（cronウォーマー）
- `src/app/dashboard/page.tsx` — apiFetchSWR適用
- `src/app/purchase/new/page.tsx` — apiFetchSWR適用、ローディング表示
- `src/app/purchase/my/page.tsx` — apiFetchSWR適用、キャッシュinvalidate
- `src/app/purchase/[prNumber]/page.tsx` — Slack連動operatorName送信、キャッシュinvalidate
- `src/app/admin/journals/page.tsx` — AI再推定ボタン、apiFetchSWR適用、キャッシュinvalidate
- `src/app/admin/approval-routes/page.tsx` — apiFetchSWR適用
- `vercel.json` — cache-warm cron追加

### Repro / Commands
```bash
cd Procurement-Assistant/src/gas && echo y | clasp push  # GASコード反映
# GASエディタから cacheResolvedJournals 実行（原票キャッシュ作成）
# GASエディタから新デプロイ → Vercel GAS_WEB_APP_URL更新
npx vercel --prod  # Next.jsデプロイ
```

### Risks / Unknowns
- RAG原票パススルーの推定精度: 実データでの検証がまだ不十分
- GASスレッドTSの数値精度問題: conversations.historyで補完しているが、チャンネル内メッセージ量が多いと誤マッチの可能性
- CDNキャッシュ: APIキーヘッダー付きリクエストでs-maxageが正しく動作するか要監視
- cronウォーマー: Vercel Pro無料枠のcron実行回数（月間上限）を確認
- SWRキャッシュinvalidate漏れ: Slack経由の操作（ボタン押下）ではクライアントキャッシュがクリアされない（ブラウザ側の操作でないため）→ stale期間で自然更新に頼る

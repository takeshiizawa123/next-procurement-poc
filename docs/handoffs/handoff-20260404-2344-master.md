# [Handoff] "MFマスタGAS統合・仕訳RAG推定・システム全体像" — 2026-04-04 23:44 (branch: master)

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

# CURRENT_WORK

## [Handoff] "購買管理Phase1 - Wave2完了・GAS連携調査前" — 2026-03-22 02:10 (branch: master)

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
- [ ] origin への push（8コミット先行中）

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

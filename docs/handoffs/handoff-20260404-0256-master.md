# [Handoff] "証憑添付フロー完成・OCR修正・詳細ページ・金額差異フロー設計" — 2026-04-04 02:56 (branch: master)

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
- [x] 全コミット・push済（4コミット: 5887493, 9574721, 0520210, 30e837a）

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
- `GAS webApi.js:487-492` — allowedFields拡張
- `GAS webApi.js:693-747` — recentRequests拡張

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

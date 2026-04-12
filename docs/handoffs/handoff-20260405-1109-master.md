# [Handoff] "MFマスタRAG仕訳推定 — 全体像と未解決課題" — 2026-04-05 11:09 (branch: master)

### システム全体像

**目的**: 購買申請→証憑確認→MF会計Plus仕訳登録を自動化する購買管理システム

```
[Slack購買チャンネル]
    ↓ 購買申請（品目名・取引先・金額・部門）
[Procurement-Assistant (GAS)]
    ↓ GASスプレッドシートに記録、Slackスレッドで証憑添付を待つ
    ↓ 証憑添付 → OCR読取（金額・T番号・税区分）
    ↓ T番号 → 国税庁API → 適格請求書発行事業者の法人名確認
[GASスプレッドシート] ← 全データの永続化層（DB移行なし）
    ↑↓
[next-procurement-poc (Vercel)]
    ├─ /admin/journals — 仕訳管理UI（★今回の主な作業対象）
    │   ├─ 発注データ vs 証憑データ比較パネル
    │   ├─ AI科目推定（RAG: 過去仕訳統計 + MFマスタ + Claude Haiku）
    │   ├─ 仕訳プレビュー＋編集フォーム
    │   └─ MF会計Plus仕訳登録ボタン
    ├─ /api/mf/journal — 仕訳登録API → MF会計Plus API
    ├─ /api/mf/masters — MFマスタ取得（GASシートから。MF認証不要）
    ├─ /api/purchase/estimate-account — AI科目推定API
    └─ /api/slack/events — Slack連携（証憑添付→自動仕訳）
[MF会計Plus API] ← 仕訳登録先
[MFマスタ（GASシート6種）] ← 勘定科目・税区分・部門・取引先・補助科目・PJ
```

**データの流れ（1件の購買の一生）**:
1. 社員がSlackで購買申請 → GASが記録
2. 購入後、Slackスレッドに証憑（領収書/請求書）添付
3. GASがOCR読取（金額・T番号・税区分）→ 国税APIで法人名確認
4. /admin/journals で経理が確認: 発注データと証憑データを比較
5. AI が科目・税区分を推定（過去仕訳+MFマスタのRAG）
6. 経理が確認・修正 → MF会計Plusに仕訳登録

### Goal / Scope
- 仕訳管理UIの科目推定精度向上とフォーム整合性修正
- AI推定をMFマスタ準拠 + 証憑データ優先に改善
- やらないこと: GAS→DB移行、GAS側OCR処理の改修（今回スコープ外）

### Key decisions
- **MFマスタ名リストをAIプロンプトに渡す**: AIがマスタに存在しない科目名を返す問題を根本解決
- **snapToOption**: 全selectのvalueをMFマスタ選択肢に正規化。マスタにない値は最近似マッチ
- **OCR→AI推定の直列化**: OCR到着後にAI推定を呼ぶ（証憑の取引先・金額・税区分を優先）
- **estimateTaxPrefix → buildJournalFromPurchase接続**: 過去仕訳統計ベースの税区分決定
- **プロンプトから固定業務ルール削除**: 品名重視・過去仕訳パターン最優先（ただし少額減価償却の会計基準は残す）

### Done
- [x] estimateTaxPrefix → buildJournalFromPurchase内の税区分決定に接続
- [x] /admin/journals UI: 非適格バッジに「80%控除」、AI推定根拠カード表示
- [x] GAS: computeJournalStats日次トリガー設定関数追加・プッシュ・実行済
- [x] snapToOption/snapToCreditOption: 全selectフィールドのMFマスタ正規化
- [x] AI推定: MFマスタの科目名・税区分名リストをプロンプトに含める
- [x] AI推定: OCR到着後に証憑データ（取引先・金額・税区分）優先で呼出し
- [x] AI推定: 少額減価償却資産の会計基準をプロンプトに追加
- [x] Vercelデプロイ済み

### Pending — 仕様未定の課題（次回要議論）

**1. OCR読取項目の不足**
| 項目 | 現状 | 必要性 |
|------|------|--------|
| 取引先名 | ❌ T番号→国税APIの法人名のみ | 証憑から直接読取すべき |
| 証憑日付（請求日/納品日） | ❌ 未読取 | 仕訳日の決定に必要 |
| 品名・明細 | ❌ 未読取 | 科目推定の最重要入力 |
| 明細単位の税率・税額 | △ 「課税10%」のみ | 軽減税率混在に対応必要 |
| 証憑金額 | ✅ | — |
| 適格番号 | ✅ | — |

**2. 仕訳ルール未定事項**
| 項目 | 現状 | 要決定 |
|------|------|--------|
| 仕訳日 | 検収日→申請日→今日 | 検収日確定？証憑日付？ |
| 摘要 | 申請の品目名ベース | 証憑の品名にすべき？ |
| 科目推定入力 | 申請品目名+証憑取引先+金額 | 証憑品名・明細を使うべき |

**3. 証憑プレビュー**
- DriveファイルIDが空でiframeプレビューが表示されない（GAS側でDriveアップロードが必要）

**4. 過去仕訳RAGの精度向上**
- 現在: 取引先×科目、部門×科目の集計のみ
- 課題: Amazon等の汎用取引先では取引先集計が役に立たない
- 改善案: GAS computeJournalStatsに摘要（remark）×科目の統計を追加

### Next actions
1. OCR読取項目の仕様策定 — 証憑から読み取るべき項目を確定（取引先名・日付・品名・明細）
2. 仕訳ルール策定 — 仕訳日・摘要・科目推定入力のルール確定
3. GAS側OCR処理の改修 — 確定した仕様に基づきOCR読取項目を拡充
4. 証憑プレビュー — GAS側でDriveファイルID保存 or Slack画像URL取得
5. 摘要×科目統計の追加 — computeJournalStatsにremark解析を追加
6. E2Eテスト — 実データで仕訳編集→保存→MF登録の一連フロー確認

### Affected files
- `src/lib/account-estimator.ts` — RAG推定: MFマスタ名リスト渡し、プロンプト改善、OCR税区分対応
- `src/lib/mf-accounting.ts:9,434-437` — estimateTaxPrefix import・接続
- `src/app/admin/journals/page.tsx:71-95` — snapToOption/snapToCreditOption追加
- `src/app/admin/journals/page.tsx:171-270` — JournalDetail値解決・OCR→AI推定直列化・masters/estimation反映useEffect
- `src/app/admin/journals/page.tsx:944-958` — 一覧テーブル行のsnapToOption適用
- `src/app/api/purchase/estimate-account/route.ts` — 証憑データパラメータ追加
- `Procurement-Assistant/src/gas/mfAccountingApi.js:1546-1568` — setupJournalStatsTrigger追加

### Repro / Commands
```bash
# Next.js
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npx tsc --noEmit
npx vercel --prod

# GAS
cd C:/Users/takeshi.izawa/.claude/projects/Procurement-Assistant/src/gas
echo y | clasp push

# AI推定テスト（証憑データ付き）
curl "本番URL/api/purchase/estimate-account?itemName=ノートPC&supplierName=Amazon&totalAmount=16000&department=管理本部&verifiedSupplierName=日本電気&voucherAmount=24200&ocrTaxCategory=課税10%" -H "x-api-key: INTERNAL_API_KEY"
```

### Risks / Unknowns
- OCR読取項目の拡充はGAS側（Procurement-Assistant）の改修が必要 — Next.js側だけでは完結しない
- 証憑の品名読取精度 — 手書き領収書やフォーマット多様な請求書への対応
- 過去仕訳の摘要パース — 「2025/09 PR-202509-0001 USBケーブル」のような形式からの品名抽出ロジック
- MF APIのdeductible_50（2026/10〜50%控除）は未対応

### Links
- 本番: https://next-procurement-poc-tau.vercel.app/admin/journals
- GASエディタ: https://script.google.com/home/projects/1pFr4xGx-KDCmFbquBUaMNyko9mVpAIE6UBVZZwp79kC8TE_tTLnXA9ze/edit

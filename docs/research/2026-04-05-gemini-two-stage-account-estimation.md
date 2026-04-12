# Research: Gemini OCR 2段階アプローチによる仕訳科目推定の設計

**Date**: 2026-04-05
**Status**: Draft
**Tags**: #architecture #accounting #ai-pipeline #gemini #rag

## Executive Summary

証憑OCR（Stage 1）と科目推定（Stage 2）を分離した2段階アプローチを設計。
Stage 1でGeminiが画像から全情報を抽出・分類し、Stage 2でビジネスコンテキスト（MFマスタ+RAG）を加えて最終判定する。
Claude Haikuを廃止し、Geminiに統一することでコスト同等・精度向上を実現する。

## Background / Motivation

### 現状の問題
1. **精度損失**: Claude Haikuは証憑画像を見ず、OCR抽出テキストのみで科目推定 → 情報落ち
2. **RAG統計の有効性が不明**: 取引先×科目統計はAmazon等の汎用取引先で無力
3. **AI 2本立て**: Gemini（OCR）+ Claude Haiku（推定）で管理コスト・遅延が増加

### 目指す姿
- Stage 1: Geminiが画像を見て**全情報抽出 + 品目分類 + 科目提案**まで行う
- Stage 2: Stage 1のJSONを入力に、**ビジネスルール検証 + RAG補強 + 最終判定**
- 画像を見る処理は1回のみ（コスト効率）

## Findings

### 1. Stage 1: OCR抽出項目の最適化

#### 現在の12項目（維持）
| # | フィールド | 用途 |
|---|-----------|------|
| 1 | documentType | 文書種別 |
| 2 | issueDate | 発行日 |
| 3 | documentNumber | 文書番号 |
| 4 | vendorName | 取引先名 |
| 5 | invoiceNumber | 適格番号 |
| 6 | items[] | 明細（品名・数量・単価・金額） |
| 7 | subtotal | 税抜金額 |
| 8 | taxAmount | 消費税額 |
| 9 | totalAmount | 税込合計 |
| 10 | taxRate | 税率 |
| 11 | paymentDue | 支払期限 |
| 12 | notes | 備考 |

#### 追加すべき項目（科目推定に必要）
| # | フィールド | 型 | 説明 | 科目推定への寄与 |
|---|-----------|---|------|----------------|
| 13 | itemCategory | enum | 物品/サービス/ソフトウェア/工事/書籍/交通/飲食/その他 | **最重要**: 科目の第一決定因子 |
| 14 | itemNature | enum | 消耗品/耐久財/無形資産/役務 | 固定資産 vs 費用の判定 |
| 15 | suggestedAccounts | array | Geminiの科目提案（複数候補+信頼度+理由） | Stage 2の主要入力 |
| 16 | hasMultipleTaxRates | boolean | 軽減税率混在フラグ | 税区分判定 |
| 17 | taxRateBreakdown | array | 税率別金額内訳 [{rate, amount}] | 複数税率対応 |

#### suggestedAccounts の構造
```json
{
  "suggestedAccounts": [
    {
      "account": "消耗品費",
      "confidence": "high",
      "reason": "PC周辺機器（USBケーブル）、税込1,980円で10万円未満"
    },
    {
      "account": "材料費",
      "confidence": "low",
      "reason": "電子部品として使用される可能性もある"
    }
  ]
}
```

**設計意図**: 単一の提案ではなく複数候補を出すことで：
- Stage 2が第1候補を検証失敗した場合、第2候補を評価できる
- confidence + reason がログ・デバッグに有用
- 曖昧さを適切に表現し、最終判断はStage 2に委ねる

#### Stage 1 Geminiプロンプト変更案

現在のプロンプト末尾に以下を追加：
```
13. itemCategory: 品目の分類（物品/サービス/ソフトウェア/工事/書籍/交通/飲食/その他）
    ※複数品目がある場合は主たる品目の分類
14. itemNature: 品目の性質（消耗品/耐久財/無形資産/役務）
    ※消耗品=使い切り、耐久財=長期使用（PC・モニター等）、無形資産=ソフト/ライセンス、役務=サービス/工事
15. suggestedAccounts: 勘定科目の推定候補（最大3つ、信頼度順）
    [{account: "科目名", confidence: "high|medium|low", reason: "理由（20文字以内）"}]
    ※日本の企業会計基準に従い、品目の性質と金額から判断
    ※10万円未満の有形物品は消耗品費等の費用科目（少額減価償却資産の特例）
16. hasMultipleTaxRates: 軽減税率（8%）と標準税率（10%）が混在しているか（true/false）
17. taxRateBreakdown: 税率別金額内訳 [{rate: 10, amount: 5000}]（混在時のみ）
```

### 2. RAG統計の再設計

#### 現状の統計と有効性評価

| 統計 | 有効性 | 根拠 |
|------|--------|------|
| 取引先×科目 | **条件付き有効** | 専門取引先（秋月電子→材料費）では100%有効。汎用取引先（Amazon）では無力 |
| 部門×科目 | **弱い** | 部門の全般傾向のみ。タイブレーカーとしては使える |
| 品名キーワード×科目 | **理論上有効だが実装が脆弱** | 摘要パース精度に依存。カバレッジ不明 |

#### 改善案: 統計の再構成

**1. 取引先特化度スコアの導入**
```
取引先の特化度 = 最頻科目の件数 / 全件数

例:
  秋月電子通商: 材料費 45/50 = 0.90 → 高特化（信頼できる）
  Amazon: 消耗品費 30/100 = 0.30 → 低特化（無視すべき）
```
- 特化度 0.8以上 → 強いシグナル（Stage 2で即採用可能）
- 特化度 0.5未満 → 無視（コンテキストに含めない）

**2. 品目カテゴリ×科目統計（新設）**
Stage 1が `itemCategory` を返すようになれば、過去仕訳にも品目カテゴリをバックフィルして統計化可能：
```
物品 → 消耗品費 60%, 材料費 25%, 工具器具備品 15%
サービス → 支払手数料 50%, 外注費 30%, 研修費 20%
ソフトウェア → 支払手数料 80%, 消耗品費 20%
```

**3. 金額帯×科目統計（新設）**
```
<1万円 → 消耗品費 85%, 事務用品費 10%, 新聞図書費 5%
1-10万円 → 消耗品費 40%, 材料費 30%, 支払手数料 20%
10万円以上 → 工具器具備品 60%, 支払手数料 25%, 材料費 15%
```

**4. 摘要キーワード×科目統計（現状維持だが重要度を下げる）**
- パース精度が不安定なため、「参考情報」として低い重みで使用
- 品目カテゴリ統計が十分なデータを集めるまでの橋渡し

#### 提案する統計構成（優先度順）
```
1. counterpartyAccounts（維持 + 特化度スコア追加）
2. itemCategoryAccounts（新設 — Stage 1のitemCategoryベース）
3. amountRangeAccounts（新設 — 金額帯別）
4. deptAccountTax（維持 — タイブレーカー）
5. remarkAccounts（維持だが低優先 — フォールバック）
```

### 3. Stage 2: 科目推定のアーキテクチャ

#### 推奨: ルールベース + 条件付きGeminiテキスト呼び出し

```
Stage 1 JSON到着
    ↓
┌─ Rule 1: suggestedAccounts[0].confidence === "high" ?
│  └─ YES → 取引先特化度チェック（矛盾しないか）
│           └─ OK → 採用（AI呼び出し不要）★高速パス
│           └─ NG → Rule 2へ
│
├─ Rule 2: 取引先特化度 ≧ 0.8 ?
│  └─ YES → 取引先の最頻科目を採用（AI呼び出し不要）
│
├─ Rule 3: 金額閾値チェック
│  └─ 10万円以上 + itemNature=耐久財 → 工具器具備品
│  └─ 10万円未満 + itemNature=耐久財 → 消耗品費
│
└─ Rule 4: 上記で確定しない場合
   └─ Geminiテキスト呼び出し（Stage 1 JSON + RAGコンテキスト + MFマスタ）
```

#### Stage 2 Gemini呼び出しのプロンプト構成
```
入力:
├─ Stage 1のJSON（品名・取引先・金額・品目カテゴリ・品目性質・Gemini提案）
├─ MFマスタ（使用可能な勘定科目名リスト、税区分名リスト）
├─ RAGコンテキスト:
│  ├─ 取引先の過去パターン（特化度スコア付き）
│  ├─ 品目カテゴリの統計
│  ├─ 金額帯の統計
│  └─ 部門の傾向（タイブレーカー用）
└─ 会計基準ルール（少額減価償却、固定資産閾値等）
```

#### 実行場所の選択肢

| 方式 | メリット | デメリット |
|------|---------|----------|
| **A. GAS側で完結** | OCR直後に推定→即シートに書込。Next.js不要 | GASの実行時間制限（6分）、Gemini API呼び出し2回 |
| **B. Next.js側で実行（現状路線）** | UI操作時にオンデマンド実行、柔軟 | 毎回API呼び出し、レスポンス待ち |
| **C. ハイブリッド** | Stage 1でGemini提案をシートに保存、Stage 2はUIで確認時にルールベース+条件付きAI | 最もバランスが良い |

**推奨: C（ハイブリッド）**
- GAS側: Stage 1でOCR + Gemini提案 → シートに保存
- Next.js側: UI展開時にStage 2（ルールベース検証 + 必要時のみAI呼び出し）

### コスト分析

| 方式 | API呼び出し/件 | 推定コスト/件 |
|------|--------------|-------------|
| 現状（Gemini OCR + Claude Haiku） | 2回 | ~$0.002 |
| 提案（Gemini OCR拡張 + 条件付きGemini Text） | 1.0-1.3回（70%はルールで確定） | ~$0.001-0.002 |

## Recommendation

### 実装の優先順位

#### Phase 1: Stage 1 プロンプト拡張（最小変更で最大効果）
1. Gemini OCRプロンプトに `itemCategory`, `itemNature`, `suggestedAccounts` を追加
2. 抽出結果をシートの新列に保存
3. 既存のClaude Haiku推定はそのまま維持（並行稼働）

#### Phase 2: RAG統計の改善
1. 取引先特化度スコアの計算を `computeJournalStats` に追加
2. `itemCategoryAccounts` 統計の新設（Phase 1のデータが溜まってから）
3. `amountRangeAccounts` 統計の新設

#### Phase 3: Stage 2 実装（Claude Haiku置き換え）
1. ルールベース検証ロジックの実装
2. 条件付きGeminiテキスト呼び出しの実装
3. Claude Haiku廃止
4. A/Bテスト（新旧比較）

### 計測すべきメトリクス
- Stage 1の `suggestedAccounts[0]` が最終採用された割合
- ルールベースで確定した割合（AI呼び出し不要率）
- 経理担当者の修正率（推定結果を変更した割合）
- 科目・税区分の正答率（修正なしで登録された割合）

## Next Steps

1. **Stage 1プロンプト拡張のプロトタイプ**: 既存の10件程度の証憑でテスト
2. **取引先特化度スコアの実装**: computeJournalStatsに追加
3. **suggestedAccounts列のシート追加**: JSON形式で保存
4. **段階的移行**: Claude Haikuと並行稼働→精度比較→切り替え

## References
- Gemini 2.0 Flash API: Structured output with JSON mode
- MF会計Plus API: /journals endpoint for historical data
- 少額減価償却資産の特例（税抜10万円未満の即時費用処理）

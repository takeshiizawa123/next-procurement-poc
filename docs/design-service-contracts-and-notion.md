# 設計書: 役務提供・請求書管理 + Notion自動同期

**作成日**: 2026-04-15
**ステータス**: 設計中（ユーザー承認後に実装開始）

---

## 1. 背景と目的

### 現行システムの守備範囲
- 物品購買: 発注→承認→検収→証憑→仕訳（一気通貫）
- 立替精算: /expense/new → 承認→証憑→MF経費連携
- カード照合: 月次CSVマッチング→消込仕訳
- AI仕訳推定: RAG + 学習ループ

### 浮いている領域
- **役務提供系の請求書**（コンサル、派遣、SaaS、顧問料、清掃、保守等）
- **システムの自己文書化**（Notionへの自動同期、プロンプト透明化）

### 目指す姿
「物品」も「役務」も同一システムで管理し、仕訳生成エンジンの入口で合流。
Notion APIでフロー図・プロンプト・変更履歴を自動同期し、属人化を排除。

---

## 2. 役務提供管理の設計

### 2.1 3つの入力ルート

```
┌─────────────────────────────────────────────────────┐
│                  仕訳生成エンジン                      │
│            （MF会計Plus API 仕訳登録）                 │
└──────────┬──────────────┬──────────────┬─────────────┘
           │              │              │
   ┌───────▼───────┐ ┌───▼────────┐ ┌──▼──────────┐
   │ ① スポット役務  │ │ ② 継続契約   │ │ ③ SaaS/自動  │
   │               │ │            │ │             │
   │ /purchase/new │ │ contracts  │ │ contracts   │
   │ type="役務"   │ │ + invoices │ │ +カード照合   │
   │               │ │            │ │             │
   │ 発注→完了確認  │ │ 契約登録    │ │ 契約登録     │
   │ →請求書→仕訳  │ │ →毎月請求書 │ │ →明細自動検知│
   │               │ │ →突合→承認 │ │ →自動突合    │
   │               │ │ →仕訳      │ │ →仕訳       │
   └───────────────┘ └────────────┘ └─────────────┘
```

### 2.2 ルート別の詳細

#### ① スポット役務（単発コンサル、修繕等）
- 既存の `purchase_requests` を拡張
- `request_type` に `"役務"` を追加
- 検収 = 「役務完了確認」（担当者がボタンを押す）
- 証憑 = 請求書（納品書の代わり）
- 以降は物品と同じ仕訳生成フロー

#### ② 継続契約（派遣、清掃、顧問料等）
- 新テーブル `contracts` で契約マスタ管理
- 新テーブル `contract_invoices` で月次請求書管理
- 毎月、契約に基づき「請求書受領待ち」レコードを自動生成
- 請求書到着 → OCR金額突合 → 定額一致なら自動承認 / 差額ありなら手動確認
- 承認後に仕訳生成

#### ③ SaaS/サブスク（AWS、Adobe、Google等）
- `contracts` に `billing_type="カード自動"` で登録
- カード明細照合時に、加盟店名で契約マスタと自動マッチ
- 既存のcard-matcherフローに合流

### 2.3 月次自動処理（見積計上）

```
月末 cron (JST 23:00):
  ① contracts(is_active=true) の当月分をチェック
  ② contract_invoices に当月レコードがなければ「未受領」で作成
  ③ 請求書未着の契約 → 見積仕訳を自動生成
     借方: 費用科目（契約マスタの account_title）
     貸方: 未払費用
  ④ OPSに「請求書未着一覧」を通知

翌月初 cron (JST 01:00):
  ① 前月の見積仕訳をリバース（洗替仕訳）
  ② 実際の請求書到着・承認後に確定仕訳を生成
```

### 2.4 契約更新・終了管理

```
更新アラート cron (毎日):
  ① contract_end_date - renewal_alert_days ≤ 今日 の契約を抽出
  ② 担当者にSlack通知: 「○○の契約が△日後に満了します。更新/解約の判断をしてください」
  
終了処理:
  ① is_active = false に変更
  ② 翌月以降の自動レコード生成を停止
  ③ 最終月の請求書処理完了を確認
```

---

## 3. DBスキーマ

### 3.1 新規テーブル

```sql
-- 継続契約マスタ
CREATE TABLE contracts (
  id SERIAL PRIMARY KEY,
  contract_number VARCHAR(30) NOT NULL UNIQUE,  -- CT-YYYYMM-NNNN
  
  -- 分類
  category VARCHAR(50) NOT NULL,  -- 派遣/外注/SaaS/顧問/賃貸/保守/清掃/その他
  billing_type VARCHAR(20) NOT NULL,  -- 固定/従量/カード自動
  
  -- 取引先
  supplier_name VARCHAR(200) NOT NULL,
  supplier_contact VARCHAR(200),  -- 担当者・連絡先
  
  -- 金額
  monthly_amount INTEGER,  -- 月額（固定の場合、円）
  annual_amount INTEGER,   -- 年額（年一括の場合）
  budget_amount INTEGER,   -- 月額予算上限（従量の場合）
  
  -- 契約期間
  contract_start_date DATE NOT NULL,
  contract_end_date DATE,  -- NULLなら無期限
  renewal_type VARCHAR(20) DEFAULT '自動更新',  -- 自動更新/都度更新/期間満了
  renewal_alert_days INTEGER DEFAULT 60,  -- 更新通知日数
  
  -- 会計
  account_title VARCHAR(100) NOT NULL,  -- 勘定科目
  mf_account_code VARCHAR(20),
  mf_tax_code VARCHAR(20),
  mf_department_code VARCHAR(20),
  mf_counterparty_code VARCHAR(20),
  
  -- 管理
  department VARCHAR(100) NOT NULL,
  requester_slack_id VARCHAR(30),  -- 契約担当者
  approver_slack_id VARCHAR(30),   -- 承認者
  
  -- 自動化
  auto_approve BOOLEAN DEFAULT false,  -- 定額一致時に自動承認
  auto_accrue BOOLEAN DEFAULT true,    -- 月末見積計上を自動実行
  
  -- ステータス
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- 月次請求書レコード
CREATE TABLE contract_invoices (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  
  -- 請求
  billing_month VARCHAR(7) NOT NULL,  -- YYYY-MM
  invoice_amount INTEGER,  -- 実際の請求額
  expected_amount INTEGER,  -- 契約マスタからの予定額
  amount_diff INTEGER,  -- 差額（invoice - expected）
  
  -- ステータス
  status VARCHAR(20) NOT NULL DEFAULT '未受領',
    -- 未受領 / 受領済 / 承認済 / 仕訳済 / 見積計上
  
  -- 承認
  approved_by VARCHAR(100),
  approved_at TIMESTAMPTZ,
  
  -- 証憑
  voucher_file_url TEXT,
  voucher_uploaded_at TIMESTAMPTZ,
  
  -- 仕訳
  journal_id INTEGER,  -- MF仕訳ID（確定仕訳）
  accrual_journal_id INTEGER,  -- MF仕訳ID（見積計上）
  reversal_journal_id INTEGER,  -- MF仕訳ID（洗替リバース）
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(contract_id, billing_month)
);

ALTER TABLE contract_invoices ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contracts_active ON contracts(is_active);
CREATE INDEX idx_contracts_end_date ON contracts(contract_end_date);
CREATE INDEX idx_contract_invoices_month ON contract_invoices(billing_month);
CREATE INDEX idx_contract_invoices_status ON contract_invoices(status);
```

### 3.2 purchase_requests 拡張

```sql
-- request_type enum に '役務' を追加
-- （既存: 購入前 / 購入済）
ALTER TYPE request_type ADD VALUE '役務';
```

---

## 4. Notion自動同期の設計

### 4.1 3層アーキテクチャとの対応

```
┌─────────────────────────────────────────────────────────┐
│ 管理・ドキュメント層（Notion）                            │
│ ─────────────────────────────────────────────           │
│ ・業務フロー図（Mermaid自動生成）                         │
│ ・AIプロンプト一覧（仕訳推定・OCR・科目推定）              │
│ ・変更履歴（コミット→Notion自動記録）                     │
│ ・契約マスタ閲覧（非エンジニア向けビュー）                 │
│ ・エラー報告＋AI修正提案                                 │
└───────────────────────┬─────────────────────────────────┘
                        │ Notion API
┌───────────────────────▼─────────────────────────────────┐
│ 開発・実行層（Next.js + Vercel + Supabase）               │
│ ─────────────────────────────────────────────           │
│ ・購買管理（物品 + スポット役務）                          │
│ ・契約管理（継続契約 + SaaS）                             │
│ ・仕訳生成エンジン（MF会計Plus API）                      │
│ ・AI OCR + 勘定科目推定（Gemini + Claude）                │
│ ・カード照合 + 消込                                      │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│ インターフェース層（Slack + Webアプリ）                    │
│ ─────────────────────────────────────────────           │
│ ・/purchase → 物品 or 役務の申請                          │
│ ・/ask → AI対話アシスタント                               │
│ ・承認DM、催促通知、エラー通知                             │
│ ・管理画面（仕訳・契約・照合・統制）                       │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Notion同期の具体的な機能

#### A. 業務フロー自動生成
- コード変更時にClaude CodeがMermaid図を生成
- Notion APIで「業務フロー」ページを自動更新
- 対象: 購買フロー、承認フロー、仕訳フロー、契約管理フロー

#### B. AIプロンプト透明化
- `src/lib/account-estimator.ts` の推定プロンプト
- `src/lib/ocr.ts` のOCR解析プロンプト
- これらをNotion DBに同期し、「なぜその仕訳になったか」を非エンジニアが確認可能に
- プロンプト変更時に自動でNotion側も更新

#### C. 変更履歴の自動記録
- git commitメッセージをNotion DBに記録
- 「いつ、何が変わったか」を管理部門が追跡可能
- 監査対応: システム変更の証跡

#### D. エラー報告＋AI修正提案
- DLQ記録時にNotionの「エラー報告」DBにも記録
- AIが修正案を生成し、Notionページに添付
- 管理者がNotionで承認 → API経由で修正適用

### 4.3 必要な環境変数

```
NOTION_API_KEY=secret_xxx          # Notion Integration Token
NOTION_WORKSPACE_ID=xxx            # ワークスペースID
NOTION_FLOW_PAGE_ID=xxx            # 業務フローページID
NOTION_PROMPT_DB_ID=xxx            # AIプロンプトDBのID
NOTION_CHANGELOG_DB_ID=xxx         # 変更履歴DBのID
NOTION_ERROR_DB_ID=xxx             # エラー報告DBのID
NOTION_CONTRACT_DB_ID=xxx          # 契約マスタ閲覧用DBのID
```

---

## 5. 実装ロードマップ

### Phase A: 役務提供管理（基盤）
1. DBスキーマ作成（contracts + contract_invoices）
2. request_type に "役務" 追加
3. /purchase/new にスポット役務フロー追加
4. /admin/contracts 契約管理画面
5. /admin/contracts/[id]/invoices 請求書管理画面

### Phase B: 月次自動処理
6. 月末見積計上cron
7. 翌月リバースcron
8. 契約更新アラートcron
9. 請求書未着督促

### Phase C: 仕訳統合
10. 仕訳管理画面に「契約仕訳」タブ追加
11. 契約ベースの仕訳生成（MF会計Plus API）
12. カード明細 × 契約マスタの自動マッチ

### Phase D: Notion自動同期
13. Notion API接続基盤
14. 業務フロー図の自動生成・同期
15. AIプロンプト透明化（Notion DB同期）
16. 変更履歴の自動記録
17. エラー報告＋AI修正提案

---

## 6. ページ構成

| パス | 用途 | 対象ユーザー |
|------|------|------------|
| `/purchase/new` | 物品 + スポット役務の申請（既存拡張） | 全従業員 |
| `/admin/contracts` | 継続契約の登録・一覧・更新管理 | 管理本部 |
| `/admin/contracts/new` | 新規契約登録フォーム | 管理本部 |
| `/admin/contracts/[id]` | 契約詳細 + 月次請求書一覧 | 管理本部 |
| `/admin/journals` | 仕訳管理（既存 + 契約仕訳タブ追加） | 管理本部 |

---

## 7. 「テコの原理」の効果

| 効果 | 詳細 |
|------|------|
| **属人化の解消** | Notionにフロー図・プロンプト・変更履歴が集約。後任者はNotionを見てAIに指示可能 |
| **コストパフォーマンス** | 高額ノーコードツール不要。Next.js + Notion API + MF会計で全機能実現 |
| **監査・内部統制** | プロンプトの透明化で「なぜその仕訳か」を説明可能。変更履歴で証跡確保 |
| **自己修復性** | エラー→AI修正提案→人間承認→自動適用のサイクル |
| **スケーラビリティ** | 契約マスタで「将来のキャッシュアウト」を可視化。経営判断の基盤 |

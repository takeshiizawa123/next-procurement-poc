# データベーススキーマ — Supabase Postgres

**最終更新**: 2026-04-13
**対象DB**: Supabase Postgres (Tokyo, 17.6)
**ORM**: Drizzle ORM
**スキーマ定義ファイル**: `src/db/schema.ts`
**マイグレーション**: `src/db/migrations/*.sql`

このドキュメントは現行のDBスキーマのリファレンスです。実装との差分が生じた場合は
`src/db/schema.ts` を正、このドキュメントを更新してください。

---

## 1. 全体構成

18テーブル + 8個のPostgres enum型

### Enum型

| 名前 | 値 |
|------|---|
| `purchase_status` | 申請済 / 承認済 / 発注済 / 検収済 / 証憑完了 / 計上済 / 支払済 / 差戻し / 取消 |
| `request_type` | 購入前 / 購入済 |
| `payment_method` | 会社カード / 請求書払い / 立替 |
| `voucher_status` | none / uploaded / verified / mf_auto |
| `prediction_status` | pending / matched / unmatched / cancelled |
| `prediction_type` | purchase / trip_transport / trip_hotel / trip_daily / reimbursement |
| `invoice_kind` | 適格 / 非適格 / 番号なし |
| `invoice_verification` | verified / not_found / no_number / error |

---

## 2. コアテーブル

### purchase_requests — 購買申請メインテーブル

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| po_number | varchar(30) | NO | **PK** PO-YYYYMM-NNNN |
| status | purchase_status | NO | default: "申請済" |
| request_type | request_type | NO | 購入前/購入済 |
| applicant_slack_id | varchar(30) | NO | |
| applicant_name | varchar(100) | NO | |
| department | varchar(100) | NO | |
| approver_slack_id | varchar(30) | YES | |
| approver_name | varchar(100) | YES | |
| inspector_slack_id | varchar(30) | YES | |
| inspector_name | varchar(100) | YES | |
| item_name | varchar(500) | NO | |
| unit_price | integer | NO | 円（税込） |
| quantity | integer | NO | default: 1 |
| total_amount | integer | NO | 円（税込） |
| payment_method | payment_method | NO | |
| purpose | text | YES | 利用目的 |
| supplier_name | varchar(200) | YES | |
| supplier_url | text | YES | |
| hubspot_deal_id | varchar(50) | YES | |
| budget_number | varchar(50) | YES | |
| katana_po_number | varchar(50) | YES | |
| account_title | varchar(100) | YES | 勘定科目（日本語） |
| mf_account_code | varchar(20) | YES | MF勘定科目コード |
| mf_tax_code | varchar(20) | YES | MF税区分コード |
| mf_department_code | varchar(20) | YES | |
| mf_project_code | varchar(20) | YES | |
| mf_counterparty_code | varchar(20) | YES | |
| mf_sub_account_code | varchar(20) | YES | |
| mf_remark | text | YES | MF仕訳摘要 |
| voucher_status | voucher_status | NO | default: "none" |
| voucher_amount | integer | YES | OCR抽出値 |
| voucher_file_url | text | YES | |
| voucher_uploaded_at | timestamptz | YES | |
| delivery_note_file_url | text | YES | 納品書 |
| registration_number | varchar(20) | YES | 適格請求書番号（T+13桁） |
| is_qualified_invoice | invoice_kind | YES | |
| invoice_verification_status | invoice_verification | YES | |
| slack_channel_id | varchar(30) | YES | |
| slack_message_ts | varchar(50) | YES | |
| slack_thread_ts | varchar(50) | YES | |
| stage1_journal_id | integer | YES | MF仕訳ID（Stage 1） |
| matched_journal_id | integer | YES | MF仕訳ID（Stage 2） |
| application_date | timestamptz | NO | default: now() |
| approved_at | timestamptz | YES | |
| ordered_at | timestamptz | YES | |
| inspected_at | timestamptz | YES | |
| voucher_completed_at | timestamptz | YES | |
| purchase_date | date | YES | |
| inspected_quantity | integer | YES | 部分検収対応 |
| remarks | text | YES | |
| is_estimate | boolean | NO | default: false |
| is_post_report | boolean | NO | default: false |
| created_at | timestamptz | NO | default: now() |
| updated_at | timestamptz | NO | default: now() |

**インデックス**:
- status, applicant_slack_id, approver_slack_id, application_date, slack_message_ts

---

### employees — 従業員マスタ

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| id | serial | NO | **PK** |
| name | varchar(100) | NO | |
| slack_id | varchar(30) | NO | **UNIQUE** |
| slack_aliases | text | YES | カンマ区切り |
| email | varchar(255) | YES | Google OAuth照合用 |
| department_code | varchar(20) | NO | |
| department_name | varchar(100) | NO | |
| dept_head_slack_id | varchar(30) | YES | 承認者 |
| card_last4 | varchar(4) | YES | MFビジネスカード末尾4桁 |
| card_holder_name | varchar(100) | YES | |
| mf_office_member_id | varchar(50) | YES | MF経費側の従業員ID |
| is_active | boolean | NO | default: true |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

**インデックス**: slack_id, email, card_last4, mf_office_member_id

---

### predicted_transactions — カード照合用予測テーブル

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| id | varchar(30) | NO | **PK** PCT-YYYYMM-NNNN |
| po_number | varchar(30) | YES | purchase_requests.po_number参照（出張時はnull可） |
| type | prediction_type | NO | purchase/trip_transport/trip_hotel/reimbursement等 |
| card_last4 | varchar(4) | YES | |
| mf_office_member_id | varchar(50) | YES | **従業員特定の主キー** |
| predicted_amount | integer | NO | 円 |
| predicted_date | date | NO | |
| supplier | varchar(200) | YES | |
| applicant | varchar(100) | YES | |
| applicant_slack_id | varchar(30) | YES | |
| status | prediction_status | NO | default: "pending" |
| matched_journal_id | integer | YES | |
| matched_at | timestamptz | YES | |
| amount_diff | integer | YES | 実額 - 予測額 |
| mf_ex_transaction_id | varchar(50) | YES | MF経費側の取引ID |
| is_estimate | boolean | NO | default: false |
| is_post_report | boolean | NO | default: false |
| emergency_reason | text | YES | |
| created_at | timestamptz | NO | |

**インデックス**: status, po_number, card_last4, mf_office_member_id, predicted_date

---

## 3. MFマスタテーブル（6種）

### mf_counterparties — MF取引先

| 列 | 型 | NULL |
|---|---|---|
| mf_id | varchar(30) | NO **PK** |
| code | varchar(20) | NO |
| name | varchar(200) | NO |
| search_key | varchar(200) | YES |
| invoice_registration_number | varchar(20) | YES |
| alias | text | YES |
| available | boolean | NO |
| updated_at | timestamptz | NO |

### mf_departments — MF部門

| 列 | 型 |
|---|---|
| mf_id | varchar(30) PK |
| code | varchar(20) |
| name | varchar(200) |
| search_key | varchar(200) |
| available | boolean |
| updated_at | timestamptz |

### mf_accounts — MF勘定科目

| 列 | 型 |
|---|---|
| mf_id | varchar(30) PK |
| code | varchar(20) |
| name | varchar(200) |
| search_key | varchar(200) |
| tax_id | integer |
| available | boolean |
| updated_at | timestamptz |

### mf_taxes — MF税区分

| 列 | 型 |
|---|---|
| mf_id | varchar(30) PK |
| code | varchar(20) |
| name | varchar(200) |
| abbreviation | varchar(50) |
| tax_rate | integer | 税率×100（10.0% → 1000）で整数保存 |
| available | boolean |
| updated_at | timestamptz |

### mf_sub_accounts — MF補助科目

| 列 | 型 |
|---|---|
| mf_id | varchar(30) PK |
| code | varchar(20) |
| account_id | integer |
| name | varchar(200) |
| search_key | varchar(200) |
| available | boolean |
| updated_at | timestamptz |

### mf_projects — MFプロジェクト

| 列 | 型 |
|---|---|
| mf_id | varchar(30) PK |
| code | varchar(20) |
| name | varchar(200) |
| search_key | varchar(200) |
| available | boolean |
| updated_at | timestamptz |

---

## 4. キャッシュ・ユーティリティテーブル

### mf_masters_cache — MF API全量JSONキャッシュ

| 列 | 型 | 備考 |
|---|---|---|
| id | varchar(50) PK | "mf_masters" 固定 |
| accounts | jsonb | 配列 |
| taxes | jsonb | 配列 |
| sub_accounts | jsonb | 配列 |
| projects | jsonb | 配列 |
| synced_at | timestamptz | 最終同期時刻 |

### journal_stats — 仕訳統計（RAG用）

| 列 | 型 | 備考 |
|---|---|---|
| id | varchar(50) PK | "journal_stats" 固定 |
| counterparty_accounts | jsonb | `[{counterparty, account, taxType, count}...]` |
| dept_account_tax | jsonb | |
| remark_accounts | jsonb | |
| total_journals | integer | |
| total_rows | integer | |
| computed_at | timestamptz | |

### journal_rows — 過去仕訳生データ

| 列 | 型 |
|---|---|
| id | serial PK |
| date | date |
| remark | text |
| account | varchar(100) |
| tax_type | varchar(50) |
| amount | integer |
| department | varchar(100) |
| counterparty | varchar(200) |
| imported_at | timestamptz |

**インデックス**: counterparty, department, date

### purchase_drafts — 下書き保存

| 列 | 型 |
|---|---|
| id | serial PK |
| user_id | varchar(30) |
| draft | jsonb |
| saved_at | timestamptz |

### mf_oauth_tokens — MF OAuthトークン

| 列 | 型 | 備考 |
|---|---|---|
| id | varchar(50) PK | scope識別子 |
| access_token | text | |
| refresh_token | text | |
| token_type | varchar(30) | default: "Bearer" |
| scope | text | |
| expires_at | timestamptz | |
| updated_at | timestamptz | |

### slack_event_log — Slackイベント冪等性

| 列 | 型 |
|---|---|
| event_id | varchar(100) PK |
| event_type | varchar(50) |
| payload | jsonb |
| processed_at | timestamptz |

---

## 5. 運用・監査テーブル

### audit_log — 監査ログ（変更履歴追跡）

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| id | serial | NO | **PK** |
| table_name | varchar(50) | NO | 対象テーブル名 |
| record_id | varchar(50) | NO | PO番号等のレコード識別子 |
| action | varchar(20) | NO | created / updated / deleted |
| changed_by | varchar(100) | YES | Slack ID or ユーザー名 |
| field_name | varchar(100) | YES | 変更フィールド名 |
| old_value | text | YES | 変更前の値 |
| new_value | text | YES | 変更後の値 |
| metadata | jsonb | YES | 追加コンテキスト |
| created_at | timestamptz | NO | default: now() |

**インデックス**: (table_name, record_id), created_at, changed_by

**用途**: purchase_requestsのステータス更新時に自動記録。障害時のデータ不整合調査に使用。

---

### dead_letter_queue — 失敗タスクキュー（DLQ）

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| id | serial | NO | **PK** |
| task_id | varchar(100) | NO | 対象レコードID（PO番号等） |
| task_type | varchar(50) | NO | mf_journal_create / slack_notify 等 |
| error_message | text | NO | エラー内容 |
| retry_count | integer | NO | リトライ回数 |
| payload | jsonb | YES | リトライ用パラメータ |
| resolved_at | timestamptz | YES | 解決済み日時（NULLなら未解決） |
| created_at | timestamptz | NO | default: now() |

**インデックス**: task_type, created_at

**用途**: MF会計API等の外部API呼出し失敗時に記録。指数バックオフでリトライ後、失敗確定でOPSチャンネルに通知。

---

### account_corrections — 勘定科目修正履歴（学習ループ用）

| 列 | 型 | NULL | 備考 |
|---|---|---|---|
| id | serial | NO | **PK** |
| po_number | varchar(30) | NO | 対象PO番号 |
| item_name | varchar(500) | NO | 品目名 |
| supplier_name | varchar(200) | YES | 仕入先 |
| department | varchar(100) | YES | 部門 |
| total_amount | integer | YES | 金額（円） |
| estimated_account | varchar(100) | NO | AI推定の勘定科目 |
| estimated_tax_type | varchar(50) | YES | AI推定の税区分 |
| estimated_confidence | varchar(10) | YES | 推定信頼度（high/medium/low） |
| corrected_account | varchar(100) | NO | ユーザーが確定した勘定科目 |
| corrected_tax_type | varchar(50) | YES | ユーザーが確定した税区分 |
| corrected_by | varchar(100) | YES | 修正者名 |
| created_at | timestamptz | NO | default: now() |

**インデックス**: supplier_name, item_name, created_at

**用途**: 仕訳管理画面で科目を変更した際に自動記録。AI勘定科目推定時にRAGコンテキストとして注入し、推定精度を向上させる学習ループの基盤。

---

## 6. 外部キー参照（論理的、実FK制約は未設定）

```
purchase_requests.applicant_slack_id → employees.slack_id
purchase_requests.approver_slack_id  → employees.slack_id
purchase_requests.inspector_slack_id → employees.slack_id
purchase_requests.mf_account_code    → mf_accounts.code
purchase_requests.mf_tax_code        → mf_taxes.code
purchase_requests.mf_department_code → mf_departments.code
purchase_requests.mf_counterparty_code → mf_counterparties.code
purchase_requests.mf_project_code    → mf_projects.code
purchase_requests.mf_sub_account_code → mf_sub_accounts.code

predicted_transactions.po_number              → purchase_requests.po_number
predicted_transactions.mf_office_member_id    → employees.mf_office_member_id
predicted_transactions.applicant_slack_id     → employees.slack_id
```

※ 実DBでは FOREIGN KEY 制約は未設定（パフォーマンスとマスタ同期の柔軟性のため）

---

## 7. GAS時代との主な差分

| 項目 | GAS時代 | 現行 |
|------|--------|------|
| 列数 | 37列（Phase 1仕様） | 54列（B案拡張分含む） |
| 列名 | 日本語混在 | snake_case統一 |
| employees.email | なし | **追加**（Google OAuth照合用） |
| employees.mf_office_member_id | なし | **追加**（MF経費連携用） |
| predicted_transactions.mf_office_member_id | なし | **追加**（card_last4に依存しない照合用） |
| predicted_transactions.mf_ex_transaction_id | なし | **追加**（MF経費紐付け） |
| slack_event_log | なし | **追加**（冪等性管理、GASでは不可能だった） |
| delivery_note_file_url | なし | **追加**（納品書対応） |
| インデックス | なし | 多数（ステータス別・card_last4検索等） |
| トランザクション | 不可 | 可能 |
| JOIN | 不可 | 可能 |
| Enum制約 | なし | Postgres enum型 |

---

## 8. マイグレーション管理

### 適用方法

```bash
# 1. スキーマ変更後、マイグレーション生成
npx drizzle-kit generate

# 2. 生成された src/db/migrations/XXXX_*.sql を確認

# 3. 適用
npx tsx scripts/apply-migration.ts
```

**注意**: `drizzle-kit push` はTTY必須なので `scripts/apply-migration.ts` を使う。

### データ移行

既存GASスプレッドシートからのデータ移行:
```bash
npx tsx scripts/migrate-from-gas.ts --dry-run   # 確認
npx tsx scripts/migrate-from-gas.ts              # 実行
```

冪等性: 何度実行しても結果は同じ（ON CONFLICT UPDATE / UPSERT）。

---

## 9. 接続方法

### アプリケーション内

```typescript
// 通常クエリ（PgBouncer経由）
import { db } from "@/db";
import { employees } from "@/db/schema";
import { eq } from "drizzle-orm";

const rows = await db.select().from(employees).where(eq(employees.isActive, true));
```

### db-client経由（gas-client互換）

```typescript
// 既存コードはこちらを使う
import { getEmployees } from "@/lib/gas-client"; // 実体は db-client.ts
const result = await getEmployees();
```

### 環境変数

```
POSTGRES_URL                = PgBouncer経由（通常クエリ用）
POSTGRES_URL_NON_POOLING    = 直接接続（マイグレーション・トランザクション用）
```

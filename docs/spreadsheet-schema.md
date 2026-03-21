# スプレッドシートスキーマ設計

## 方針

- 既存WFのシートとは別に **新規スプレッドシート** を作成
- Phase 1 で使う列のみ定義、MF会計連携列は Phase 3 で追加
- 並行運用期間中は旧シートと新シートが共存
- 旧WF廃止後、旧シートはアーカイブ

---

## 購買台帳シート

| # | 列名 | 型 | 必須 | 備考 |
|---|------|-----|------|------|
| 1 | po_number | string | * | PO-YYYYMM-NNNN（Bot自動発番） |
| 2 | status | enum | * | 申請済/承認済/発注済/検収済/証憑完了/計上済/支払済/差戻し |
| 3 | request_type | enum | * | 購入前/購入済 |
| 4 | applicant_slack_id | string | * | |
| 5 | applicant_name | string | * | |
| 6 | department | string | * | 従業員マスタから自動取得 |
| 7 | approver_slack_id | string | * | 従業員マスタから自動取得 |
| 8 | approver_name | string | * | |
| 9 | item_name | string | * | |
| 10 | unit_price | number | * | 税抜 |
| 11 | quantity | number | * | デフォルト: 1 |
| 12 | total_amount | number | * | 税抜（= unit_price × quantity） |
| 13 | payment_method | enum | * | 会社カード/請求書払い/立替 |
| 14 | purpose | enum | * | 業務利用/案件利用/その他 |
| 15 | delivery_location | enum | * | 本社/支社/リモート先 |
| 16 | supplier_name | string | * | 購入先名（テキスト入力） |
| 17 | url | string | | 購入先URL（任意） |
| 18 | hubspot_deal_id | string | | 案件利用の場合のみ |
| 19 | budget_number | string | | 実行予算番号（任意） |
| 20 | voucher_status | enum | * | none/uploaded/verified |
| 21 | slack_channel_id | string | * | 投稿先チャンネルID |
| 22 | slack_message_ts | string | * | メッセージ更新用タイムスタンプ |
| 23 | slack_thread_ts | string | | 証憑添付スレッド用 |
| 24 | approved_at | datetime | | |
| 25 | ordered_by | string | | 発注者名 |
| 26 | ordered_at | datetime | | |
| 27 | inspected_by | string | | 検収者名 |
| 28 | inspected_at | datetime | | |
| 29 | voucher_completed_at | datetime | | |
| 30 | notes | string | | 備考 |
| 31 | created_at | datetime | * | 申請日時 |
| 32 | updated_at | datetime | * | 最終更新日時 |

### ステータス遷移

```
購入前: 申請済 → 承認済 → 発注済 → 検収済 → 証憑完了 → 計上済 → 支払済
購入済: 申請済 → 検収済 → 証憑完了 → 計上済 → 支払済
差戻し: 任意のステータスから遷移可能
```

### PO番号発番ルール

- 形式: `PO-YYYYMM-NNNN`
- YYYYMM: 申請年月
- NNNN: 月内連番（0001始まり）
- GAS側で発番（既存ロジック踏襲）

---

## 従業員マスタシート

| # | 列名 | 型 | 備考 |
|---|------|-----|------|
| 1 | slack_user_id | string | Slack UID |
| 2 | name | string | 表示名 |
| 3 | department | string | 部門名 |
| 4 | approver_slack_id | string | 部門長のSlack UID |
| 5 | role | enum | 一般/部門長/管理本部 |

---

## Phase 3 で追加予定の列（購買台帳）

以下の列は MF会計Plus 連携時に追加する:

- supplier（購入先名）
- supplier_url（購入先URL — urlと統合検討）
- amazon_order_id（Amazon注文番号）
- amazon_seller（Amazon出品者）
- voucher_type（証憑種別）
- voucher_amount（証憑金額）
- amount_match（金額照合結果）
- mf_supplier（MF取引先）
- mf_invoice_number（適格番号）
- mf_tax_category（税区分）
- mf_summary（MF摘要）
- mf_journal_status（MF計上ステータス）

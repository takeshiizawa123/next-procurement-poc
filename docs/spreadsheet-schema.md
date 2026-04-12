# スプレッドシートスキーマ設計（歴史的記録）

> ⚠️ **このドキュメントはGAS時代の設計記録です（2026-04-11以前）**
>
> 2026-04-11 に Supabase Postgres への移行が完了しました。
> **現在のDBスキーマは `docs/db-schema.md` を参照してください。**
>
> このドキュメントは履歴・設計経緯として保存されています。実装との乖離があります。

---

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
| 33 | registration_number | string | | 適格請求書登録番号（T+13桁） |
| 34 | is_qualified_invoice | enum | | 適格 / 非適格 / 番号なし |
| 35 | invoice_verification_status | enum | | verified / not_found / no_number / error |
| 36 | purchase_date | date | | 購入日（事後報告・概算確定時に使用） |

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
| A | name | string | 表示名 |
| B | departmentCode | string | 部門コード |
| C | departmentName | string | 部門名 |
| D | slackAliases | string | Slack別名（カンマ区切り） |
| E | slackId | string | Slack UID |
| F | deptHeadSlackId | string | 部門長のSlack UID |
| G | card_last4 | string | MFビジネスカード下4桁（例: 3815） |
| H | card_holder_name | string | カード券面名義（例: TARO TANAKA） |

> G・H列はカード明細照合に必須。従業員にカードが発行されていない場合は空欄。

---

## 予測カード明細シート（predicted_card_transactions）

購買承認時に自動生成される照合用予測データ。シート名: `予測カード明細`

| # | 列名 | 型 | 備考 |
|---|------|-----|------|
| A | id | string | 予測ID（PCT-YYYYMM-NNNN） |
| B | po_number | string | 購買番号 or 出張報告番号 |
| C | type | string | purchase / trip_transport / trip_hotel / trip_daily |
| D | card_last4 | string | 使用予定カード下4桁 |
| E | predicted_amount | number | 予測金額（税込） |
| F | predicted_date | string | 予測利用日（YYYY-MM-DD） |
| G | supplier | string | 取引先名 |
| H | applicant | string | 申請者名 |
| I | stage1_journal_id | number | Stage 1仕訳ID（あれば） |
| J | status | string | pending / matched / unmatched / cancelled |
| K | matched_journal_id | number | マッチしたStage 2仕訳ID |
| L | matched_at | string | マッチ日時 |
| M | amount_diff | number | 実額との差額 |
| N | created_at | string | 作成日時 |
| O | is_estimate | boolean | 概算フラグ（金額未確定の場合 true） |
| P | is_post_report | boolean | 事後報告フラグ（事前承認なしの緊急購入） |
| Q | emergency_reason | string | 緊急理由（事後報告時のみ） |

> シートは初回の予測生成時に自動作成される（GAS webApi.js `getPredictionSheet()`）

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
- mf_tax_category（税区分）
- mf_summary（MF摘要）
- mf_journal_status（MF計上ステータス）

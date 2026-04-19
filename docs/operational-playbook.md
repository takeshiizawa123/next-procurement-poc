# 管理本部 運用プレイブック（Operational Playbook）

**対象**: 管理本部スタッフ
**更新日**: 2026-04-19

購買管理システムの日次・週次・月次の運用ルーチン。本番切替後の定常運用手順。

---

## 毎日（日次業務）

### 朝一番（9:00頃）

1. **📊 ダッシュボード確認** — https://next-procurement-poc-tau.vercel.app/admin/dashboard
   - 🚨アラート欄に未解決項目がないか
   - 昨夜の自動Cron結果（Slack #purchase-ops）

2. **承認待ち一覧確認** — `/admin/journals` or ダッシュボード
   - 3日以上承認待ちの案件があれば部門長にリマインド

3. **DLQ確認** — `/admin/dlq`
   - 未解決件数が0件であることを確認
   - あれば原因調査→解決済マーク or 削除

### 日中（申請対応）

4. **仕訳管理** — `/admin/journals`
   - AI推定科目を確認し、必要なら修正（学習ループにフィードバック）
   - 「契約仕訳」タブで契約請求書の仕訳登録

5. **Slack #purchase-ops 監視**
   - 新規申請（申請者がSlackで申請した場合）
   - エスカレーション通知への即応

6. **証憑漏れ対応**
   - Day3（3日経過）: 自動でスレッドに公開催促（設定済）
   - Day7（1週間経過）: 自動で部門長にエスカレーション（設定済）
   - Day14（2週間経過）: 管理本部に作業凍結提案通知（設定済）→ **人間が判断**

### 夕方（17:00頃）

7. **今日の処理件数確認** — ダッシュボード
8. **明日以降の予定確認**
   - 月末が近い: 見積計上の実行確認
   - 月初直後: リバース処理の確認
   - 金曜: 週末までに仕訳完了させるPOの洗い出し

---

## 毎週

### 月曜日

1. **カード照合結果確認** — 先週末〜本日の `card-reconciliation` cron結果
   - Slack #purchase-ops のレポート
   - 未マッチ件数、候補マッチ件数
   - 未申請カード利用があれば該当従業員に確認

2. **契約管理レビュー** — `/admin/contracts`
   - 期限30日以内の契約確認
   - 更新判断をdept担当者と調整

### 金曜日

3. **週次レポート**（任意）
   - ダッシュボードのスクショを経営層に共有
   - 特記事項があればSlackチャンネルに

---

## 毎月

### 月末（最終営業日）

1. **見積計上確認** — `contract-accrual` cron実行後
   - Slack通知で「月末見積計上 X件」を確認
   - 請求書未着契約がリストアップされている

2. **立替・出張手当の月次集計** — `/admin/expense/payroll`
   - 対象月を選択
   - 集計結果を確認
   - 社員コード未マッピング警告があれば対応

### 月初（翌月1-3営業日）

3. **リバース処理確認** — `contract-reversal` cron実行後
   - 前月見積仕訳の洗替が正常完了

4. **給与連携CSV出力** — `/admin/expense/payroll`
   - 「📋 給与一覧表用コピー」クリック
   - 給与関連一覧表の該当列にペースト
   - MF用シート更新 → CSV保存 → MF給与にインポート

5. **月次仕訳レビュー** — `/admin/journals`
   - 月内に作成された仕訳をMF会計Plusとつき合わせ
   - 差異があれば `mf-journal-sync` cron結果も参照

6. **Notion同期確認** — `/admin/notion-sync`
   - 月次フロー図・プロンプト同期が完了しているか

### 月中（15日）

7. **給与支給日**（翌月15日が給与支給日）
   - 立替・出張手当が正しく振り込まれたか確認
   - 従業員から問い合わせあれば個別対応

---

## 毎四半期

1. **MF OAuth トークン有効期限確認**
   - Vercel環境変数 `MF_OAUTH_REFRESH_TOKEN` の期限
   - 必要なら再発行

2. **バックアップ復旧訓練** — `docs/backup-restore-sop.md`
   - モックDBでの復旧テスト

3. **監査ログレビュー**
   - `/api/admin/audit-log` で大量変更パターンがないか

4. **アクセス権限棚卸し**
   - `employees.isActive=true` 全員がまだ在籍しているか
   - 退職済み従業員の社員コード整理

---

## 操作早見表

### 新規申請の対応

| 申請種別 | 申請者の動作 | 管理本部の対応 |
|---------|------------|--------------|
| 物品購買 | `/purchase/new` | 承認後の進捗監視・証憑確認 |
| 役務（スポット） | `/purchase/new` type="役務" | 役務完了確認後、請求書待ち |
| 出張 | `/trip/new` | 日当計算を確認、月次集計 |
| 立替 | `/expense/new` | 証憑OCR結果を確認、仕訳登録 |
| 継続契約 | `/admin/contracts/new`（管理本部） | 月次請求書登録・承認 |

### 各種管理画面

| URL | 用途 | 頻度 |
|-----|------|-----|
| `/admin/dashboard` | 全体KPI | 毎日 |
| `/admin/journals` | 仕訳管理 | 毎日 |
| `/admin/contracts` | 契約管理 | 週次 |
| `/admin/card-matching` | カード照合 | 月次+必要時 |
| `/admin/expense/payroll` | 給与連携 | 月次 |
| `/admin/dlq` | 失敗タスク | 毎日（警告時） |
| `/admin/employees/payroll-mapping` | 社員コード | 入退社時 |
| `/admin/notion-sync` | Notion同期 | 任意 |
| `/admin/approval-routes` | 承認ルート | 組織変更時 |
| `/admin/trip-controls` | 出張統制 | 月次 |

### Cronスケジュール早見

| Cron | 頻度 | JST | 役割 |
|------|------|-----|------|
| cache-warm | 4分毎 | - | Redisキャッシュ維持 |
| voucher-reminder | 日次 | 10:00 | 証憑催促 |
| daily-summary | 日次 | 9:00 | 日次サマリー |
| weekly-reminder | 週次 | 月9:00 | 週次リマインド |
| card-reconciliation | 週次 | 月11:00 | カード照合+契約マッチ |
| daily-variance | 日次 | 12:00 | 金額差異アラート |
| trip-controls | 月次 | 1日10:00 | 出張分析 |
| db-backup | 日次 | 3:00 | DB全件JSON |
| data-cleanup | 月次 | 1日4:00 | 古いログ削除 |
| contract-alerts | 日次 | 9:00 | 契約更新+督促 |
| contract-accrual | 月次 | 28日23:00 | 月末見積計上 |
| contract-reversal | 月次 | 1日1:00 | 月初リバース |
| notion-sync | 日次 | 18:00 | 契約Notion同期 |
| changelog-sync | 日次 | 19:00 | Gitコミット履歴 |
| **mf-journal-sync** | 日次 | 0:00 | MF仕訳削除検知 |

---

## よくある質問（FAQ）

### Q. 申請者が「承認されない」と言ってきた
A. `/admin/dashboard` で該当PO確認 → 承認者を確認 → 代替承認者が対応可能

### Q. 仕訳がMF会計Plusに反映されていない
A. 
1. `/admin/journals` でMF仕訳IDが入っているか確認
2. なければ `/admin/journals` から手動仕訳登録
3. あるのにMF側にない → `mf-journal-sync` cronが明日検知予定

### Q. カード明細がこない月はどうする
A. MF経費側のAPIヘルスを確認 → 手動で明細エクスポートしてCSVインポート

### Q. 給与連携で社員コード「未設定」警告が出る
A. `/admin/employees/payroll-mapping` で該当従業員に6桁コード登録

### Q. 契約書PDFをアップロードしたい
A. `/admin/contracts/batch-upload` で一括OCR+Notion保管

### Q. システムが完全に動かない
A. `docs/troubleshooting.md` 参照

---

## エスカレーション基準

| レベル | 症状例 | 対応 |
|-------|--------|------|
| 🟢 Low | 画面の表示が一時遅い | 様子見 |
| 🟡 Medium | 特定機能のエラー | 1日以内に開発担当に連絡 |
| 🟠 High | 承認・仕訳が複数案件失敗 | 即時Slack DM + 翌朝確認 |
| 🔴 Critical | 全画面500エラー・データ喪失疑い | 即時電話+全関係者Slack DM |

連絡先:
- 開発担当: 伊澤（Slack DM優先）
- Vercelサポート: https://vercel.com/help
- Supabaseサポート: support@supabase.com

---

## 関連ドキュメント

- `docs/troubleshooting.md` — 障害対応
- `docs/backup-restore-sop.md` — バックアップ復旧
- `docs/user-offboarding.md` — 退職時処理
- `docs/production-cutover-plan.md` — 本番切替計画
- `docs/user-guide.md` — 従業員向けガイド

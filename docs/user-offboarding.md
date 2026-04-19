# 退職時PO引継ぎ手順（User Offboarding）

**対象**: 人事・管理本部
**更新日**: 2026-04-19

従業員退職時の購買管理システム上での未完了案件・権限整理手順。

---

## 事前チェックリスト（退職決定時点）

退職日が確定したら、退職日の**14日前まで**に以下を実施:

- [ ] 退職者の未完了PO一覧を抽出
- [ ] 未完了案件の引き継ぎ先を決定
- [ ] 承認権限の移譲（部門長の場合）
- [ ] Slack App権限の削除予定日を決定

---

## Step 1: 未完了案件の洗い出し

### 退職者が **申請者** の案件

```bash
# /admin/purchase で検索（申請者名または Slack ID）
# または直接DB検索
SELECT po_number, item_name, total_amount, status, application_date
FROM purchase_requests
WHERE applicant_slack_id = '<退職者のSlackID>'
  AND status NOT IN ('取消', '仕訳済')
ORDER BY application_date;
```

**取り扱い**:
- 申請中・承認待ち: 退職者に取消 or 新担当者に引き継ぎ判断させる
- 承認済・発注済: **新担当者（引継ぎ者）を `applicantSlackId` に変更**
- 検収済・証憑待ち: 証憑を新担当者が添付 → 通常仕訳処理

### 退職者が **検収者** の案件

```sql
SELECT po_number, item_name, inspector_slack_id, status
FROM purchase_requests
WHERE inspector_slack_id = '<退職者のSlackID>'
  AND status IN ('承認済', '発注済');
```

**取り扱い**:
- 同部門の後任者を検収者に変更
- 変更方法: `/admin/purchase/<poNumber>` で編集（検収者欄）
  - または直接DB更新 + 監査ログ記録

### 退職者が **承認者（部門長）** の案件

```sql
SELECT po_number, item_name, approver_slack_id, status
FROM purchase_requests
WHERE approver_slack_id = '<退職者のSlackID>'
  AND status = '申請済';
```

**取り扱い**:
- 新部門長（または代替承認者）に変更
- **複数あれば一括変更**: SQL更新スクリプト

---

## Step 2: 退職者による最終処理

退職日の**3日前まで**に、退職者本人に以下を依頼:

1. 未提出の証憑すべてをSlackスレッドに添付
2. 立替経費の申請漏れがないか確認
3. 承認待ち案件のうち取消するものを本人が取消
4. 出張精算の未完了があれば完了させる

---

## Step 3: 権限・承認ルート整理

### 部門長退職の場合

`/admin/approval-routes` で該当部門の承認者を変更:

1. 対象部門の選択
2. 新部門長のSlack ID入力
3. 副部門長（代替承認者）も更新

環境変数更新（必要なら）:
```
SLACK_ALTERNATE_APPROVERS=<新しい代替承認者SlackIDs>
```

### 一般社員退職の場合

- 従業員マスタ (`employees`) で `isActive = false` に変更
- `payrollCode` は **削除せず保持**（過去の給与連携CSVとの整合性のため）

---

## Step 4: 権限削除（退職日当日）

- [ ] Slack WorkspaceからSingle-Channel Guestにdowngrade
- [ ] 購買管理システムのSlack App DMを停止
- [ ] MF経費・MF会計PlusのIAM削除（管理本部がIT部門と連携）
- [ ] カード返却確認（MFビジネスカード）

### 技術的な処理

```sql
-- 従業員マスタを非アクティブ化
UPDATE employees
SET is_active = false, updated_at = NOW()
WHERE slack_id = '<退職者SlackID>';

-- 承認権限がまだ残っている場合は代替者に自動移譲
UPDATE purchase_requests
SET approver_slack_id = '<代替承認者SlackID>'
WHERE approver_slack_id = '<退職者SlackID>'
  AND status = '申請済';
```

---

## Step 5: 退職後30日間のモニタリング

- 退職者宛の自動DM/リマインダーが飛ばないか確認
  - `voucher-reminder`, `approval-reminder` 等
- `/admin/dashboard` で該当者の案件が残っていないか
- 証憑漏れによる月次締めの遅延リスクチェック

---

## 特殊ケース

### 急な退職・死亡退職

1. **即座** に `employees.isActive = false`
2. **未完了全案件** を管理本部に引き上げ（一時的な接続先）
3. 関係者（部門・取引先）に遅延連絡
4. 段階的に新担当者に再配分

### 長期休職（産休・育休・病欠）

- 退職扱いではなく **isActive=true維持、approverはbackup設定**
- 復職時に元に戻す

### 出向・転籍

- 出向先での購買権限を確認
- 転籍なら退職と同じ扱い、出向なら一部権限維持

---

## 引継ぎテンプレート（退職者→後任者）

```markdown
# 退職引継ぎ - 購買管理

## 未完了案件
- PR-202604-0001 ノートPC購入（承認待ち、金額¥150,000）
  → 引継ぎ先: XXXさん
  → 対応: 承認取得して発注進める

## 承認権限
- 部門長として承認中の案件: 3件（後任者に移管済）

## 係員としての業務
- 月次契約書レビュー（SaaS契約）: 毎月10日まで
- 出張手当集計確認: 毎月給与締め前

## アクセス権限
- 購買管理Web: 削除済
- MFカード: 返却済
- Slack App DM: 停止済

## 引継ぎ漏れがあれば
- 管理本部（XXX）まで
```

---

## 自動化の検討（将来）

現在は手動プロセス。将来的に以下を自動化できる:

- 退職登録 → `/admin/employees/offboard?slackId=XXX&transferTo=YYY&lastDay=2026-05-15`
- API: 未完了案件の一括リスト取得＋引継ぎ先フィールド一括更新
- Slack通知: 「退職者XXの未完了N件があります」を月次で管理本部にDM

実装するならチケット化: `issue: automate-user-offboarding`

---

## チェックリスト（退職処理完了確認）

- [ ] 未完了案件すべて引継ぎ済
- [ ] 承認権限移譲完了
- [ ] 従業員マスタ非アクティブ化
- [ ] Slack App DM停止
- [ ] 外部サービス（MF系）権限削除
- [ ] カード返却確認
- [ ] 30日モニタリング開始
- [ ] 引継ぎドキュメント後任者に共有

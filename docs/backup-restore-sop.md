# バックアップ・復旧手順書（Backup / Restore SOP）

**対象**: 開発担当（通常運用）+ 管理本部（緊急時）
**更新日**: 2026-04-19

Postgresデータベースの日次バックアップと、障害時の復旧手順。

---

## バックアップ仕様

### 自動バックアップ

- **頻度**: 日次（毎日 JST 03:00 = UTC 18:00）
- **実行元**: Vercel Cron `/api/cron/db-backup`
- **保存先**: Google Drive （`GOOGLE_DRIVE_BACKUP_FOLDER_ID` 環境変数で指定）
- **ファイル名**: `db-backup-YYYY-MM-DD.json`
- **保持期間**: **永久**（古いバックアップも削除しない）
- **形式**: 全テーブルのJSON dump（1ファイル）

### バックアップ対象テーブル

- `purchase_requests`（購買申請）
- `contracts` / `contract_invoices`（契約）
- `employees`（従業員マスタ）
- `mf_masters_accounts` / `mf_masters_taxes` / `mf_masters_departments`（MF会計マスタ）
- `account_corrections`（仕訳学習履歴）
- `audit_log`（監査ログ）
- `dead_letter_queue`（失敗タスク）
- `predicted_transactions`（カード予測）
- その他全ドメインテーブル

### バックアップ成否確認

1. 毎朝 JST 09:00 に Slack #purchase-ops を確認（失敗時はアラート）
2. Google Driveで該当日のファイル存在確認
3. ファイルサイズが急激に減っていないか（通常10-500KB、桁変動は異常）

---

## 復旧シナリオ別手順

### シナリオ1: 特定レコードの誤削除・誤更新

**例**: 承認済みPOを誤って取消ステータスにしてしまった

**手順**:
```bash
# 1. 該当PO番号の監査ログを確認
curl -H "x-api-key: $INTERNAL_API_KEY" \
  "https://next-procurement-poc-tau.vercel.app/api/admin/audit-log?recordId=PR-202604-0001"

# 2. 変更前値を特定（例: "承認済" → "取消" を確認）

# 3. 直接DB更新（Supabase SQL Editor or run-migrations経由）
UPDATE purchase_requests
SET status = '承認済', updated_at = NOW()
WHERE po_number = 'PR-202604-0001';

# 4. 監査ログに記録（手動復旧の履歴）
INSERT INTO audit_log (table_name, record_id, action, changed_by, field_name, old_value, new_value, metadata)
VALUES ('purchase_requests', 'PR-202604-0001', 'manual_restore', '<担当者名>', 'status', '取消', '承認済',
  '{"reason": "誤操作の復旧", "ticket": "..."}'::jsonb);
```

### シナリオ2: 全テーブル復旧（特定日時点）

**例**: 2026-04-18時点に完全復旧したい

**手順**:
```bash
# 1. Google Driveから対象日のbackup JSONをダウンロード
#    db-backup-2026-04-18.json

# 2. 復旧スクリプト実行（要作成）
node scripts/restore-from-backup.mjs db-backup-2026-04-18.json

# スクリプトの動作:
# - 既存テーブルのデータを確認（上書き警告）
# - JSON内の各テーブルをTRUNCATE → INSERT
# - トランザクション内で全テーブル一括復旧
# - Foreign key制約を一時的にdefer
# - 最後にVACUUMで統計情報更新
```

**⚠️ 重要**: 全テーブル復旧は**最終手段**。必ず関係者（管理本部+開発者）の承認を得ること。

### シナリオ3: Postgresインスタンス丸ごと喪失

**対応**:
1. Supabase管理画面で新インスタンスをprovisioning
2. Vercel環境変数 `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL` を新インスタンスに差し替え
3. `supabase/migrations/` の全migrationを順次実行（drizzle-kit or run-migrations.mjs）
4. 最新のdb-backup JSONからデータ復旧

### シナリオ4: Supabase障害（Tokyo region全停止）

**対応**:
1. Supabaseステータスページ確認 → 復旧時刻確認
2. 短時間（< 4h）なら待機
3. 長時間障害なら:
   - Vercelをメンテナンスモードに（`vercel.json` rewrite追加）
   - Slackで全社通知「一時的に申請受付停止」
   - 復旧後、受付再開を周知

---

## 復旧スクリプト（要作成）

以下のスクリプトは本番切替前に作成してテスト済みにしておく:

### `scripts/restore-from-backup.mjs`

```javascript
/**
 * 使い方: node scripts/restore-from-backup.mjs <backup.json>
 *
 * 注意: 既存データを全削除します。実行前に確認プロンプトあり。
 */
import postgres from "postgres";
import fs from "fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const backupFile = process.argv[2];
if (!backupFile) { console.error("Usage: node scripts/restore-from-backup.mjs <file.json>"); process.exit(1); }

const backup = JSON.parse(fs.readFileSync(backupFile, "utf-8"));
const sql = postgres(process.env.POSTGRES_URL_NON_POOLING, { max: 1 });

// 確認プロンプト
console.log(`復旧対象: ${Object.keys(backup.tables).length}テーブル`);
console.log("本当に実行しますか? (yes/no)");
// readline で入力待ち → yes なら続行

try {
  await sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    for (const [tableName, rows] of Object.entries(backup.tables)) {
      await tx`TRUNCATE TABLE ${sql(tableName)} CASCADE`;
      if (rows.length > 0) {
        // バッチinsert
        // ...
      }
    }
  });
  console.log("✓ 復旧完了");
} finally {
  await sql.end();
}
```

**⚠️ 制約**:
- 外部キー順に復旧する必要あり（employees → purchase_requests の順）
- serial型のIDはそのまま挿入、sequence再設定が必要（`SELECT setval(...)`）
- 100KB超のJSONはストリーム処理

---

## テスト手順（復旧訓練）

四半期ごとに以下を実施:

1. **モックDB** で復旧テスト
   - ローカル開発用Supabaseプロジェクト用意
   - 本番バックアップをダウンロード→モックDBに復旧
   - アプリを起動→主要機能が動くか確認

2. **結果を記録**
   - 所要時間
   - 発見した問題
   - スクリプト改善点

3. **SOP更新**
   - 発見した問題を本ドキュメントに反映

---

## バックアップ関連コマンド早見表

### 現在のバックアップファイル一覧確認
```bash
# Google Drive APIで確認（要OAuth）
# または https://drive.google.com/ で GOOGLE_DRIVE_BACKUP_FOLDER_ID を直接開く
```

### 特定テーブルだけダンプ
```bash
# Supabase Dashboard → Database → Backups でpg_dumpベースのバックアップも取得可
# 定期バックアップ（pg_dump）と本システムのアプリケーションバックアップ（JSON）は別物
```

### 手動でバックアップ実行
```bash
# Cronを手動トリガー
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://next-procurement-poc-tau.vercel.app/api/cron/db-backup"
```

### 直接PostgresのSQL実行
```bash
# マイグレーションスクリプト経由（安全）
node scripts/run-migrations.mjs path/to/recovery.sql
```

---

## 監査対応

監査人から「データの完全性を証明せよ」と言われた場合:

1. `audit_log` テーブルの全件dump
2. 日次バックアップファイル一覧（Google Drive）
3. Supabaseのpoint-in-time recoveryログ（Pro plan以上）
4. 本ドキュメントと `docs/production-cutover-plan.md`

---

## 既知の制約

- **Point-in-time recovery (PITR)**: Supabase Free planでは7日間のみ、秒単位復旧は不可。Proプラン($25/月)で30日間・秒単位復旧可
- **バックアップの暗号化**: Google Drive自体のデフォルト暗号化のみ（追加暗号化なし）
- **PII保護**: バックアップJSONには個人情報（氏名・メール）含む → アクセス権限管理は厳格に

---

## 緊急連絡先

データ喪失が疑われる場合:
1. Slack DMで開発担当 + 管理本部
2. 即座に書き込み停止（Vercelメンテナンスモード）
3. 調査完了まで復旧作業は開始しない（さらなる破損を避ける）

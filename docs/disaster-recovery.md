# 障害復旧手順書（Disaster Recovery Runbook）

**最終更新**: 2026-04-12
**対象**: next-procurement-poc (Vercel + Supabase)
**担当**: 管理本部 + 開発チーム

---

## 1. システム構成と依存関係

```
ユーザー → Vercel (Next.js) → Supabase Postgres (Tokyo)
                             → Upstash Redis (Tokyo)
                             → Slack API
                             → MF会計Plus API
                             → MF経費API
                             → Gemini Vision API
                             → Google Drive API
                             → 国税庁API
```

| コンポーネント | 障害時の影響 | 代替手段 |
|---------------|------------|---------|
| Supabase Postgres | 全機能停止（データアクセス不可） | なし（CRITICAL） |
| Upstash Redis | キャッシュミス、レスポンス遅延 | インメモリフォールバック（自動） |
| Slack API | 通知・承認不可 | Webアプリで代替操作可能 |
| MF会計Plus | 仕訳登録不可 | 手動でMF会計に直接入力 |
| MF経費 | カード明細取得不可 | 月次照合UIでCSV手動処理 |
| Gemini Vision | OCR不可 | 手動で金額確認 |
| Vercel | Web/API全停止 | Vercelステータスページ確認 |

---

## 2. 障害レベル定義

| レベル | 条件 | 対応時間目標 |
|--------|------|------------|
| P1 (Critical) | DB障害、データ損失、全機能停止 | 1時間以内に初動 |
| P2 (High) | 主要機能停止（承認/申請不可） | 4時間以内 |
| P3 (Medium) | 一部機能停止（照合/OCR等） | 24時間以内 |
| P4 (Low) | パフォーマンス低下 | 次営業日 |

---

## 3. 障害シナリオ別対応手順

### 3.1 Supabase DB障害

**症状**: APIが500エラー、「DB接続エラー」ログ

**対応手順**:
1. Supabase Dashboard (`app.supabase.com`) でプロジェクトステータスを確認
2. ステータスが "Degraded" → Supabase Status Page (`status.supabase.com`) を確認
3. 接続エラーの場合:
   - PgBouncer接続（POSTGRES_URL）で試行
   - 直接接続（POSTGRES_URL_NON_POOLING）で試行
4. DB自体がダウンの場合:
   - Supabaseサポートに連絡
   - #purchase-ops に「DB障害中、復旧待ち」と投稿
   - Slackでの承認操作は手動運用に切替

**データ復旧（Proプラン）**:
```bash
# Supabase Dashboard → Backups → Point-in-Time Recovery
# 障害発生前のタイムスタンプを指定してリストア
# 注意: PITRは上書きリストア（現在のデータが消える）
```

### 3.2 Vercel障害

**症状**: Webサイトにアクセスできない、APIタイムアウト

**対応手順**:
1. Vercel Status Page (`vercel-status.com`) を確認
2. デプロイメント問題の場合:
   ```bash
   # 前のデプロイメントにロールバック
   npx vercel rollback --prod
   ```
3. Vercel自体の障害の場合 → 復旧待ち
4. 代替手段: Slackの既存スレッドでボタン操作は可能（APIが復旧次第反映）

### 3.3 Slack API障害

**症状**: 通知が届かない、ボタンが反応しない

**対応手順**:
1. Slack Status (`status.slack.com`) を確認
2. Webhook配信遅延の場合 → 通常は自動復旧（Slackがリトライ）
3. 長時間障害の場合:
   - Webアプリ (`/purchase/my`, `/admin/journals`) で代替操作
   - 承認はWebアプリの詳細ページから可能

### 3.4 MF会計Plus API障害

**症状**: 仕訳登録が失敗、OAuthトークン更新エラー

**対応手順**:
1. MF会計Plusの管理画面にログインできるか確認
2. OAuthトークン期限切れの場合:
   ```bash
   # /api/mf/auth にアクセスして再認証
   open https://next-procurement-poc-tau.vercel.app/api/mf/auth
   ```
3. API障害の場合 → dead_letter_queue テーブルに失敗タスクが記録される
4. 復旧後:
   ```sql
   -- DLQの未解決タスクを確認
   SELECT * FROM dead_letter_queue WHERE resolved_at IS NULL ORDER BY created_at DESC;
   ```
5. 手動対応: MF会計Plus管理画面から直接仕訳入力

### 3.5 データ不整合（購買ステータス矛盾）

**症状**: SlackメッセージとDBのステータスが一致しない

**対応手順**:
1. 該当PO番号のデータを確認:
   ```sql
   SELECT po_number, status, approved_at, ordered_at, inspected_at
   FROM purchase_requests
   WHERE po_number = 'PO-XXXXXX-XXXX';
   ```
2. 監査ログで変更履歴を確認:
   ```sql
   SELECT * FROM audit_log
   WHERE table_name = 'purchase_requests' AND record_id = 'PO-XXXXXX-XXXX'
   ORDER BY created_at DESC;
   ```
3. 正しいステータスに手動修正:
   ```sql
   UPDATE purchase_requests SET status = '承認済' WHERE po_number = 'PO-XXXXXX-XXXX';
   ```
4. Slackメッセージを更新（必要に応じて）

### 3.6 Cron Job 停止

**症状**: 日次サマリが投稿されない、証憑催促が来ない

**対応手順**:
1. Vercel Dashboard → Cron Jobs でステータス確認
2. 個別にcronを手動実行:
   ```bash
   # 日次サマリ
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://next-procurement-poc-tau.vercel.app/api/cron/daily-summary

   # 証憑催促
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://next-procurement-poc-tau.vercel.app/api/cron/voucher-reminder

   # キャッシュウォーム
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://next-procurement-poc-tau.vercel.app/api/cron/cache-warm
   ```
3. 環境変数 `CRON_SECRET` が正しいか確認

---

## 4. バックアップ方針

### 4.1 データベースバックアップ

| 項目 | 設定 |
|------|------|
| 方式 | Supabase自動バックアップ（Proプラン） |
| 頻度 | 日次（自動） |
| 保持期間 | 7日間（Proプラン標準） |
| PITR | 有効（Proプラン、秒単位のリストア可能） |
| リストア方法 | Supabase Dashboard → Backups → Restore |

### 4.2 コードバックアップ

| 項目 | 設定 |
|------|------|
| リポジトリ | GitHub (`takeshiizawa123/next-procurement-poc`) |
| ブランチ戦略 | master (本番) |
| デプロイ履歴 | Vercel（直近100デプロイメント保持） |
| ロールバック | `npx vercel rollback --prod` |

### 4.3 外部データバックアップ

| データ | バックアップ元 | 方法 |
|--------|-------------|------|
| 証憑ファイル | Google Drive | Google Vault（7年保持） |
| MF会計仕訳 | MF会計Plus | MF管理画面からCSVエクスポート |
| Slackメッセージ | Slack | Slack Enterprise Export（必要時） |

---

## 5. 復旧確認チェックリスト

障害復旧後に以下を確認:

- [ ] `/api/test/health` が200を返すこと
- [ ] `/api/test/db` でDB接続・レイテンシが正常（<500ms）
- [ ] ダッシュボード (`/dashboard`) が表示されること
- [ ] マイページ (`/purchase/my`) が表示されること
- [ ] Slackで `/purchase` コマンドが動作すること
- [ ] Cron Job が次回スケジュールで実行されること
- [ ] OPSチャンネルに復旧完了を投稿

---

## 6. 連絡先

| 役割 | 連絡先 |
|------|--------|
| Supabase サポート | support@supabase.io / Dashboard内チャット |
| Vercel サポート | vercel.com/support |
| Slack API Status | status.slack.com |
| MF サポート | MF管理画面のサポートチャット |
| 社内開発担当 | #purchase-ops チャンネル |

---

## 7. Dead Letter Queue (DLQ) の運用

### 未解決タスクの確認

```sql
SELECT id, task_type, task_id, error_message, retry_count, created_at
FROM dead_letter_queue
WHERE resolved_at IS NULL
ORDER BY created_at DESC;
```

### タスクの手動再実行

DLQに記録されたタスクは、障害復旧後に手動で再実行する:

1. `task_type` と `payload` を確認
2. 該当APIを手動実行（curl等）
3. 成功したらDLQレコードを解決済みにする:
   ```sql
   UPDATE dead_letter_queue SET resolved_at = NOW() WHERE id = <DLQ_ID>;
   ```

### OPS通知

DLQ記録時に自動で #purchase-ops に通知されます:
```
🚨 タスク失敗（DLQ記録済み）
  タスク: mf_journal_create
  ID: PO-202604-0042
  エラー: MF API timeout after 30000ms
  リトライ: 4回試行後に断念
```

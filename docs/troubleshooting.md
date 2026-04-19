# 障害対応手順書（Troubleshooting）

**対象**: 管理本部・開発担当
**更新日**: 2026-04-19

システム異常時の切り分け・対応フローを症状別にまとめた手順書。

---

## 🚨 まず確認すべきこと（全障害共通）

1. **Slack #purchase-ops チャンネル** にCron失敗やDLQ通知が来ていないか
2. **https://next-procurement-poc-tau.vercel.app/admin/dashboard** のアラート欄
3. **https://next-procurement-poc-tau.vercel.app/admin/dlq** の未解決件数
4. Vercelステータス: https://www.vercel-status.com/
5. Supabaseステータス: https://status.supabase.com/

---

## 症状別対応表

### ⚠️ 症状1: Slack承認ボタンを押しても反応がない

**原因候補**:
- Vercel関数タイムアウト
- Slack署名検証失敗
- CRON_SECRET/INTERNAL_API_KEY漏れ

**対応手順**:
1. Slackメッセージを再度クリック→反応あれば一時的問題
2. Vercel Logs確認 → `vercel logs <deployment-url>` でエラー特定
3. `/admin/dlq` で関連タスクが記録されていないか確認
4. 症状が続く → `/admin/dashboard` でシステムヘルスチェック
5. 最終手段: 手動でGASステータスを変更してメッセージを継続

### ⚠️ 症状2: 仕訳登録ボタンで「MF OAuth認証失敗」エラー

**原因**: MF会計PlusのOAuthトークン切れ（通常30-90日）

**対応手順**:
1. Vercel環境変数 `MF_OAUTH_REFRESH_TOKEN` が有効か確認
2. MF会計Plus管理画面 → API連携 → リフレッシュトークン再発行
3. Vercel環境変数を更新（`MF_OAUTH_REFRESH_TOKEN`）
4. 再デプロイ不要（環境変数は次リクエストから反映）
5. 対象PR番号をメモしておき、復旧後に手動再仕訳

**予防**: 四半期ごとにMFトークンの有効期限を確認

### ⚠️ 症状3: カード照合cronが失敗している（#purchase-opsにエラー通知）

**原因候補**:
- MF経費APIレート制限
- MF経費認証切れ
- 大量明細によるタイムアウト

**対応手順**:
1. `/api/test/card-match-v2?from=YYYY-MM-DD&to=YYYY-MM-DD` を手動実行して切り分け
2. MF経費管理画面でカード明細が実際に取得できているか確認
3. 環境変数 `MF_EXPENSE_OAUTH_*` を確認
4. 1週間分だけ手動実行: `curl -H "Authorization: Bearer $CRON_SECRET" "https://next-procurement-poc-tau.vercel.app/api/cron/card-reconciliation"`
5. 解消しなければ翌週cron実行を待って自動復旧を確認

### ⚠️ 症状4: 証憑OCRが動かない / 結果が異常

**原因**: Gemini API障害 or API key無効化

**対応手順**:
1. https://status.cloud.google.com/ でGenAI障害確認
2. `GEMINI_API_KEY` の有効性を確認（Google Cloud Console）
3. 軽量確認: テスト用画像で `extractFromImage` を手動実行
4. 一時的にOCRをスキップし手動入力運用にする（ステータス変更）
5. 長期化する場合はプロビジョニング見直し

### ⚠️ 症状5: Notion同期エラー（#purchase-opsに通知）

**原因**: Notion API制限 or DB IDの改行混入 or プロパティ不一致

**対応手順**:
1. `/admin/notion-sync` で手動同期ボタンを押して症状確認
2. エラーメッセージ読む（`validation_error` なら該当DBのスキーマ確認）
3. Notion側でDB構造が変わっていないか確認（特にtitleプロパティ名）
4. `scripts/debug-notion-changelog.mjs` などでAPI直接テスト
5. 障害中もシステムは動作（Notion同期は non-blocking）

### ⚠️ 症状6: 申請者がDMで通知を受け取らない

**原因候補**:
- FORCE_TEST_MODE=true でテストチャンネルにリダイレクトされている
- Slack ID不一致
- Slack App権限切れ

**対応手順**:
1. 本番切替前ならFORCE_TEST_MODEによる意図的な動作 → 正常
2. 本番切替後なら `src/lib/slack-client.ts` の`FORCE_TEST_MODE = false`を確認
3. 申請者の `employees.slack_id` と実際のSlack IDが一致するか確認
4. Slack App管理画面でDM送信権限（`chat:write`, `im:write`）を確認

### ⚠️ 症状7: データが消えた / 変更された

**対応手順**:
1. **まず落ち着く** — Google Drive日次バックアップで復旧可能
2. 該当テーブルの監査ログを確認: `GET /api/admin/audit-log?recordId=XXX`
3. 変更者・変更前値を特定
4. 必要なら `docs/backup-restore-sop.md` に従って特定時点に復元
5. 関係者に経緯を共有（Slack #purchase-ops）

### ⚠️ 症状8: 仕訳が重複している（MF会計Plus）

**原因候補**:
- cronの並行実行（UNIQUE制約導入前の残存）
- 手動操作の二重クリック
- リトライ中の同時実行

**対応手順**:
1. MF会計Plus側で重複仕訳を特定
2. 古いほうを削除（日付・金額・摘要で判断）
3. 翌日のmf-journal-syncで削除検知→OPSに通知される
4. `/admin/journals` で該当PO番号の仕訳IDを確認して整合性検証

---

## 外部サービス別エスカレーション

### MF会計Plus

- 接続先: `https://accounting-plus.moneyforward.com/`
- API仕様: `docs/api-specs/openapi.yaml`
- 問い合わせ: 契約担当営業 or サポート（契約内容による）
- 障害時の影響: 仕訳登録停止・カード照合不可

### MF経費

- 接続先: `https://expense.moneyforward.com/`
- API仕様: `https://expense.moneyforward.com/api/index.html`
- 障害時の影響: カード明細取込停止・立替申請（MF経費直接入力分）停止

### MF給与

- APIなし、CSV連携のみ
- 障害時の影響: 月次給与振込遅延
- 代替: 従業員別立替・出張手当を手動計算

### Slack

- 接続先: `https://slack.com/`
- ステータス: https://status.slack.com/
- 障害時の影響: 承認DM・通知停止、WebUIは継続動作

### Supabase (Postgres)

- 接続先: Supabase Dashboard
- ステータス: https://status.supabase.com/
- 障害時の影響: **全システム停止**
- 対応: Vercelメンテナンスモード+ユーザー通知

### Vercel (Hosting)

- ステータス: https://www.vercel-status.com/
- 障害時の影響: **全システム停止**
- 代替: GAS（当面は並行稼働）での退避

### Gemini (OCR)

- ステータス: https://status.cloud.google.com/
- 障害時の影響: OCR停止 → 手動入力で代替

### Notion

- ステータス: https://status.notion.so/
- 障害時の影響: フロー図・プロンプト同期停止（業務には影響なし）

### GitHub (Changelog)

- ステータス: https://www.githubstatus.com/
- 障害時の影響: changelog同期停止のみ

---

## エスカレーション先

| 重大度 | 対応時間 | 通知先 |
|--------|--------|-------|
| 🔴 Critical（業務停止） | 即時 | Slack DM（管理本部+開発担当）+ 電話 |
| 🟡 High（一部機能停止） | 1時間以内 | Slack #purchase-ops + DM |
| 🟢 Medium（警告のみ） | 1営業日 | Slack #purchase-ops |

### 責任者

- **業務責任者**: 管理本部リーダー
- **開発責任者**: 伊澤
- **経理責任者**: 経理担当者

---

## 予防保守チェックリスト（月次）

- [ ] MF OAuth トークン有効期限確認
- [ ] Google Drive バックアップ成功確認（直近30日分揃っているか）
- [ ] DLQ未解決件数確認（`/admin/dlq`）
- [ ] 監査ログ異常パターン確認
- [ ] Vercel使用量・Supabase使用量確認
- [ ] Notion同期エラーの有無確認
- [ ] 契約マスタ更新漏れ確認
- [ ] 社員コードマッピング最新化確認

---

## 参考ドキュメント

- `docs/backup-restore-sop.md` — バックアップ復旧詳細
- `docs/user-offboarding.md` — 退職時対応
- `docs/operational-playbook.md` — 日次・月次運用
- `docs/production-cutover-plan.md` — 本番切替計画

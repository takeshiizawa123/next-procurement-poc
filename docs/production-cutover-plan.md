# 本番切替計画書

**対象システム**: next-procurement-poc
**作成日**: 2026-04-19
**本番切替予定**: 未定（経営判断後）
**責任者**: 管理本部 + 開発担当

---

## 1. 背景

### 現状

- 既存システム: GASベース購買管理（`Procurement-Assistant`リポジトリ、`購買管理`シート）
- 新システム: Next.js + Supabase (`next-procurement-poc`、**本番切替前**)
- 両システムは**同一GASプロジェクト内でシート分離**
  - `購買管理` シート: 既存運用中
  - `購買管理_test` シート: 新システムが書込（テスト用）
- 新システムには `FORCE_TEST_MODE=true` がハードコード済み（DM誤送信防止）

### 目的

既存GAS購買管理を完全に新システムへ移管し、以下を達成する:

- 17業務フローの一元化
- 仕訳生成・カード照合・給与連携の自動化
- Notion自動同期による可視化
- MF経費は**カード明細取込の入口として継続**、立替申請UIは購買管理Webに移行

---

## 2. 段階的切替計画（4週間）

### Week 0: 事前準備（本番切替前）

- [ ] Critical修正3件完了確認
  - contract_invoicesのUNIQUE制約（migration 0010）
  - MF仕訳同期cron（mf-journal-sync）
  - 本番切替計画書（本ドキュメント）
- [ ] 社員コードマッピング初期登録（`/admin/employees/payroll-mapping`）
- [ ] 雇用区分登録（正社員/役員/アルバイト等）
- [ ] 代替承認者のSlackID登録（`SLACK_ALTERNATE_APPROVERS`環境変数）
- [ ] 管理本部メンバーへの事前説明会

### Week 1: データ移行+並行運用開始

**目的**: 既存GASデータを新システムに取り込み、両システムが同じ状態になることを確認

- [ ] GAS `購買管理`シート → Postgres `purchase_requests`テーブルへフルインポート
  - 移行スクリプト: `scripts/migrate-gas-to-postgres.mjs` (要作成)
  - 差分検証: 件数・金額合計を両側で比較
- [ ] FORCE_TEST_MODEは `true` のまま維持
- [ ] 既存ユーザーは引き続きGAS/Slackショートカットを使用（変化なし）
- [ ] 開発者のみ新システムWebUIで動作確認
- [ ] 日次データ差分チェック（新旧シートの件数合致）

**判定基準**: 7日間連続で件数・金額が一致 → Week 2進行

### Week 2: 特定ユーザーでの本番試行（1名）

- [ ] **管理本部1名（伊澤）** のみで新システムを本番使用
  - Vercel環境変数に `ALLOWED_PRODUCTION_USERS=U04FBAX6MEK` を追加
  - slack-client.tsに「特定ユーザーのみ本番動作」ロジック追加（TEST_MODE=falseの代わり）
- [ ] 他ユーザーは引き続きGAS使用
- [ ] 試行ユーザーは以下をテスト:
  - 購買申請 → 承認 → 発注 → 検収 → 証憑 → 仕訳
  - 出張申請 → 承認 → 日当計算
  - 立替精算 → 証憑 → 仕訳
  - 契約登録 → 月次請求書 → 仕訳
- [ ] 発生した不具合は即日修正

**判定基準**: 1週間で重大な不具合なし → Week 3進行

### Week 3: 部門長グループ拡大（5-10名）

- [ ] `ALLOWED_PRODUCTION_USERS` に部門長・経理担当者を追加
- [ ] 承認・検収が部門長レベルで回ることを確認
- [ ] Slackチャンネル `#purchase-request` を新システムで本番稼働
- [ ] カード照合cronが正常動作することを確認
- [ ] 月次処理（見積計上/リバース）が走るか確認

**判定基準**: 部門長グループで1週間順調 → Week 4進行

### Week 4: 全社展開

- [ ] **FORCE_TEST_MODE = false に変更** （`src/lib/slack.ts` → `src/lib/slack-client.ts`）
- [ ] Vercel環境変数 `TEST_MODE=false` に変更
- [ ] `ALLOWED_PRODUCTION_USERS` 制限を解除
- [ ] 全従業員向けに切替案内（Slackブロードキャスト）
- [ ] 既存GASのSlackショートカットを無効化（オペレータ側で）
- [ ] GAS `購買管理`シートを **read-only** に設定
- [ ] マニュアル配布（`docs/user-manual.md`）

**判定基準**: 全社1週間順調 → 旧システム retire 準備

### Week 5以降（安定化期間）

- [ ] 既存GAS `購買管理` シートを archive（削除せず保管）
- [ ] `Procurement-Assistant/src/gas/main.js` の cron を停止
- [ ] MF経費の手動入力運用を停止の周知（立替はWeb UIからのみ）
- [ ] 1ヶ月後に `clasp` 経由で GAS コードを deprecated フォルダへ移動

---

## 3. ロールバック手順

切替中に重大な問題が発生した場合の戻し手順:

### Week 1-2 の失敗

1. Vercelデプロイを直前のgit SHAに戻す（`vercel rollback`）
2. `FORCE_TEST_MODE=true` を維持していれば既存ユーザーへの影響なし
3. Postgresデータは保持（次回再試行に活用）

### Week 3 の失敗

1. `ALLOWED_PRODUCTION_USERS` から追加したユーザーを削除
2. それらのユーザーにGAS継続使用を依頼
3. 不具合調査→修正→再開

### Week 4の失敗（最悪シナリオ）

1. **FORCE_TEST_MODE=true に即時戻す**（`src/lib/slack-client.ts` 修正してデプロイ）
2. Vercel環境変数 `TEST_MODE=true` に戻す
3. GASシートを read-write に戻す
4. 全社にSlackで切替延期を通知
5. 根本原因分析→修正計画→次回挑戦

---

## 4. データ移行スクリプト（要作成）

`scripts/migrate-gas-to-postgres.mjs`（Week 1前に作成必要）:

```javascript
// GAS API /recent 等で全申請を取得
// purchase_requests テーブルにinsert（upsert）
// po_number をPKとして扱う
// status, approvalStatus等のフィールドマッピング
```

---

## 5. 各システム境界の扱い

| 対象 | 切替前 | 切替後 |
|------|-------|-------|
| 申請UI | GAS Slackショートカット | **購買管理Web** + Slackモーダル |
| データストア | GAS スプレッドシート | **Postgres (Supabase)** |
| 仕訳システム | 手動/半自動 | **MF会計Plus API自動連携** |
| カード明細 | MF経費 → 目視照合 | **MF経費API → card-matcher-v2自動** |
| 給与連携 | MF経費→一覧表→MF給与(全手動) | **Web→CSV貼付→MF給与** |
| フロー可視化 | なし | **Notion自動同期** |

---

## 6. 必須環境変数（本番切替時）

### Vercel Production

| 変数 | 用途 | 切替前 | 切替後 |
|------|------|--------|--------|
| `TEST_MODE` | 全Slack送信の強制リダイレクト | `true` | `false` |
| `SLACK_PURCHASE_CHANNEL` | メインチャンネル | テストch | `#purchase-request` |
| `SLACK_OPS_CHANNEL` | OPS通知先 | テストch | `#purchase-ops` |
| `SLACK_ADMIN_MEMBERS` | 管理者Slack ID | 開発者のみ | 管理本部全員 |
| `SLACK_ALTERNATE_APPROVERS` | 代替承認者 | 未設定 | 管理本部+幹部数名 |
| `SLACK_FINANCE_MEMBERS` | 経理担当者 | 未設定 | 経理担当数名 |
| `GAS_WEB_APP_URL` | GAS連携URL | test環境 | `購買管理_test`継続 |

### コードレベル

- `src/lib/slack-client.ts`: `FORCE_TEST_MODE = true` → **false** に変更

---

## 7. 成功基準

本番切替が成功したと判定する条件:

1. **2週間連続** で以下が安定動作:
   - 全申請が購買管理Web経由で提出される
   - 承認→検収→証憑→仕訳が自動進行
   - カード照合cronが週次で正常完走
   - 月次処理（見積計上/リバース）が動作
2. **ユーザーからの重大な不具合報告ゼロ**
3. **仕訳・監査ログ・Notion** がすべて整合
4. **MF会計Plus** との差異なし（日次チェック）

---

## 8. 運用マニュアル（要作成）

切替前に以下のドキュメントを作成:

- [ ] `docs/user-manual.md` — 従業員向け操作ガイド
- [ ] `docs/admin-manual.md` — 管理本部向け運用ガイド
- [ ] `docs/troubleshooting.md` — 障害時対応
- [ ] `docs/backup-restore-sop.md` — バックアップ・復旧手順
- [ ] `docs/user-offboarding.md` — 退職時PO引継ぎ

---

## 9. チェックリスト（切替日当日）

**D-1**:
- [ ] 全Critical修正がデプロイ済み
- [ ] 最終migrationが実行済み（0010まで）
- [ ] Vercel環境変数を本番値に設定
- [ ] 全ユーザーに切替通知済み
- [ ] ロールバック手順を全関係者が把握

**D-Day (切替日)**:
- [ ] 09:00 - 最終動作確認（テストユーザーで）
- [ ] 10:00 - FORCE_TEST_MODE=false にデプロイ
- [ ] 10:15 - TEST_MODE=false に環境変数変更
- [ ] 10:30 - Slackブロードキャスト（全社告知）
- [ ] 11:00 - GASショートカット無効化
- [ ] 終日 - 監視（OPS通知・エラーログ・Slack反応）

**D+1**:
- [ ] 夜間cron結果確認
- [ ] 初日の不具合報告集計
- [ ] 監査ログに異常なし
- [ ] 管理本部ダッシュボードで全KPI正常

---

## 10. 関連ドキュメント

- `CLAUDE.md` — 開発ガイドライン
- `docs/handoffs/` — 過去の実装履歴
- `docs/design-expense-payroll-settlement.md` — 立替給与連携設計
- `docs/design-service-contracts-and-notion.md` — 役務契約+Notion設計
- Notion: 業務フローページ（17フロー）
- GitHub: `takeshiizawa123/next-procurement-poc`

---

## 11. 未解決事項（切替前に意思決定必要）

1. **切替日程の確定** — 経営陣との合意
2. **データ移行スクリプトの作成** — 過去購買データのPostgres取込範囲（何ヶ月分?）
3. **MF経費の手動入力停止** — いつから立替はWeb UIのみにするか
4. **GASショートカットの扱い** — 当面残すか即停止か
5. **運用マニュアル** — 誰が書くか・スケジュール

---

**このドキュメントは本番切替の判断材料であり、実際の切替には経営判断と関係部門の合意が必要です。**

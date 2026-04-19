# 本番切替時の環境変数チェックリスト

**対象**: 開発担当（切替実行者）
**更新日**: 2026-04-19

Vercel環境変数を本番切替時に確認・変更する必要がある項目の完全リスト。

---

## 🔴 必ず変更する（本番切替日当日）

| 変数名 | テスト値 | 本番値 | 備考 |
|-------|--------|--------|------|
| `TEST_MODE` | `true` | `false` | 全Slack送信のテストチャンネルリダイレクト解除 |
| `SLACK_PURCHASE_CHANNEL` | `C0A2HJ6S19P` (テスト) | `C0XXXXXXXXX` (本番#purchase-request) | 購買メインチャンネル |
| `SLACK_OPS_CHANNEL` | `C0A2HJ6S19P` (テスト) | `C0YYYYYYYYY` (本番#purchase-ops) | OPSアラート先 |
| `SLACK_TRIP_CHANNEL` | テストch | `C0ZZZZZZZZZ` (本番#trip) | 出張専用チャンネル |

**コード側の変更（デプロイ必須）**:
- `src/lib/slack-client.ts`: `FORCE_TEST_MODE = true` → **`false`**

---

## 🟡 事前に登録する（Week 0までに完了）

### Slack ID 系

| 変数名 | 用途 | 推奨値 |
|-------|------|-------|
| `SLACK_ADMIN_MEMBERS` | 管理本部メンバー（仕訳登録・返品・承認代行） | カンマ区切りSlackID |
| `SLACK_ALTERNATE_APPROVERS` | 代替承認者（部門長不在時） | 管理本部+幹部数名 |
| `SLACK_FINANCE_MEMBERS` | 経理担当者（requireRole用） | 経理担当2-3名 |
| `SLACK_DEFAULT_APPROVER` | 承認者未設定時のフォールバック | 管理本部リーダー |
| `SLACK_ADMIN_APPROVER` | 管理本部承認者 | 経営層1名 |

### 外部サービス系

| 変数名 | 確認点 | リスク |
|-------|-------|-------|
| `MF_CLIENT_ID` / `MF_CLIENT_SECRET` | 本番OAuthアプリで発行されているか | 仕訳登録不可 |
| `MF_REFRESH_TOKEN` | 有効期限（通常90日） | 期限切れで仕訳停止 |
| `MF_EXPENSE_ACCESS_TOKEN` / `MF_EXPENSE_OFFICE_ID` | 本番環境のオフィス設定 | カード明細取込停止 |
| `NOTION_*_ID` 6種 | 本番Notionワークスペースのページ/DB ID | 同期不能 |
| `GAS_WEB_APP_URL` / `GAS_API_KEY` | **切替後も `購買管理_test` シート経由を維持** | データ二重化リスク |

### DB・Cache系（変更不要、既存のまま）

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` - Supabase接続
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` - Redis
- `AUTH_SECRET` - NextAuth暗号化

---

## 🟢 確認のみ（変更不要）

| 変数名 | 役割 |
|-------|------|
| `ANTHROPIC_API_KEY` | Claude Haiku (勘定科目推定・Slack AI) |
| `GEMINI_API_KEY` | OCR (証憑・契約書) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | NextAuth (Google ログイン) |
| `GOOGLE_ALLOWED_DOMAIN` | 社員ドメインに限定 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Drive (バックアップ) |
| `GOOGLE_DRIVE_BACKUP_FOLDER_ID` | バックアップ先フォルダ |
| `CRON_SECRET` | Vercel Cron認証 |
| `INTERNAL_API_KEY` | ブラウザ→API認証 |
| `NEXT_PUBLIC_INTERNAL_API_KEY` | フロント用 |
| `SLACK_BOT_TOKEN` | Slack Bot |
| `SLACK_SIGNING_SECRET` | Slack署名検証 |
| `NTA_APP_ID` | 国税庁適格請求書検証 |
| `KATANA_API_KEY` | KATANA連携（該当時） |
| `SCRAPER_API_KEY` | OGP取得 |

---

## 切替手順（D-Day）

### 事前（D-1）

1. テスト環境で全機能の最終動作確認
2. 本番環境変数の値を確認（全員が揃っているか）
3. 関係者に切替時刻を周知

### 当日（D-Day、推奨 10:00 JST）

```bash
# Step 1: Vercel環境変数を本番値に更新
vercel env rm TEST_MODE production
vercel env add TEST_MODE production  # → false を入力
vercel env rm SLACK_PURCHASE_CHANNEL production
vercel env add SLACK_PURCHASE_CHANNEL production  # → 本番chIDを入力
# 以下、他変数も同様に

# Step 2: コード変更をデプロイ
# src/lib/slack-client.ts の FORCE_TEST_MODE を false に変更してpush
git add src/lib/slack-client.ts
git commit -m "feat: 本番切替 — FORCE_TEST_MODE=false"
git push
npx vercel --prod

# Step 3: 動作確認（自分のアカウントで申請→承認→通知受信）

# Step 4: 全社通知（Slack）
# 「購買管理システムが本番稼働を開始しました」
```

### 当日の監視

- 15分おきに `/admin/dashboard` 確認
- Slack #purchase-ops を常時監視
- 2時間以内に異常なければ切替成功とみなす

---

## ロールバック手順（万一時）

```bash
# 1. コード変更を元に戻す
git revert HEAD  # FORCE_TEST_MODE を true に戻すコミット
git push
npx vercel --prod

# 2. Vercel環境変数を戻す
vercel env rm TEST_MODE production
vercel env add TEST_MODE production  # → true を入力

# 3. 関係者に通知
# 「一時的に既存GAS運用に戻します」

# 所要時間: 約5分
```

---

## 🚨 セキュリティチェックリスト（切替前）

- [ ] すべてのシークレット（API KEY/TOKEN）が期限切れでない
- [ ] INTERNAL_API_KEY が本番専用に再生成されている（テスト値の流用禁止）
- [ ] GOOGLE_ALLOWED_DOMAIN が社員ドメインのみに制限
- [ ] MF OAuth Tokenが本番アプリで発行（テストアプリのtokenを使わない）
- [ ] NOTION_API_KEY が本番ワークスペース用（テスト用と区別）
- [ ] GAS_WEB_APP_URL が `購買管理_test` を指している（本番切替中は維持）

---

## 変数の段階的切替戦略

**Week 1**（GAS並行運用）: TEST_MODE=true維持、Slack channelはテスト、ユーザーへの影響ゼロ

**Week 2**（単一ユーザー試行）: TEST_MODE=trueのまま、`ALLOWED_PRODUCTION_USERS=U04FBAX6MEK`追加
→ このユーザーのみテストチャンネルバイパス

**Week 3**（部門長拡大）: `ALLOWED_PRODUCTION_USERS`を5-10人に拡大
→ 本番Slackチャンネルでの動作試行

**Week 4**（全社）: TEST_MODE=false、ALLOWED_PRODUCTION_USERS解除
→ 本番稼働完了

詳細は `docs/production-cutover-plan.md` を参照。

---

## 追加環境変数（実装後に追加）

本番切替の実装で新規追加予定:

| 変数名 | 役割 | 推奨値 |
|-------|------|-------|
| `ALLOWED_PRODUCTION_USERS` | 段階切替用、該当ユーザーのみTEST_MODEバイパス | カンマ区切りSlackID |

---

## 関連ドキュメント

- `docs/production-cutover-plan.md` — 本番切替全体計画
- `docs/troubleshooting.md` — 障害対応
- `CLAUDE.md` — FORCE_TEST_MODE禁止事項

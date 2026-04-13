@AGENTS.md

# 本番/テスト環境分離（最重要 — 必ず遵守）

このリポジトリ(next-procurement-poc)は**開発中のテスト環境**です。
本番環境(Procurement-Assistant)と同一GASプロジェクトを共有しています。

## 構成
- **本番**: `Procurement-Assistant/src/gas/main.js` → `購買管理`シート（Slack自動取込、毎日稼働中）
- **テスト**: `webApi.js` の `WEBAPI_SHEET = '購買管理_test'` → Next.jsから呼出し

## 禁止事項
- `main.js`の編集（CONFIG.SHEET_PROCUREMENT変更は本番破壊）
- `clasp deploy`の実行（権限破壊でAPI全停止。`clasp push`のみ使用）
- `WEBAPI_SHEET`を`'購買管理'`に変更（テストデータが本番混入）
- 本番Slackチャンネルへの投稿（テストは`C0A2HJ6S19P`プライベートチャンネルのみ）
- **`FORCE_TEST_MODE`を`false`に変更すること（ユーザーの明示的指示なしに絶対禁止）**
- **`safeDmChannel()`を経由しないDM送信コードの追加（全DMは必ずこの関数を経由すること）**

## GASデプロイ手順
1. `clasp push`でコード反映
2. ユーザーにGASエディタから手動で新デプロイを依頼
3. 新URLをVercelの`GAS_WEB_APP_URL`に設定 → `npx vercel --prod`

## テスト安全装置（多重防御 — 過去にDM誤送信インシデント発生）
1. **`FORCE_TEST_MODE = true`**（`src/lib/slack.ts`にハードコード）: コードレベルで強制有効。環境変数に依存しない
2. **`TEST_MODE=true`**（Vercel環境変数）: 第2防御レイヤー
3. **`safeDmChannel()`関数**: ユーザーID宛DMを全てテストチャンネルにリダイレクト。リダイレクト先未設定時はDMをブロック
4. **デプロイ前チェック**: `FORCE_TEST_MODE = true` がslack.tsに存在することを目視確認

## 本番切替時の手順（ユーザーの明示的指示が必須）
1. `FORCE_TEST_MODE` を `false` に変更
2. Vercel環境変数 `TEST_MODE` を `false` に変更
3. 特定ユーザーのみで段階テスト
4. 全社展開

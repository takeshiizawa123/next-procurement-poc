# 内部テスト計画 — 購買管理システム

**作成日**: 2026-03-26
**最終更新**: 2026-04-12（DB・OAuth・Redisテスト追加）
**テスト環境**: Vercel + Supabase Postgres (Tokyo) + Upstash Redis (Tokyo) + NextAuth
**テスト担当**: 管理本部 + 開発者

---

## テストフェーズ

| Phase | 内容 | 前提条件 | 所要時間 |
|-------|------|---------|---------|
| Phase 0 | ビルド・API疎通・DB接続確認 | なし | 15分 |
| Phase 0.5 | 認証（Google OAuth）確認 | Phase 0完了 | 10分 |
| Phase 1 | 環境変数・マスタ設定 | Vercelアクセス | 30分 |
| Phase 2 | 購買申請E2E（4パターン） | Phase 1完了 | 1時間 |
| Phase 3 | 統制機能確認 | Phase 2完了 | 30分 |
| Phase 4 | 出張申請確認 | Phase 1完了 | 15分 |
| Phase 5 | Web画面確認（ログイン必須） | Phase 0.5完了 | 15分 |
| Phase 6 | DB接続・レイテンシ確認 | Phase 0完了 | 10分 |

---

## Phase 0: ビルド・API疎通確認

### T-0.1: ビルド成功
```bash
npm run build
```
- [ ] エラーなしでビルド完了

### T-0.2: ヘルスチェック
```bash
curl https://next-procurement-poc.vercel.app/api/test/health
```
- [ ] JSON応答が返る
- [ ] `hasSlackToken: true`
- [ ] `hasSigningSecret: true`
- [ ] `hasGasUrl: true`
- [ ] `hasPurchaseChannel: true`
- [ ] `hasDefaultApprover: true`

### T-0.3: GAS疎通 ⚠️ 非推奨（DB移行後は廃止予定）
```bash
curl https://next-procurement-poc.vercel.app/api/test/gas
```
- [ ] GASからのレスポンスが返る（移行期のみ、将来削除）

### T-0.4: DB接続確認（Supabase Postgres）
```bash
curl "https://next-procurement-poc-tau.vercel.app/api/test/db" \
  -H "Authorization: Bearer $CRON_SECRET"
```
- [ ] `ok: true`
- [ ] `region: "ap-northeast-1"` （**必須: Tokyo**）
- [ ] `latencyMs < 500ms`（ウォーム時）
- [ ] Postgresバージョン表示 (17.x)

### T-0.5: Redis接続確認（Upstash）
```bash
curl "https://next-procurement-poc-tau.vercel.app/api/cron/cache-warm" \
  -H "Authorization: Bearer $CRON_SECRET"
```
- [ ] `redis: true`
- [ ] 全タスクが `ok: true`

---

## Phase 0.5: 認証（Google OAuth）確認

### T-0.5.1: ログインフロー
1. ブラウザで `https://next-procurement-poc-tau.vercel.app` を開く
- [ ] 自動的に `/auth/signin` にリダイレクトされる
- [ ] 「Googleでログイン」ボタンが表示される

2. 「Googleでログイン」をクリック
- [ ] Google OAuth画面に遷移
- [ ] 社内アカウント（@futurestandard.co.jp）選択可能

3. 承認後
- [ ] `/dashboard` に自動遷移
- [ ] ユーザー名が右上に表示される

### T-0.5.2: ドメイン制限
- [ ] 社外Googleアカウントでログインしようとすると拒否される
- [ ] `GOOGLE_ALLOWED_DOMAIN` が設定されている場合のみ

### T-0.5.3: 未認証アクセス
```bash
curl -v https://next-procurement-poc-tau.vercel.app/dashboard
```
- [ ] 307リダイレクト → `/auth/signin`

### T-0.5.4: API route認証バイパス
```bash
curl "https://next-procurement-poc-tau.vercel.app/api/employees" \
  -H "x-api-key: $INTERNAL_API_KEY"
```
- [ ] 200 OK（proxy側の認証はバイパス、API route独自認証で通る）

---

## Phase 1: 環境変数・マスタ設定

### T-1.1: Vercel環境変数設定
以下を Vercel > Settings > Environment Variables に設定:

| 変数 | 設定値 | 確認 |
|------|--------|------|
| SLACK_BOT_TOKEN | xoxb-... | [ ] |
| SLACK_SIGNING_SECRET | (Slack App画面から) | [ ] |
| SLACK_PURCHASE_CHANNEL | (チャンネルID) | [ ] |
| SLACK_OPS_CHANNEL | (チャンネルID) | [ ] |
| SLACK_DEFAULT_APPROVER | (SlackID) | [ ] |
| SLACK_ADMIN_APPROVER | (SlackID) | [ ] |
| SLACK_ADMIN_MEMBERS | (カンマ区切りSlackID) | [ ] |
| CRON_SECRET | (任意文字列) | [ ] |
| GAS_WEB_APP_URL | (GASデプロイURL) | [ ] |
| GAS_API_KEY | (GAS APIキー) | [ ] |

### T-1.2: GASスプレッドシート列追加
- [ ] 従業員マスタシートに `SlackID` 列を追加
- [ ] 従業員マスタシートに `部門長SlackID` 列を追加
- [ ] テスト用従業員を2名以上登録（申請者 + 部門長）

### T-1.3: Vercel再デプロイ
```bash
npx vercel --prod --yes
```
- [ ] デプロイ成功
- [ ] ヘルスチェック再確認（T-0.2）

---

## Phase 2: 購買申請E2E（4パターン）

### T-2.1: パターンA — 少額カード購入（10万未満）

**申請者の操作:**

1. **申請**
   - [ ] Slackで `/purchase` を実行
   - [ ] 2択メッセージが表示（モーダル / Webフォーム）
   - [ ] 「Slackモーダルで入力」を選択
   - [ ] モーダルが開く
   - [ ] 入力: 品目「テスト商品A」/ 単価「5000」/ 数量「1」/ 支払「会社カード」/ 目的「業務利用」
   - [ ] 送信
   - [ ] #purchase-request にメッセージが投稿される
   - [ ] PO番号（PR-XXXX）が表示される
   - [ ] [承認] [差戻し] ボタンが表示される

2. **承認（部門長）**
   - [ ] 部門長のDMに承認依頼が届く
   - [ ] DMの [承認] ボタンを押す
   - [ ] #purchase-request のメッセージが「承認済」に更新される
   - [ ] 申請者にDMで「承認されました。発注してください」が届く
   - [ ] [発注完了] ボタンが表示される

3. **発注完了**
   - [ ] 申請者が [発注完了] ボタンを押す
   - [ ] メッセージが「発注済」に更新される
   - [ ] #purchase-ops に通知が投稿される

4. **検収完了**
   - [ ] 申請者が [検収完了] ボタンを押す
   - [ ] メッセージが「検収済・証憑待ち」に更新される
   - [ ] スレッドに「証憑をスレッドに添付してください」が投稿される

5. **証憑添付**
   - [ ] スレッドにPDFファイルをドラッグ&ドロップ
   - [ ] Botが「証憑を確認しました」と返信
   - [ ] 種別（納品書/領収書等）が表示される
   - [ ] 「あなたの作業は完了です」メッセージが表示される
   - [ ] #purchase-ops に証憑添付通知が投稿される

6. **GAS確認**
   - [ ] スプレッドシートにPR番号の行が存在する
   - [ ] ステータスが「添付済」に更新されている

**所要時間目安**: 15分

---

### T-2.2: パターンB — 高額購入（10万以上・二段階承認）

1. **申請**
   - [ ] `/purchase` → 単価「120000」で申請
   - [ ] #purchase-request に投稿される

2. **一段階目承認（部門長）**
   - [ ] 部門長DMに承認依頼
   - [ ] [承認] → メッセージ更新
   - [ ] 管理本部DMに二段階目の承認依頼が届く

3. **二段階目承認（管理本部）**
   - [ ] 管理本部が [承認]
   - [ ] #purchase-ops に「発注待ち」通知

4. **発注権限確認**
   - [ ] **申請者**が [発注完了] を押す → 「管理本部が発注する案件です」エフェメラル表示
   - [ ] **管理本部**が [発注完了] を押す → 正常に「発注済」に更新

5. 以降は検収→証憑添付（T-2.1と同じ）

**所要時間目安**: 15分

---

### T-2.3: パターンC — 請求書払い

1. **申請**
   - [ ] `/purchase` → 支払方法「請求書払い」/ 単価「30000」
   - [ ] #purchase-request に投稿

2. **承認**
   - [ ] 部門長が [承認]
   - [ ] #purchase-ops に「発注待ち（請求書払い）」通知

3. **発注権限確認**
   - [ ] 申請者が [発注完了] → ブロックされる
   - [ ] 管理本部が [発注完了] → 正常更新

**所要時間目安**: 10分

---

### T-2.4: パターンD — 購入済（立替）

1. **申請**
   - [ ] `/purchase` → 申請区分「購入済」/ 品目「テスト立替」/ 単価「3000」
   - [ ] #purchase-request に「購入済申請」として投稿される
   - [ ] 承認・発注ステップがスキップされている
   - [ ] 「検収済・証憑待ち」ステータスで投稿される
   - [ ] スレッドに証憑催促メッセージが投稿される

2. **証憑添付**
   - [ ] スレッドにレシート画像を添付
   - [ ] Botが証憑確認メッセージを返す

**所要時間目安**: 5分

---

### T-2.5: 差戻し・取消

1. **差戻し**
   - [ ] 新規申請 → 部門長が [差戻し]
   - [ ] 差戻し理由の入力モーダルが表示される
   - [ ] 申請者にDMで差戻し通知 + 理由が届く
   - [ ] メッセージが「差戻し」ステータスに更新

2. **取消**
   - [ ] 新規申請 → 申請者が [取消]
   - [ ] メッセージが「取消」ステータスに更新

3. **権限チェック**
   - [ ] 申請者以外が [取消] → ブロック
   - [ ] 部門長以外が [承認] → ブロック

**所要時間目安**: 10分

---

## Phase 3: 統制機能確認

### T-3.1: 証憑催促リマインダー

手動でCronを実行:
```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
  https://next-procurement-poc.vercel.app/api/cron/voucher-reminder
```

- [ ] 証憑未提出の申請者にDMが届く（Day1+）
- [ ] 承認待ち24時間超の部門長にDMが届く
- [ ] 発注未完了3日超の申請者にDMが届く
- [ ] レスポンスに `reminded`, `approvalReminded`, `orderReminded` が含まれる

### T-3.2: 日次サマリ

```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
  https://next-procurement-poc.vercel.app/api/cron/daily-summary
```

- [ ] #purchase-ops に日次サマリが投稿される
- [ ] 要対応 / フォロー要 / 順調 の3区分で表示
- [ ] スレッドリンクが含まれる

### T-3.3: 署名検証

```bash
# 署名なしリクエスト → 401
curl -X POST https://next-procurement-poc.vercel.app/api/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type":"url_verification","challenge":"test"}'
```

- [ ] `{"error":"invalid signature"}` / 401 が返る

### T-3.4: カード明細突合（MF経費API設定後）

```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
  https://next-procurement-poc.vercel.app/api/cron/card-reconciliation
```

- [ ] レスポンスが返る（MF未設定時は `statements: 0` で正常終了）

---

## Phase 4: 出張申請確認

### T-4.1: /trip コマンド

1. **申請**
   - [ ] Slackで `/trip` を実行
   - [ ] モーダルが開く
   - [ ] 入力: 行き先「大阪」/ 開始日「明日」/ 終了日「明後日」/ 目的「打合せ」/ 交通「新幹線」/ 概算額「50000」
   - [ ] 送信
   - [ ] #出張チャンネルに投稿される
   - [ ] 申請者にDM確認通知が届く

2. **バリデーション**
   - [ ] 行き先を空にして送信 → エラーDMが届く
   - [ ] 開始日 > 終了日で送信 → エラーDMが届く
   - [ ] 概算額「0」で送信 → エラーDMが届く

### T-4.2: /mystatus コマンド

- [ ] Slackで `/mystatus` を実行
- [ ] エフェメラルメッセージで未対応案件の一覧が表示される
- [ ] マイページへのリンクが含まれる
- [ ] 未対応がない場合「未対応の申請はありません」が表示される

---

## Phase 5: Web画面確認

### T-5.1: 申請フォーム（/purchase/new）

- [ ] ページが表示される（ローディングが完了する）
- [ ] ステップ1: 申請区分の選択ができる
- [ ] ステップ2: URL入力 → OGP自動解析が動作する（Amazon等）
- [ ] ステップ2: 購入先サジェストが表示される
- [ ] ステップ2: 金額入力 → カンマフォーマットされる
- [ ] ステップ3: 承認ルートプレビューが表示される
- [ ] ステップ4: 確認画面が表示される
- [ ] ステップ4: 重複チェック結果が表示される
- [ ] ステップ4: 勘定科目推定が表示される
- [ ] 送信 → #purchase-request に投稿される

### T-5.2: マイページ（/purchase/my）

- [ ] ページが表示される
- [ ] サマリカード（全申請・進行中・完了・合計金額）が表示される
- [ ] 未対応事項ダッシュボード（黄色いアラート）が表示される
- [ ] 各案件に次のアクション指示が表示される
- [ ] 証憑待ち案件の [証憑UP] ボタンが動作する
- [ ] Slackリンクが正しく開く
- [ ] フィルター（すべて/進行中/完了）が動作する

### T-5.3: ダッシュボード（/dashboard）

- [ ] ページが表示される
- [ ] ステータス分布が表示される
- [ ] 部門別・購入先TOP表示

### T-5.4: モバイル表示

- [ ] スマホで `/purchase/new` が正常表示される
- [ ] スマホで `/purchase/my` が正常表示される

---

## Phase 6: カード明細照合

### 前提条件
- Phase 1完了（環境変数設定済み）
- 従業員マスタにcard_last4列が追加済み
- GASが `clasp push` でデプロイ済み
- MF会計Plus補助科目（MFカード:未請求/請求）が作成済み

### T-6.1: 予測テーブル生成

- [ ] `/purchase` でカード払いの申請を作成
- [ ] 承認ボタンを押す
- [ ] GASスプレッドシート「予測カード明細」シートが自動作成される
- [ ] 承認した申請の予測レコードが追加される（id, po_number, card_last4, predicted_amount, status=pending）
- [ ] 立替払い・請求書払いの場合は予測が生成されないことを確認

### T-6.2: 照合UI表示

- [ ] `/admin/card-matching` が表示される
- [ ] 月選択プルダウンに過去6ヶ月が表示される
- [ ] CSVドロップエリアが表示される
- [ ] CSV未読込時に「照合結果がありません」が表示される

### T-6.3: 利用明細CSV照合

テスト用CSV（MFビジネスカード利用明細フォーマット）を用意:
```csv
カード利用明細ID,取引日時,確定日時,支払先,取引状況,金額,現地通貨コード,カード名義人,カード番号4桁
TEST001,2026-03-15,2026-03-16,Amazon,確定,52800,JPY,田中太郎,3815
TEST002,2026-03-18,2026-03-19,MONOTARO,確定,33000,JPY,田中太郎,3815
```

- [ ] CSVファイルをドロップ → 読込件数が表示される
- [ ] 自動的にAPIが呼ばれて照合が実行される（ローディング表示あり）
- [ ] 照合結果が4タブに振り分けられる
- [ ] 「自動照合済み」タブに差額なし/あり が正しく表示される
- [ ] 「要確認」タブで [これに確定] ボタンが動作する
- [ ] 「未申請利用」タブで [本人に確認] ボタンが動作する
- [ ] プログレスバーが正しく表示される（処理済み/全件）
- [ ] 全件処理 → 完了バナーが表示される
- [ ] 月を変更して [照合実行] → 再照合される

### T-6.4: 引落照合

テスト用CSV（MFビジネスカード入出金履歴フォーマット）を用意:
```csv
入出金履歴ID,カード利用明細ID,取引日時,確定日時,取引内容,確定金額,カード
W001,,2026-03-20,2026-03-20,MFビジネスカード 2月利用分,1245800,HIROSHI OKA ....3815
```

- [ ] 「引落照合」タブを開くとMF会計Plusから未払金データが自動取得される
- [ ] 未払金(請求)合計がカード別内訳付きで表示される
- [ ] CSVを貼り付け/ドロップ → [照合を実行]
- [ ] 一致の場合: 緑の「引落額が一致しました」バナー表示
- [ ] 差額の場合: 差額表示 + 原因ガイド表示
- [ ] [CSVを再入力する] で入力画面に戻れる

### T-6.5: エラーハンドリング

- [ ] GAS_WEB_APP_URL未設定時: 照合実行でエラーメッセージが表示される
- [ ] MF_CLIENT_ID未設定時: 引落照合でエラーメッセージが表示される
- [ ] 空のCSVを読込 → 適切なエラー表示
- [ ] 不正なCSVフォーマット → 適切なエラー表示

---

## テスト結果記録

| Phase | テスト項目数 | Pass | Fail | 備考 |
|-------|-----------|------|------|------|
| Phase 0 | 5 (ビルド+DB+Redis含む) | | | |
| Phase 0.5 | 4 (OAuth認証) | | | |
| Phase 1 | 3 | | | |
| Phase 2 | 5シナリオ | | | |
| Phase 3 | 4 | | | |
| Phase 4 | 2 | | | |
| Phase 5 | 4 | | | |
| Phase 6 | 5シナリオ (カード照合) + 3 (DBレイテンシ) | | | |
| **合計** | **35** | | | |

---

## Phase 6補足: DB接続・レイテンシ検証

### T-6.DB.1: 初回接続レイテンシ（コールドスタート）
```bash
curl -w "time: %{time_total}s\n" \
  "https://next-procurement-poc-tau.vercel.app/api/test/db" \
  -H "Authorization: Bearer $CRON_SECRET"
```
- [ ] 初回: < 2000ms
- [ ] 2回目: < 300ms
- [ ] 3回目: < 200ms

### T-6.DB.2: 同時リクエスト耐性
複数のAPIリクエストを同時発行し、接続プール枯渇がないことを確認。
- [ ] 10並列で全て成功
- [ ] エラーログに connection pool exhausted が出ない

### T-6.DB.3: Redis キャッシュヒット率
```bash
# cache-warm実行後
curl "https://next-procurement-poc-tau.vercel.app/api/employees" \
  -H "x-api-key: $INTERNAL_API_KEY" -w "time: %{time_total}s\n"
```
- [ ] 2回目以降のリクエストが `< 100ms`（Redisから取得）

---

## 不具合発見時の対応

1. 不具合の内容・再現手順をSlackまたはGitHub Issueに記録
2. 重要度を判定:
   - **Critical**: 申請・承認フローが動かない → 即修正
   - **High**: データ不整合・権限漏れ → 当日中に修正
   - **Medium**: UI崩れ・表示不具合 → 次回修正
   - **Low**: 文言・デザイン → 後回し
3. 修正後に該当テストケースを再実行

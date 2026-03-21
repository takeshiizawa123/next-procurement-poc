# CURRENT_WORK

## [Handoff] "購買管理Phase1 - 運用設計完了・フォーム実装中" — 2026-03-21 17:55 (branch: master)

### Goal / Scope
- Phase 1: 購買申請Bot + 証憑ブロックの実装
- 運用フロー設計は完了、実装フェーズに移行中
- やらないこと: Phase 2（Webダッシュボード）、Phase 3（MF会計連携）

### Key decisions（今回の会話で決定）
- 発注デリゲート: 10万未満カード決済は申請者委任、10万以上/請求書払いは管理本部
- 立替精算: 原則廃止、緊急時のみ（購入済のみ）
- バーチャルカード: 基本全員配賦、カード上限は絞らない
- 統制: 事後統制（カード明細突合バッチ）、MFカードAPIは非公開のため事前統制不可
- MFクラウド経費: 購買フローから外す（/purchaseに統一）
- 取引先マッチ: テキスト入力 + MF取引先マスタとの自動マッチ提案
- 権限: 厳密（該当者以外はエラー）
- 差戻し: 終了（再申請は新規）
- 取消: 発注前なら可能
- PO番号: 申請時発番（欠番許容）
- 証憑: 画像/PDF/Excel可、取消可、複数可
- 資産区分: 申請者に用途を3択で聞く（顧客案件/社内使用/予備品）、判定は管理本部
- 消込自動化: Phase 3でSaaS定額パターン含む自動分類+一括消込
- フォーム方針: 現Slackモーダル(A)を残しつつ、Webフォーム(B)を並行開発

### Done
- [x] Sprint 0: POC完了、Slack App設定、スプレッドシートスキーマ設計
- [x] Sprint 1-1: /purchase モーダル実装（デプロイ・動作確認済み）
  - モーダルフォーム → チャンネル投稿 → ボタン承認フロー
  - 購入先名・支払方法表示、取消ボタン（権限チェック付き）
- [x] 運用フロー設計書（09_運用フロー設計.md）全面改訂
  - 発注フロー3パターン、統制3層、仕訳情報フロー、消込自動化
- [x] MFカードAPI調査（docs/research/2026-03-20-mf-business-card-api.md）
- [x] フォーム改善（購入目的・受取場所削除、検収者・用途・KATANA PO追加、金額を税込に）

### Pending
- [ ] Webフォーム（Next.js）の実装（現Slackモーダルと並行）
- [ ] 権限チェック実装（承認ボタンは承認者のみ）
- [ ] 承認者へのDM通知
- [ ] 管理本部への #purchase-ops 通知
- [ ] Sprint 1-2: 条件分岐（購入済→証憑必須・発注スキップ）
- [ ] Sprint 1-3: GAS側 doPost 拡張
- [ ] Sprint 1-4: Next.js → GAS 疎通
- [ ] Sprint 1-5: モーダル→GAS登録→Slack投稿の一連フロー
- [ ] Sprint 1-6: 従業員マスタ連携
- [ ] 未コミットの変更をgit commit

### Next actions
1. 未コミット変更をgit commitする
2. Webフォーム（Next.js）の設計・実装開始
   - /purchase → エフェメラルでURL返却 → ブラウザでフォーム
   - Slack認証、動的バリデーション、ファイルアップロード対応
3. 権限チェック実装（承認者判定を従業員マスタベースで）
4. 承認者DM通知の実装
5. 管理本部 #purchase-ops 通知の実装
6. Sprint 1-2: 購入済フロー（発注スキップ）の実装
7. GAS連携（Sprint 1-3〜1-5）

### Affected files
- `src/lib/slack.ts` — モーダル構築、フォームパーサー、アクションハンドラー、取消ハンドラー
- `src/app/api/slack/events/route.ts` — /purchase コマンド、view_submission、handlePurchaseSubmission
- `src/app/api/test/health/route.ts` — SLACK_PURCHASE_CHANNEL確認追加
- `slack-app-manifest.yml` — /purchase コマンド、groups:writeスコープ追加
- `docs/spreadsheet-schema.md` — supplier_name追加、列番号修正

### Affected symbols
- `handlePurchaseCommand(client, triggerId, channelId)` — channelIdをprivate_metadataに埋め込み
- `buildPurchaseModal(channelId)` — 13項目フォーム（購入目的・受取場所削除、検収者・用途・KATANA PO追加）
- `PurchaseFormData` — amount(税込), quantity, inspectorSlackId, assetUsage, katanaPo追加
- `parsePurchaseFormValues()` — selected_user対応（検収者のユーザー選択）
- `handleCancel` — 取消ハンドラー（申請者のみ・権限チェック）
- `RequestInfo` — supplierName, paymentMethod, applicantSlackId追加
- `handlePurchaseSubmission(userId, userName, formData, targetChannelId)` — チャンネルID引数化

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run build                    # ビルド確認
npx vercel --prod --yes          # デプロイ
curl -s https://next-procurement-poc.vercel.app/api/test/health  # ヘルスチェック
```

### Risks / Unknowns
- 非公開チャンネルへの投稿にgroups:writeスコープが必要（対応済み）
- Vercel環境変数SLACK_PURCHASE_CHANNELよりprivate_metadata経由のチャンネルIDを優先使用
- Webフォーム実装時のSlack認証方式（NextAuth.js + Slack OAuth）は未設計
- 従業員マスタのデータがまだない（Sprint 1-6で対応）

### Links
- GitHub: https://github.com/takeshiizawa123/next-procurement-poc
- Vercel: https://next-procurement-poc.vercel.app
- Slack App: https://api.slack.com/apps（Procurement POC Bot）
- 設計ドキュメント: C:\Users\takeshi.izawa\.claude\projects\購買管理フロー見直し\
- 運用フロー設計: C:\Users\takeshi.izawa\.claude\projects\購買管理フロー見直し\09_運用フロー設計.md
- MFカードAPI調査: C:\Users\takeshi.izawa\.claude\projects\購買管理フロー見直し\docs\research\2026-03-20-mf-business-card-api.md

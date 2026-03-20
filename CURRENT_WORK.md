# CURRENT_WORK

## [Handoff] "購買管理POC - Slack Bolt + Next.js + Vercel" — 2026-03-20 01:20 (branch: master)

### Goal / Scope
- Slack Bolt + Next.js + GASハイブリッド構成の購買管理POCを構築・検証する
- POC-1: Slackボタン承認フローの動作確認が最優先
- やらないこと: GAS連携（POC-2）、Webダッシュボード実装（モックのみ）

### Key decisions
- アーキテクチャ: Next.js(Vercel) + GAS ハイブリッドを採用（既存GAS資産活用 + Slack Bolt対応）
- リアクション方式 → ボタン方式に移行（Block Kit Interactive Messages）
- Vercel Hobbyプラン（無料）でPOC、本番はPro($20/月)に移行予定
- Slack Web API直接利用（Bolt Receiverは使わず自前ルーティング）

### Done
- [x] Next.jsプロジェクト作成・ビルド成功
- [x] Slack Bolt連携コード（承認→発注→検収の4ステップボタンフロー）
- [x] GAS連携クライアント（モック対応済み）
- [x] UIモック3画面（Slackプレビュー / 管理本部ダッシュボード / 申請者マイページ）
- [x] GitHubプライベートリポジトリ作成・push済み
- [x] Vercelデプロイ成功（https://next-procurement-poc.vercel.app）
- [x] Vercel環境変数設定（SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET）
- [x] Slack App手動作成（/po-test コマンド、Interactivity設定済み）

### Pending
- [ ] Vercel再デプロイ（署名検証無効化版が未デプロイ — Vercelビルドエラー）
- [ ] Slackでの/po-testコマンド動作確認
- [ ] 署名検証の再有効化
- [ ] ボタン操作（承認→発注→検収）のE2Eテスト

### Next actions
1. `vercel --prod --yes` で再デプロイ（Vercelビルドエラーが解消しているか確認）
2. デプロイ成功後、Slackで `/po-test` を実行してボタンメッセージが投稿されるか確認
3. 動かない場合: Vercelダッシュボード > Functions > Logs でリクエストログを確認
4. 動いた場合: ボタン操作テスト（承認→発注→検収→証憑催促）
5. 署名検証を再有効化してデプロイ
6. POC-1完了判定 → POC-2（GAS連携）に進む

### Affected files
- `src/app/api/slack/events/route.ts` — 署名検証を一時コメントアウト済み（コミット済み・未デプロイ）
- `src/lib/slack.ts` — アクションハンドラー・Block Kitメッセージ構築
- `src/lib/gas-client.ts` — GAS連携（モック対応）

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
vercel --prod --yes          # 再デプロイ
curl -s https://next-procurement-poc.vercel.app/api/test/health  # ヘルスチェック
```

### Risks / Unknowns
- Vercel Hobbyプランのビルドレート制限に達した可能性 → 時間を空けて再試行
- Slackからのリクエストが到達しなかった原因未特定（署名検証? Vercelエッジ? Slack App設定?）
- fire-and-forget パターンでVercel serverlessがバックグラウンド処理を完了できるか未検証

### Links
- GitHub: https://github.com/takeshiizawa123/next-procurement-poc
- Vercel: https://next-procurement-poc.vercel.app
- Slack App: https://api.slack.com/apps（Procurement POC Bot）
- 設計ドキュメント: C:\Users\takeshi.izawa\.claude\projects\購買管理フロー見直し\

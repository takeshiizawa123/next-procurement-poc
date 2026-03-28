# [Handoff] "マニュアル整備完了・統制強化実装前" — 2026-03-28 16:24 (branch: master)

### Goal / Scope
- マニュアル・PPTX全面改訂（ロール別構成、スクショ埋込、二段階承認廃止の反映）
- 運用フロー変更: 二段階承認廃止、全件申請者発注、管理本部は経理専任
- やらないこと: 統制強化実装（次セッション）

### Key decisions
- **二段階承認を廃止**: 部門長承認のみに統一。管理本部の承認ステップを削除
- **全件申請者発注**: カード・請求書問わず申請者が発注。請求書は証憑として提出
- **管理本部は経理専任**: 仕訳・照合・支払処理に特化。発注代行を廃止
- **証憑提出は2経路**: Slackスレッド + マイページを全パターンで明記
- **購買パターンを3つに整理**: A:カード、B:請求書、C:立替
- **統制強化2件を承認**: ①日次金額乖離アラート ②従業員別利用傾向ダッシュボード

### Done
- [x] マニュアルPPTX: ロール別構成（49スライド）、スクショ7枚埋込
- [x] user-manual.md / operational-guide.md: 全面更新
- [x] コード: 二段階承認廃止、/trip レンタカー追加、デモモード追加
- [x] スクリーンショット14枚撮影

### Pending
- [ ] 日次金額乖離アラート: POST /api/cron/daily-variance
- [ ] 従業員別利用傾向ダッシュボード: /admin/spending
- [ ] 手動設定14項目 + Vercelデプロイ + E2Eテスト

### Next actions
1. 日次乖離アラートバッチ実装
2. 従業員別利用傾向ダッシュボード実装
3. 統制方針をドキュメントに追記
4. 手動設定→clasp push→Vercelデプロイ
5. E2Eテスト

### Affected files
- `src/lib/slack.ts:73-140,204-250` — 承認・発注フロー変更
- `src/lib/approval-router.ts:66-67` — 二段階承認廃止
- `docs/user-manual.md` / `docs/operational-guide.md` — 全面修正
- `docs/scripts/generate_manual_ppt.py` / `docs/scripts/generate_ppt.py` — PPTX生成スクリプト
- `docs/images/*.png` — 14枚

### Repro / Commands
```bash
cd C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc
npm run dev  # localhost:3333
http://localhost:3333/admin/card-matching?demo=1
python docs/scripts/generate_manual_ppt.py
```

### Risks / Unknowns
- 日次アラートはMF会計Plus APIのレート制限未確認
- ダッシュボードのGAS購買台帳取得速度（月間データ量依存）

### Links
- docs/user-manual.md / docs/user-manual.pptx
- docs/operational-guide.md / docs/operational-guide.pptx
- docs/test-plan.md

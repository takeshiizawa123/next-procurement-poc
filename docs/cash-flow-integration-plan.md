# 資金繰り連携 将来計画メモ

## ゴール

契約マスタ + 月次請求データから **次回支払日・金額を自動算出**し、既存の資金繰り表（Excel）に相当する情報を Web UI で可視化する。

現行の資金繰り表構造:
- `【第13期】資金繰り表.xlsx`
- 月次シート × 11ヶ月
- 支払方法別の3シート（SMBC振込+予算 / 口座振替+その他銀行+小口現金 / カード支払）
- 集計表 + CF推移 + 残高推移グラフ

## 必要な情報要素（契約マスタに対応）

| 既存Excel | 対応するDBフィールド | 状態 |
|---|---|---|
| 取引先名 | contracts.supplierName | ✅ |
| 金額 | contracts.monthlyAmount | ✅ |
| 支払方法 | contracts.paymentMethod | ✅ (追加済) |
| 支払日 | contracts.paymentDay | ✅ (追加済、一部未設定) |
| カテゴリ | contracts.category | ✅ |
| 勘定科目 | contracts.accountTitle | ✅ |
| 契約期間 | contracts.contractStartDate/EndDate | ✅ |

## 次回支払日の算出ロジック

```typescript
function nextPaymentDate(contract: Contract, from: Date): Date | null {
  if (!contract.paymentDay) return null;
  const day = contract.paymentDay;
  let target = new Date(from.getFullYear(), from.getMonth(), day);
  // 月末扱い（31）は各月末に調整
  if (day === 31) target = endOfMonth(from);
  // 既に過去日なら翌月
  if (target < from) {
    target = new Date(target.getFullYear(), target.getMonth() + 1, day);
    if (day === 31) target = endOfMonth(target);
  }
  // 契約終了日を超える場合はnull
  if (contract.contractEndDate && target > new Date(contract.contractEndDate)) return null;
  return target;
}
```

## 実装案

### Phase 1: 支払日バックフィル
全33件の支払日を確定させる（契約書の記載を読む or デフォルト推定）:
- 家賃 → 月末
- 顧問料 → 月末または翌月末
- SaaS月払 → 契約締結日と同じ日
- カード決済 → カード引落日（MFビジネスカードは当月末締め翌月10日引落 等、カード規約依存）
- 振込 → 請求書締め日翌月末（慣行）

### Phase 2: 支払スケジュール表示UI
- `/admin/payments/schedule` 新ページ
- 向こう3ヶ月の支払予定を日付順に列挙
- 支払方法別フィルタ（振込/口座引落/MFカード）
- 金額合計・カテゴリ別集計

```
2026-04-25 (金)  ¥2,797,010  振込   サンフロンティア不動産  (家賃)
2026-04-30 (水)  ¥  278,809  振込   プロパティデータバンク    (著作権使用料)
2026-05-01 (木)  ¥  121,000  振込   三原公認会計士事務所    (顧問料)
...
週次合計  ¥3,196,819
月次合計  ¥7,372,761
```

### Phase 3: 資金繰り表出力
- CSV/Excel エクスポート機能
- 既存 `【第13期】資金繰り表.xlsx` の形式に合わせて月次シートを自動生成
- 支払方法別の3シート構造を再現

### Phase 4: 実績突合（月次）
- MFの実仕訳と契約マスタの予定支払を突合
- 乖離アラート（予定額と実際の引落額がズレた場合）
- 経理担当者の確認負荷を削減

### Phase 5: 残高予測
- 銀行口座残高の初期値（手動入力または銀行API連携）
- 今後の収入予定（売上計上データから）を加味
- 月次残高推移を予測グラフで表示

## データソース連携

| ソース | 利用データ |
|---|---|
| 契約マスタ（本システム） | 支払予定・定額契約 |
| MF会計Plus | 実仕訳・実残高 |
| MFビジネスカード | カード引落明細 |
| SMBC（API） | 預金残高・振込履歴 |

## 優先度

1. **Phase 1（即時）**: 支払日バックフィル、重要契約10件だけでもOK
2. **Phase 2（1-2日）**: 支払スケジュールUI、最大価値
3. **Phase 3（1日）**: Excel出力（乗換移行が楽）
4. **Phase 4（1-2日）**: 実績突合、運用安全ネット
5. **Phase 5（数日）**: 残高予測、後日拡張

## 参考

既存ファイル:
- `C:\Users\takeshi.izawa\Downloads\【第13期】資金繰り表.xlsx`
- 11ヶ月分の月次実績 + 予算 + 3支払方法別シート
- 形式: 集計表 + CF推移 + 残高推移グラフ

## Related docs
- `docs/contract-auto-accrual-plan.md` — 契約自動仕訳システム（対になる機能）

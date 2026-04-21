# 契約自動仕訳システム 実装計画

## 背景

次の運用フローを実現するのが最終目標:

```
契約マスタ (登録済30件)
   ↓ 月末Cron
月次見積計上仕訳をMF会計Plusへ自動送信
   ↓
contract_invoices レコード作成 (status="見積計上")
   ↓ 請求書到着時（随時）
請求書アップロード → 金額照合
   ↓
一致 → status="承認済"（差額なし）
乖離 → 差額調整仕訳を追加送信
   ↓
月末未到着 → 🚨アラート
```

MF会計Plusは **記帳の結果を受け取る側**、契約管理システムが起点。

## 現在の実装状況（2026-04-21時点）

| 機能 | 状態 | ファイル |
|---|---|---|
| 契約マスタDB | ✅ | `src/db/schema.ts` (contracts) |
| 月次請求DB | ✅ | `src/db/schema.ts` (contractInvoices) |
| 契約マスタCRUD API | ✅ | `src/app/api/admin/contracts/` |
| 契約詳細ページ（billing_type別UI） | ✅ | `src/app/admin/contracts/[id]/page.tsx` |
| 請求書アップロード（FormData + Slack） | ✅ | `src/app/api/admin/contracts/[id]/invoices/route.ts` |
| 契約→MF仕訳ロジック | ✅ | `buildJournalFromContract()` in `src/lib/mf-accounting.ts` |
| 契約仕訳API | ✅ | `/api/mf/journal` の `contractJournal` パス |
| ContractJournalTab（手動仕訳登録UI） | ✅ | `src/app/admin/journals/ContractJournalTab.tsx` |
| 月次自動Cron | ❌ 未実装 | `src/app/api/cron/contract-accrual/route.ts` 要作成 |
| 差額調整仕訳ロジック | ❌ 未実装 | |
| 未到着アラート | ❌ 未実装 | |
| 期間切れ契約のスキップ/警告 | ❌ 未実装 | |

## Phase A: 動作確認（手動で1件試行）

**目的**: 既存の実装が本当に動くか検証。MFコード未設定(null)でも name-based解決で仕訳が作れるか確認。

**手順**:
1. CT-0001 サンフロンティア不動産の詳細ページを開く
2. 「請求登録」で 2026-04 分を登録（金額 ¥2,797,010、証憑ファイル任意）
   - status: "受領済"
3. 「承認」ボタン → status: "承認済"
4. `/admin/journals` → ContractJournalTab タブ → 該当請求書の「仕訳登録」
5. MF会計Plusで仕訳が作成されたか確認
   - 借方: 地代家賃 / 貸方: 買掛金
   - メモ: "2026/04 CT-202604-0001 サンフロンティア不動産株式会社"
6. contract_invoice の status が "仕訳済"、journalId がセットされているか確認

**想定課題**:
- name-based解決が失敗する場合 → 契約マスタに `mfAccountCode`, `mfTaxCode`, `mfDepartmentCode`, `mfCounterpartyCode` を手動設定する必要
- 解決失敗時は `/api/admin/contracts/[id]` PUT エンドポイントで各コードを更新

## Phase B: 月次自動Cron

**目的**: 毎月1日に全有効契約について見積計上仕訳を自動送信。

### エンドポイント設計

```
POST /api/cron/contract-monthly-accrual
Headers: Authorization: Bearer <CRON_SECRET>
Query: ?month=YYYY-MM (optional、省略時は当月)
```

### 処理フロー

```typescript
for (const contract of activeContracts) {
  // 期間切れチェック
  if (contract.contractEndDate && contract.contractEndDate < today) {
    notifyOps(`🚨 ${contract.contractNumber} は期間切れ (${contract.contractEndDate})。仕訳をスキップ`);
    continue;
  }

  // 既存invoice チェック
  const existing = await db.select().from(contractInvoices).where(
    and(
      eq(contractInvoices.contractId, contract.id),
      eq(contractInvoices.billingMonth, targetMonth),
    ),
  );
  if (existing.length > 0) continue; // 既に作成済

  // 見積計上仕訳をMFへ
  try {
    const request = await buildJournalFromContract({
      transactionDate: lastDayOfMonth(targetMonth),
      contractNumber: contract.contractNumber,
      billingMonth: targetMonth,
      amount: contract.monthlyAmount || 0,
      supplierName: contract.supplierName,
      accountTitle: contract.accountTitle,
      mfAccountCode: contract.mfAccountCode,
      mfTaxCode: contract.mfTaxCode,
      mfDepartmentCode: contract.mfDepartmentCode,
      mfCounterpartyCode: contract.mfCounterpartyCode,
      memo: "月次見積計上（自動）",
    });
    const journalResult = await createJournal(request);

    // contract_invoice 作成
    await db.insert(contractInvoices).values({
      contractId: contract.id,
      billingMonth: targetMonth,
      expectedAmount: contract.monthlyAmount,
      status: "見積計上",
      journalId: journalResult.id,
    });

    processed.push({ contract, journalId: journalResult.id });
  } catch (e) {
    // DLQ送信
    await sendToDLQ({ contractId: contract.id, month: targetMonth, error: e });
    failed.push({ contract, error: e });
  }
}

// Slackサマリー通知
await notifyOps(`✅ 月次見積計上完了: ${processed.length}件成功 / ${failed.length}件失敗`);
```

### Vercel Cron設定

`vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/contract-monthly-accrual",
    "schedule": "0 0 1 * *"  // 毎月1日 UTC 00:00 = JST 9:00
  }]
}
```

### 分散ロック（既存パターン利用）

`withCronLock()` を利用して二重実行を防止（`src/lib/cron-helper.ts` 参照）。

## Phase C: 請求書到着時の差額照合

**目的**: 請求書が到着したら実額と見積額を比較、差額があれば調整仕訳。

### 処理フロー

```typescript
// POST /api/admin/contracts/[id]/invoices （既存エンドポイント拡張）
async function approveInvoice(invoiceId: number, actualAmount: number) {
  const invoice = await getInvoice(invoiceId);
  const diff = actualAmount - invoice.expectedAmount;

  if (Math.abs(diff) < 10) {
    // 実質一致 → 承認のみ
    await updateInvoice(invoiceId, { actualAmount, status: "承認済" });
    return;
  }

  if (diff > 0) {
    // 実額 > 見積 → 差額を追加計上
    const adjustmentJournal = await buildJournalFromContract({
      ...baseParams,
      amount: diff,
      memo: `差額調整 (実額${actualAmount} - 見積${invoice.expectedAmount})`,
    });
    const result = await createJournal(adjustmentJournal);
    await updateInvoice(invoiceId, { actualAmount, adjustmentJournalId: result.id, status: "承認済" });
  } else {
    // 実額 < 見積 → 見積の一部を取消
    const reversalJournal = buildReversalJournal(Math.abs(diff));
    await createJournal(reversalJournal);
    await updateInvoice(invoiceId, { actualAmount, adjustmentJournalId: result.id, status: "承認済" });
  }
}
```

### DBスキーマ追加

contractInvoices に追加:
- `adjustmentJournalId: integer` — 差額調整仕訳のID
- `adjustmentAmount: integer` — 差額（正=追加計上、負=取消）

## Phase D: 月末未到着アラート

**Cron**: 毎月末日 PM6:00 JST

```typescript
const pending = await db.select().from(contractInvoices).where(
  and(
    eq(contractInvoices.billingMonth, currentMonth),
    eq(contractInvoices.status, "見積計上"),  // 受領されてない
  ),
);
if (pending.length > 0) {
  await notifyOps(`🚨 ${pending.length}件の請求書が月末時点で未到着`);
}
```

## Phase E: 過去データのバックフィル（オプション）

30件の契約について、2026-01〜03 のMF既存仕訳を contract_invoice にリンク:

```
既存MF仕訳（サンフロンティア 地代家賃 2,797,010 2026-03）
↓
contract_invoice 作成（status="仕訳済"、journalIdは既存ID）
```

→ Phase B Cron 動作後は「仕訳済」ステータスで履歴データが揃う。

## 注意点・リスク

### 1. 期間切れ契約
- CT-0002 デンソーHD（2025-12-31 終了、自動更新なし）→ 月次自動仕訳を**スキップすべき**
- CT-0014 社労士和（同上）
- 新規契約書が来るまで待つ or 手動で期間延長

### 2. MFコード未設定契約
- 現30件は全て `mf_*_code` が null
- Name-based解決で動くが、不一致時は仕訳失敗
- **推奨**: 初回仕訳失敗した契約は、管理画面でMFコードを手動設定してリトライ

### 3. 従量契約の月額
- Vercel, Pulumi, Notion, Slack 等は使用量変動
- 見積計上では contract.monthlyAmount（MF実績平均）を使うが、実額と乖離する可能性
- 差額調整仕訳が自動発生する想定

### 4. カード自動決済 vs 請求書払い
- カード自動決済契約（Adobe, Google, Figma等）は **貸方=未払金** の方が正確
- 請求書払い契約は **貸方=買掛金**
- 現状は全て買掛金扱い → billingType で分岐するロジック追加検討

### 5. 税区分
- 海外SaaSは「リバースチャージ方式」や「海外非課税」で税処理が異なる
- 契約マスタに `mfTaxCode` を設定するか、契約側で海外フラグを持つべき

### 6. 二重計上防止
- Cron冪等性: (contractId × billingMonth) でユニーク制約（既に contract_invoices_contract_month_unique index あり）
- 分散ロック: withCronLock で二重実行防止

## 参考: 既存コード

- `src/lib/mf-accounting.ts` (line 550) `buildJournalFromContract`
- `src/app/api/mf/journal/route.ts` (line 53) 契約仕訳パス
- `src/app/admin/journals/ContractJournalTab.tsx` 手動仕訳UI
- `src/lib/cron-helper.ts` `withCronGuard`, `withCronLock`
- `src/app/api/cron/card-reconciliation/route.ts` 既存Cronのパターン

## 実装優先度

1. **Phase A**（30分）— Go/No-Go 判断
2. **Phase B**（1-2時間）— 月次自動化、最大の価値
3. **Phase D**（30分）— 未到着アラート、運用安全ネット
4. **Phase C**（1時間）— 差額調整、頻度は低いが重要
5. **Phase E**（30分）— 過去データバックフィル、履歴整備

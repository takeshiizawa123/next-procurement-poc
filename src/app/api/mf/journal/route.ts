import { NextRequest, NextResponse } from "next/server";
import {
  createJournal, buildJournalFromPurchase,
  resolveAccountCode, resolveTaxCode, resolveCounterpartyCode, resolveDepartmentCode,
} from "@/lib/mf-accounting";
import { getStatus, updateStatus } from "@/lib/gas-client";
import { getSlackClient, notifyOps } from "@/lib/slack";
import { requireBearerAuth, requireApiKey } from "@/lib/api-auth";

/**
 * 仕訳登録API（Bearer認証 or APIキー認証）
 * POST /api/mf/journal
 *
 * Body: { prNumber: string }
 *
 * 証憑完了の購買申請をMF会計Plusに仕訳登録し、
 * GASステータスを「計上済」に更新、Slackに通知。
 */
export async function POST(request: NextRequest) {
  // Bearer認証（cron/Slack）またはAPIキー認証（ブラウザ）のいずれかでOK
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  try {
    const body = (await request.json()) as {
      prNumber: string;
      overrides?: {
        debitAccount?: string;
        creditAccount?: string;
        creditSubAccount?: string;
        counterpartyCode?: string;
        taxCategory?: string;
        department?: string;
        hubspotDealId?: string;
        memo?: string;
      };
    };
    const { prNumber, overrides } = body;
    if (!prNumber) {
      return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
    }

    // GASから購買申請情報を取得
    const statusResult = await getStatus(prNumber);
    if (!statusResult.success || !statusResult.data) {
      return NextResponse.json(
        { error: `購買申請 ${prNumber} が見つかりません` },
        { status: 404 },
      );
    }

    const purchase = statusResult.data;

    // 証憑完了チェック
    const voucherStatus = (purchase as Record<string, string>)["証憑対応"] || "";
    if (voucherStatus !== "添付済") {
      return NextResponse.json(
        { error: `${prNumber} は証憑未完了です（現在: ${voucherStatus || "未添付"}）` },
        { status: 400 },
      );
    }

    // 仕訳リクエストを構築（証憑金額優先、フォールバック: 発注データ金額）
    const voucherAmount = Number((purchase as Record<string, unknown>)["証憑金額"] || 0);
    // 発注データは税抜なのでフォールバック時は税込換算
    const orderAmountExclTax = Number((purchase as Record<string, unknown>)["合計額（税抜）"] || 0);
    // 税率: 購買データに税率フィールドがあればそれを使用、なければ10%にフォールバック
    const purchaseTaxRate = Number((purchase as Record<string, unknown>)["税率"] || 0);
    let orderAmount = 0;
    if (orderAmountExclTax > 0) {
      if (purchaseTaxRate > 0) {
        orderAmount = Math.round(orderAmountExclTax * (1 + purchaseTaxRate / 100));
      } else {
        console.warn(`[mf-journal] ${prNumber}: 税率フィールドが未設定のため10%で計算します（税抜額: ¥${orderAmountExclTax}）`);
        orderAmount = Math.round(orderAmountExclTax * 1.1);
      }
    }
    const amount = voucherAmount || orderAmount;
    // 仕訳日 = 検収日（原則）→ 申請日 → 本日のフォールバック
    const transactionDate = String(
      (purchase as Record<string, unknown>)["検収日"] ||
      (purchase as Record<string, unknown>)["申請日"] ||
      new Date().toISOString().split("T")[0]
    );
    const p = purchase as Record<string, unknown>;
    const itemName = String(p["品目名"] || "");
    const katanaPo = String(p["PO番号"] || "");
    const budgetNum = String(p["予算番号"] || "");
    // 取引先: 国税API確定名 > 発注データの購入先
    const verifiedName = String(p["MF取引先"] || "");
    const supplierName = verifiedName || String(p["購入先"] || "");
    // 適格請求書判定: 適格番号があれば適格
    const qualifiedNumber = String(p["適格番号"] || "");
    const isQualifiedInvoice = qualifiedNumber.startsWith("T") && qualifiedNumber.length > 1;

    const journalRequest = await buildJournalFromPurchase({
      transactionDate,
      accountTitle: String(p["勘定科目"] || "消耗品費"),
      amount,
      paymentMethod: String(p["支払方法"] || ""),
      supplierName,
      department: String(p["部門"] || ""),
      poNumber: prNumber,
      itemName: itemName || undefined,
      katanaPo: katanaPo || undefined,
      budgetNumber: budgetNum || undefined,
      isQualifiedInvoice,
    });

    // UI編集内容(overrides)を仕訳リクエストに反映
    if (overrides && journalRequest.branches?.[0]) {
      const branch = journalRequest.branches[0];
      if (overrides.debitAccount) {
        const code = await resolveAccountCode(overrides.debitAccount);
        if (code) branch.debitor.account_code = code;
      }
      if (overrides.taxCategory) {
        const code = await resolveTaxCode(overrides.taxCategory);
        if (code) branch.debitor.tax_code = code;
        // 税額再計算
        const rate = overrides.taxCategory.includes("10%") ? 10 : overrides.taxCategory.includes("8%") ? 8 : 0;
        branch.debitor.tax_value = rate > 0 ? Math.floor(amount * rate / (100 + rate)) : 0;
      }
      if (overrides.creditAccount) {
        const code = await resolveAccountCode(overrides.creditAccount);
        if (code) branch.creditor.account_code = code;
      }
      if (overrides.creditSubAccount !== undefined) {
        branch.creditor.sub_account_code = overrides.creditSubAccount || undefined;
      }
      if (overrides.counterpartyCode) {
        branch.creditor.counterparty_code = overrides.counterpartyCode;
      }
      if (overrides.department) {
        const code = await resolveDepartmentCode(overrides.department);
        if (code) branch.debitor.department_code = code;
      }
      if (overrides.memo) {
        journalRequest.memo = overrides.memo;
        branch.remark = overrides.memo;
      }
    }

    // MF会計Plusに仕訳登録
    const journalResult = await createJournal(journalRequest);
    const amountSource = voucherAmount ? "証憑" : "発注";
    console.log("[mf-journal] Created:", { prNumber, journalId: journalResult.id, amountSource, amount });

    // GASステータスを「計上済」に更新
    await updateStatus(prNumber, {
      "MF仕訳ID": String(journalResult.id),
    });

    // Slack通知
    try {
      const client = getSlackClient();
      await notifyOps(
        client,
        `✅ *仕訳登録完了* ${prNumber} — MF仕訳ID: ${journalResult.id} / ¥${amount.toLocaleString()}`,
      );
    } catch {
      // Slack通知失敗は無視
    }

    return NextResponse.json({
      ok: true,
      prNumber,
      journalId: journalResult.id,
      journalUrl: journalResult.url,
    });
  } catch (error) {
    console.error("[mf-journal] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

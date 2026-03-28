import { NextRequest, NextResponse } from "next/server";
import {
  getSlackClient,
  buildNewRequestBlocks,
  buildPurchasedRequestBlocks,
  sendApprovalDM,
  notifyOps,
  calcPaymentDueDate,
  type RequestInfo,
} from "@/lib/slack";
import { registerPurchase, updateStatus, getEmployees, type Employee } from "@/lib/gas-client";
import { estimateAccount } from "@/lib/account-estimator";
import { resolveApprovalRoute } from "@/lib/approval-router";
import { requireApiKey } from "@/lib/api-auth";

/**
 * フォームの検収者名からSlackIDを解決する。
 * 未指定の場合は申請者自身のSlackIDを返す。
 */
function resolveInspector(
  formData: FormData,
  applicantUserId: string,
  employees: Employee[],
): string {
  const inspectorName = (formData.get("inspector_name") as string)?.trim();
  if (!inspectorName) {
    return applicantUserId.startsWith("U") ? applicantUserId : "";
  }
  const found = employees.find((e) => e.name === inspectorName);
  return found?.slackId || (applicantUserId.startsWith("U") ? applicantUserId : "");
}

const PURCHASE_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";

/**
 * Webフォームからの購買申請受付
 * POST /api/purchase/submit
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();

    const userId = formData.get("user_id") as string;
    const channelId = (formData.get("channel_id") as string) || PURCHASE_CHANNEL;

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }
    if (!channelId) {
      return NextResponse.json(
        { error: "投稿先チャンネルが設定されていません。管理者に連絡してください。" },
        { status: 400 },
      );
    }

    // バリデーション
    const itemName = (formData.get("item_name") as string)?.trim();
    const amountRaw = formData.get("amount") as string;
    const quantityRaw = formData.get("quantity") as string;
    const paymentMethod = formData.get("payment_method") as string;
    const supplierName = (formData.get("supplier_name") as string)?.trim();
    const requestType = formData.get("request_type") as string;

    if (!itemName || !amountRaw || !paymentMethod || !supplierName || !requestType) {
      const missing = [];
      if (!itemName) missing.push("品目名");
      if (!amountRaw) missing.push("金額");
      if (!paymentMethod) missing.push("支払方法");
      if (!supplierName) missing.push("購入先名");
      if (!requestType) missing.push("申請区分");
      console.error("[web-purchase] Missing fields:", missing.join(", "), {
        itemName, amountRaw, paymentMethod, supplierName, requestType,
      });
      return NextResponse.json(
        { error: `必須項目が不足しています: ${missing.join("、")}` },
        { status: 400 },
      );
    }

    const amount = parseInt(amountRaw.replace(/[,，]/g, ""), 10);
    const quantity = parseInt(quantityRaw || "1", 10) || 1;

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "金額を正しく入力してください" }, { status: 400 });
    }

    const totalAmount = amount * quantity;
    const amountStr = `¥${totalAmount.toLocaleString()}`;

    const client = getSlackClient();

    // フォームから従業員情報を取得
    const formApplicantName = (formData.get("applicant_name") as string)?.trim() || "";
    const formDepartment = (formData.get("department") as string)?.trim() || "";

    // ユーザー名を取得
    let userName = formApplicantName || userId;
    if (!formApplicantName && userId) {
      try {
        const userInfo = await client.users.info({ user: userId });
        userName = userInfo.user?.real_name || userInfo.user?.name || userId;
      } catch {
        console.warn("[web-purchase] Could not fetch user info for", userId);
      }
    }

    const isPurchased = requestType === "購入済";

    // 承認ルート解決（従業員マスタから部門長を取得）
    const [approvalRoute, empResult] = await Promise.all([
      resolveApprovalRoute(userName, userId, totalAmount),
      getEmployees(),
    ]);
    const employees = empResult.success ? (empResult.data?.employees || []) : [];
    const department = formDepartment || approvalRoute.employee?.departmentName || "";
    const approverSlackId = isPurchased ? "" : approvalRoute.primaryApprover;

    // GAS登録を先に行い、GAS発番のPO番号を取得
    const estimation = estimateAccount(itemName, supplierName, totalAmount);
    let poNumber = "";
    try {
      const gasResult = await registerPurchase({
        applicant: userName,
        itemName,
        totalAmount,
        unitPrice: amount,
        quantity,
        purchaseSource: supplierName,
        purchaseSourceUrl: (formData.get("url") as string)?.trim() || "",
        hubspotInfo: (formData.get("hubspot_deal_id") as string)?.trim() || "",
        budgetNumber: (formData.get("budget_number") as string)?.trim() || "",
        paymentMethod,
        purpose: (formData.get("asset_usage") as string)?.trim() || "",
        accountTitle: estimation.account + (estimation.subAccount ? `（${estimation.subAccount}）` : ""),
        remarks: (formData.get("notes") as string)?.trim() || "",
        isPurchased,
      });
      if (gasResult.success && gasResult.data?.prNumber) {
        poNumber = gasResult.data.prNumber;
        console.log("[web-purchase] GAS registered:", gasResult.data);
      } else {
        console.error("[web-purchase] GAS registration failed:", gasResult.error);
      }
    } catch (gasError) {
      console.error("[web-purchase] GAS registration error:", gasError);
    }

    // GAS発番失敗時のフォールバック（ローカル発番）
    if (!poNumber) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
      poNumber = `PO-${yyyymm}-${seq}`;
      console.warn("[web-purchase] Falling back to local PO number:", poNumber);
    }

    const requestInfo: RequestInfo = {
      poNumber,
      itemName,
      amount: amountStr,
      applicant: userId.startsWith("U") ? `<@${userId}>` : userName,
      department,
      supplierName,
      paymentMethod,
      applicantSlackId: userId.startsWith("U") ? userId : "",
      approverSlackId,
      inspectorSlackId: resolveInspector(formData, userId, employees),
      paymentDueDate: paymentMethod.includes("前払い")
        ? new Date().toISOString().slice(0, 10)
        : paymentMethod.includes("請求書") ? calcPaymentDueDate() : undefined,
    };

    const blocks = isPurchased
      ? buildPurchasedRequestBlocks(requestInfo)
      : buildNewRequestBlocks(requestInfo);

    // チャンネル投稿（承認者メンション付き）— Slack障害時もGAS登録済みデータを保全
    const mentionText = !isPurchased && approverSlackId
      ? ` — 承認者: <@${approverSlackId}>`
      : "";

    let slackPosted = false;
    let resultTs: string | undefined;
    try {
      const result = await client.chat.postMessage({
        channel: channelId,
        blocks,
        text: `購買申請: ${poNumber} ${itemName} ${amountStr}${mentionText}`,
      });
      resultTs = result.ts ?? undefined;
      slackPosted = true;
    } catch (slackError) {
      console.error("[web-purchase] Slack postMessage failed (data saved in GAS):", slackError);
    }

    // Slack投稿後にGASのSlackリンク情報を更新
    if (resultTs) {
      const slackLink = `https://slack.com/archives/${channelId}/p${resultTs.replace(".", "")}`;
      try {
        await updateStatus(poNumber, { slackTs: resultTs, slackLink });
      } catch (e) {
        console.error("[web-purchase] Failed to update GAS with Slack link:", e);
      }
    }

    // 承認者メンションをスレッドに投稿（チャンネル投稿のテキストはブロック表示時に見えないため）
    if (!isPurchased && approverSlackId && resultTs) {
      const approverMention = `<@${approverSlackId}>`;
      const secondMention = approvalRoute.requiresSecondApproval && approvalRoute.secondaryApprover
        ? ` → <@${approvalRoute.secondaryApprover}>`
        : "";
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: resultTs,
          text: `📋 承認依頼: ${approverMention}${secondMention}\n${approvalRoute.requiresSecondApproval ? "（10万円以上: 二段階承認）" : ""}`,
        });
      } catch (e) {
        console.error("[web-purchase] Failed to post approval mention:", e);
      }
    }

    console.log("[web-purchase] Posted:", {
      poNumber,
      channelId,
      messageTs: resultTs,
      userId,
      isPurchased,
      approver: approverSlackId,
      source: "web",
      slackPosted,
    });

    if (isPurchased) {
      if (resultTs) {
        try {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: resultTs,
            text: [
              `📦 購入済申請を受け付けました（${userName}）`,
              `📎 納品書・領収書をこのスレッドに添付してください。`,
              `⏸️ 証憑が添付されるまで、経理処理は保留されます。`,
            ].join("\n"),
          });
        } catch (e) {
          console.error("[web-purchase] Failed to post purchased guide:", e);
        }
      }
      try {
        await notifyOps(client, `📦 *購入済申請* ${poNumber} — ${itemName} ${amountStr}（<@${userId}>）— 証憑待ち`);
      } catch (e) {
        console.error("[web-purchase] Failed to notify OPS:", e);
      }
    } else {
      if (approverSlackId && resultTs) {
        try {
          await sendApprovalDM(client, requestInfo, channelId, resultTs);
        } catch (dmError) {
          console.error("[web-purchase] Failed to send approval DM:", dmError);
        }
      }
      try {
        await notifyOps(client, `🔵 *新規申請* ${poNumber} — ${itemName} ${amountStr}（<@${userId}>）— 承認待ち`);
      } catch (e) {
        console.error("[web-purchase] Failed to notify OPS:", e);
      }
    }

    // 追加品目の登録（一括申請）
    const extraItemsRaw = (formData.get("extra_items") as string)?.trim() || "[]";
    try {
      const extraItems = JSON.parse(extraItemsRaw) as { itemName: string; amount: number; quantity: number; url: string }[];
      const extraSlackLink = resultTs
        ? `https://slack.com/archives/${channelId}/p${resultTs.replace(".", "")}`
        : "";
      for (const extra of extraItems) {
        if (!extra.itemName || !extra.amount) continue;
        const extraTotal = extra.amount * extra.quantity;
        const extraEstimation = estimateAccount(extra.itemName, supplierName, extraTotal);
        await registerPurchase({
          applicant: userName,
          itemName: extra.itemName,
          totalAmount: extraTotal,
          unitPrice: extra.amount,
          quantity: extra.quantity,
          purchaseSource: supplierName,
          purchaseSourceUrl: extra.url || "",
          paymentMethod,
          accountTitle: extraEstimation.account + (extraEstimation.subAccount ? `（${extraEstimation.subAccount}）` : ""),
          remarks: `[一括申請: ${poNumber}]`,
          slackTs: resultTs || "",
          slackLink: extraSlackLink,
          isPurchased,
        }).catch((e) => console.error("[web-purchase] Extra item GAS error:", e));
      }
    } catch {
      // JSON parse error - ignore
    }

    return NextResponse.json({
      ok: true,
      poNumber,
      ...(slackPosted ? {} : { warning: "申請データは保存されましたが、Slack通知に失敗しました。管理者に連絡してください。" }),
    });
  } catch (error) {
    console.error("[web-purchase] submit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "送信に失敗しました" },
      { status: 500 },
    );
  }
}

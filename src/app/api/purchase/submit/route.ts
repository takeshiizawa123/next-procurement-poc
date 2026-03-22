import { NextRequest, NextResponse } from "next/server";
import {
  getSlackClient,
  buildNewRequestBlocks,
  buildPurchasedRequestBlocks,
  sendApprovalDM,
  notifyOps,
  type RequestInfo,
} from "@/lib/slack";
import { registerPurchase, getEmployees } from "@/lib/gas-client";
import { estimateAccount } from "@/lib/account-estimator";

const PURCHASE_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";
const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";

/**
 * Webフォームからの購買申請受付
 * POST /api/purchase/submit
 */
export async function POST(request: NextRequest) {
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

    // PO番号発番（暫定: ランダム。Sprint 1-3でGAS連携に移行）
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
    const poNumber = `PO-${yyyymm}-${seq}`;

    const totalAmount = amount * quantity;
    const amountStr = `¥${totalAmount.toLocaleString()}`;

    const approverSlackId = DEFAULT_APPROVER;

    const client = getSlackClient();

    // フォームから従業員情報を取得（従業員マスタ選択済みの場合）
    const formApplicantName = (formData.get("applicant_name") as string)?.trim() || "";
    const formDepartment = (formData.get("department") as string)?.trim() || "";

    // ユーザー名を取得（Slack ID経由 or フォーム直接入力）
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

    // 部門名: フォームから取得済みならそれを使い、なければ従業員マスタから検索
    let department = formDepartment;
    if (!department) {
      try {
        const empResult = await getEmployees();
        if (empResult.success && empResult.data?.employees) {
          const match = empResult.data.employees.find((emp) => {
            const aliases = emp.slackAliases
              .split(/[,、]/)
              .map((a) => a.trim().toLowerCase());
            const uname = userName.toLowerCase();
            return (
              emp.name === userName ||
              emp.name.includes(userName) ||
              userName.includes(emp.name) ||
              aliases.some((a) => a && (a === uname || uname.includes(a)))
            );
          });
          if (match) department = match.departmentName;
        }
      } catch {
        console.warn("[web-purchase] Could not fetch employee master");
      }
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
      approverSlackId: isPurchased ? "" : approverSlackId,
      inspectorSlackId: userId.startsWith("U") ? userId : "",
    };

    const blocks = isPurchased
      ? buildPurchasedRequestBlocks(requestInfo)
      : buildNewRequestBlocks(requestInfo);

    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `購買申請: ${poNumber} ${itemName} ${amountStr}`,
    });

    console.log("[web-purchase] Posted:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
      isPurchased,
      source: "web",
    });

    if (isPurchased) {
      if (result.ts) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: result.ts,
          text: [
            `📦 購入済申請を受け付けました（${userName}）`,
            `📎 納品書・領収書をこのスレッドに添付してください。`,
            `⏸️ 証憑が添付されるまで、経理処理は保留されます。`,
          ].join("\n"),
        });
      }
      await notifyOps(client, `📦 *購入済申請* ${poNumber} — ${itemName} ${amountStr}（<@${userId}>）— 証憑待ち`);
    } else {
      if (approverSlackId && result.ts) {
        try {
          await sendApprovalDM(client, requestInfo, channelId, result.ts);
        } catch (dmError) {
          console.error("[web-purchase] Failed to send approval DM:", dmError);
        }
      }
      await notifyOps(client, `🔵 *新規申請* ${poNumber} — ${itemName} ${amountStr}（<@${userId}>）— 承認待ち`);
    }

    // GAS（スプレッドシート）に購買申請を登録
    const slackLink = result.ts
      ? `https://slack.com/archives/${channelId}/p${result.ts.replace(".", "")}`
      : "";

    try {
      // 勘定科目を推定
      const estimation = estimateAccount(itemName, supplierName, totalAmount);

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
        poNumber,
        remarks: (formData.get("notes") as string)?.trim() || "",
        slackTs: result.ts || "",
        slackLink,
        isPurchased,
      });

      if (gasResult.success && gasResult.data) {
        console.log("[web-purchase] GAS registered:", {
          prNumber: gasResult.data.prNumber,
          rowNumber: gasResult.data.rowNumber,
          poNumber,
        });
      } else {
        console.error("[web-purchase] GAS registration failed:", gasResult.error);
      }
    } catch (gasError) {
      // GAS登録失敗はSlack投稿には影響させない（ログのみ）
      console.error("[web-purchase] GAS registration error:", gasError);
    }

    return NextResponse.json({ ok: true, poNumber });
  } catch (error) {
    console.error("[web-purchase] submit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "送信に失敗しました" },
      { status: 500 },
    );
  }
}

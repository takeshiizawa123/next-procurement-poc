import { NextRequest, NextResponse } from "next/server";
import {
  getSlackClient,
  buildNewRequestBlocks,
  sendApprovalDM,
  type RequestInfo,
} from "@/lib/slack";

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
      return NextResponse.json({ error: "必須項目を入力してください" }, { status: 400 });
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

    // ユーザー名を取得
    let userName = userId;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || userId;
    } catch {
      console.warn("[web-purchase] Could not fetch user info for", userId);
    }

    const requestInfo: RequestInfo = {
      poNumber,
      itemName,
      amount: amountStr,
      applicant: `<@${userId}>`,
      department: "", // TODO: 従業員マスタから取得
      supplierName,
      paymentMethod,
      applicantSlackId: userId,
      approverSlackId,
      inspectorSlackId: userId, // Webフォームではデフォルトで申請者本人
    };

    // チャンネルにメッセージ投稿
    const result = await client.chat.postMessage({
      channel: channelId,
      blocks: buildNewRequestBlocks(requestInfo),
      text: `購買申請: ${poNumber} ${itemName} ${amountStr}`,
    });

    console.log("[web-purchase] Posted:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
      source: "web",
    });

    // 承認者にDM送信
    if (approverSlackId && result.ts) {
      try {
        await sendApprovalDM(client, requestInfo, channelId, result.ts);
      } catch (dmError) {
        console.error("[web-purchase] Failed to send approval DM:", dmError);
      }
    }

    // 追加フィールドをログに記録（Sprint 1-3でGAS登録に移行）
    console.log("[web-purchase] Form details:", {
      poNumber,
      requestType,
      quantity,
      url: formData.get("url") || "",
      assetUsage: formData.get("asset_usage") || "",
      katanaPo: formData.get("katana_po") || "",
      hubspotDealId: formData.get("hubspot_deal_id") || "",
      budgetNumber: formData.get("budget_number") || "",
      notes: formData.get("notes") || "",
    });

    return NextResponse.json({ ok: true, poNumber });
  } catch (error) {
    console.error("[web-purchase] submit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "送信に失敗しました" },
      { status: 500 },
    );
  }
}

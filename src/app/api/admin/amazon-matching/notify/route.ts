import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getSlackClient, safeDmChannel } from "@/lib/slack";
import { getEmployees } from "@/lib/gas-client";

interface OrderInfo {
  orderNumber: string;
  productName: string;
  lineTotal: number;
  orderDate: string;
}

interface NotifyRequest {
  buyerName: string;
  orders: OrderInfo[];
}

/**
 * Amazon未一致注文 → 購入者にSlack DM送信
 * POST /api/admin/amazon-matching/notify
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as NotifyRequest;
    const { buyerName, orders } = body;

    if (!buyerName || !orders?.length) {
      return NextResponse.json({ error: "buyerName and orders are required" }, { status: 400 });
    }

    // 従業員マスタからSlack IDを特定（名前マッチ）
    const empResult = await getEmployees();
    if (!empResult.success || !empResult.data?.employees) {
      return NextResponse.json({ error: "従業員マスタ取得失敗" }, { status: 500 });
    }

    const nameNorm = buyerName.replace(/\s+/g, "");
    const employee = empResult.data.employees.find((e) => {
      const eName = e.name.replace(/\s+/g, "");
      if (eName === nameNorm || eName.includes(nameNorm) || nameNorm.includes(eName)) return true;
      // slackAliases もチェック
      const aliases = (e.slackAliases || "").split(/[,、]/).map((a) => a.trim().replace(/\s+/g, ""));
      return aliases.some((a) => a && (a === nameNorm || nameNorm.includes(a) || a.includes(nameNorm)));
    });

    if (!employee?.slackId) {
      return NextResponse.json({
        error: `「${buyerName}」のSlack IDが見つかりません`,
        notified: false,
      }, { status: 404 });
    }

    // Slack DM送信
    const client = getSlackClient();
    const orderList = orders
      .map((o) => `• ${o.orderDate} *${o.productName}* ¥${o.lineTotal.toLocaleString()} (${o.orderNumber})`)
      .join("\n");

    await client.chat.postMessage({
      channel: safeDmChannel(employee.slackId),
      text: [
        "📦 *Amazon注文 — 購買申請の確認依頼*",
        "",
        `以下のAmazon注文が購買申請と一致しませんでした。`,
        `事後申請が必要な場合は \`/purchase\` から「購入済（事後報告）」で申請してください。`,
        "",
        orderList,
        "",
        "_※既に申請済みの場合、品名や金額が異なっている可能性があります。経理までご連絡ください。_",
      ].join("\n"),
    });

    return NextResponse.json({
      ok: true,
      notified: true,
      employeeName: employee.name,
      orderCount: orders.length,
    });
  } catch (error) {
    console.error("[amazon-notify] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { employees, predictedTransactions, purchaseRequests } from "@/db/schema";
import { getSlackClient, notifyOps, safeDmChannel, sendApprovalDM, type RequestInfo } from "@/lib/slack";
import { invalidateRecentRequests } from "@/lib/db-client";
import { resolveApprovalRoute } from "@/lib/approval-router";

const SLACK_TRIP_CHANNEL = process.env.SLACK_TRIP_CHANNEL || "";

/**
 * 出張予約完了 新規登録 API
 * POST /api/trip/submit
 *
 * Body:
 * {
 *   destination: string;       // 行き先
 *   startDate: string;         // YYYY-MM-DD
 *   endDate: string;           // YYYY-MM-DD
 *   purpose: string;           // 出張目的
 *   transportService: string;  // "スマートEX" | "ANA" | "JAL" | "その他"
 *   transport: string;         // 利用交通手段の詳細（便名等）
 *   transportAmount: number;   // 交通費概算（円）
 *   accommodationService?: string; // "じゃらん" | "楽天トラベル" | "一休" | "その他"
 *   accommodationPlace?: string;   // 宿泊先名
 *   accommodationAmount?: number;  // 宿泊費概算（円）
 *   hubspotDealId?: string;
 *   isEstimate?: boolean;      // 概算フラグ
 *   applicantSlackId: string;  // 申請者のSlack ID（セッションから）
 *   applicantName: string;     // 申請者名
 * }
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      destination,
      startDate,
      endDate,
      purpose,
      transportService,
      transport,
      transportAmount,
      accommodationService,
      accommodationPlace,
      accommodationAmount,
      hubspotDealId,
      isEstimate,
      applicantSlackId,
      applicantName,
    } = body;

    // バリデーション
    if (!destination || !startDate || !endDate || !purpose) {
      return NextResponse.json(
        { error: "必須項目が不足しています (行き先/日程/目的)" },
        { status: 400 },
      );
    }
    if (!transport || !transportAmount || transportAmount <= 0) {
      return NextResponse.json(
        { error: "交通費情報が不足しています" },
        { status: 400 },
      );
    }
    if (new Date(startDate) > new Date(endDate)) {
      return NextResponse.json(
        { error: "終了日は開始日以降にしてください" },
        { status: 400 },
      );
    }

    // 申請者情報を従業員マスタから取得
    let dept = "";
    let mfOfficeMemberId: string | null = null;
    if (applicantSlackId) {
      const emp = await db
        .select()
        .from(employees)
        .where(eq(employees.slackId, applicantSlackId))
        .limit(1);
      if (emp.length > 0) {
        dept = emp[0].departmentName;
        mfOfficeMemberId = emp[0].mfOfficeMemberId;
      }
    }

    // 承認者解決（購買と同じロジック）
    const approvalRoute = await resolveApprovalRoute(
      applicantName,
      applicantSlackId,
      Number(transportAmount) + Number(accommodationAmount || 0),
    );
    const approverSlackId = approvalRoute.primaryApprover;

    // 日当計算
    const start = new Date(startDate);
    const end = new Date(endDate);
    const nights = Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const DAILY_ALLOWANCE_OVERNIGHT = 3000;
    const DAILY_ALLOWANCE_DAY_TRIP = 1000;
    const dailyAllowance =
      nights > 0 ? DAILY_ALLOWANCE_OVERNIGHT * (nights + 1) : DAILY_ALLOWANCE_DAY_TRIP;
    const totalEstimate = Number(transportAmount) + Number(accommodationAmount || 0) + dailyAllowance;

    // ユニークPO番号を生成（TRIP-YYYYMM-NNNN）
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prefix = `TRIP-${yyyymm}-`;
    const existing = await db
      .select({ poNumber: purchaseRequests.poNumber })
      .from(purchaseRequests)
      .orderBy(purchaseRequests.poNumber);
    const tripNumbers = existing
      .filter((e) => e.poNumber.startsWith(prefix))
      .map((e) => parseInt(e.poNumber.slice(prefix.length), 10))
      .filter((n) => !isNaN(n));
    const nextSeq = tripNumbers.length > 0 ? Math.max(...tripNumbers) + 1 : 1;
    const tripPoNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

    // purchase_requests に1件登録（出張全体のマスターレコード）
    // 金額は交通費+宿泊費（日当は別経路で支給）
    const tripTotal = Number(transportAmount) + Number(accommodationAmount || 0);
    const supplierName = [transportService, accommodationService].filter(Boolean).join(" / ") || null;
    const itemName = `出張: ${destination} (${startDate} 〜 ${endDate})`;

    await db.insert(purchaseRequests).values({
      poNumber: tripPoNumber,
      status: "申請済",
      requestType: "購入前",
      applicantSlackId,
      applicantName,
      department: dept,
      approverSlackId: approverSlackId || null,
      approverName: approvalRoute.employee?.name || null,
      itemName,
      unitPrice: tripTotal,
      quantity: 1,
      totalAmount: tripTotal,
      paymentMethod: "会社カード",
      purpose: `${purpose}\n交通: ${transport}`,
      supplierName,
      hubspotDealId: hubspotDealId ?? null,
      remarks: `日当: ¥${dailyAllowance.toLocaleString()} / 合計見込: ¥${totalEstimate.toLocaleString()}${accommodationPlace ? `\n宿泊先: ${accommodationPlace}` : ""}`,
      voucherStatus: "none",
      isEstimate: !!isEstimate,
    });

    // 予測テーブルに「交通費」と「宿泊費」を別レコードとして登録
    const timestamp = now.getTime();
    const transportPredId = `PCT-${yyyymm}-${String(timestamp % 10000).padStart(4, "0")}T`;
    const hotelPredId = `PCT-${yyyymm}-${String((timestamp + 1) % 10000).padStart(4, "0")}H`;

    await db.insert(predictedTransactions).values({
      id: transportPredId,
      poNumber: tripPoNumber,
      type: "trip_transport",
      mfOfficeMemberId,
      predictedAmount: Number(transportAmount),
      predictedDate: startDate,
      supplier: transportService || "交通",
      applicant: applicantName,
      applicantSlackId,
      status: "pending",
      isEstimate: !!isEstimate,
    });

    if (accommodationAmount && Number(accommodationAmount) > 0) {
      await db.insert(predictedTransactions).values({
        id: hotelPredId,
        poNumber: tripPoNumber,
        type: "trip_hotel",
        mfOfficeMemberId,
        predictedAmount: Number(accommodationAmount),
        predictedDate: startDate, // チェックイン日 = 出発日と仮定
        supplier: accommodationService || "宿泊",
        applicant: applicantName,
        applicantSlackId,
        status: "pending",
        isEstimate: !!isEstimate,
      });
    }

    // Slackチャンネルに投稿
    let slackTs = "";
    if (SLACK_TRIP_CHANNEL) {
      try {
        const client = getSlackClient();
        const tripType = nights > 0 ? `${nights}泊${nights + 1}日` : "日帰り";
        const blocks = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `✈️ 出張予約完了 — ${applicantName}`,
            },
          },
          ...(isEstimate
            ? [
                {
                  type: "context",
                  elements: [
                    {
                      type: "mrkdwn",
                      text: "📐 概算（金額未確定）— 実額確定後にMFカード明細と自動比較されます",
                    },
                  ],
                },
              ]
            : []),
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*行き先:*\n${destination}` },
              { type: "mrkdwn", text: `*日程:*\n${startDate} 〜 ${endDate}（${tripType}）` },
              { type: "mrkdwn", text: `*目的:*\n${purpose}` },
              { type: "mrkdwn", text: `*交通:*\n${transportService || ""} ${transport}` },
              { type: "mrkdwn", text: `*交通費:*\n¥${Number(transportAmount).toLocaleString()}` },
              ...(accommodationAmount && Number(accommodationAmount) > 0
                ? [
                    { type: "mrkdwn", text: `*宿泊:*\n${accommodationService || ""} ${accommodationPlace || ""}` },
                    { type: "mrkdwn", text: `*宿泊費:*\n¥${Number(accommodationAmount).toLocaleString()}` },
                  ]
                : []),
              { type: "mrkdwn", text: `*日当:*\n¥${dailyAllowance.toLocaleString()}` },
              { type: "mrkdwn", text: `*合計見込:*\n¥${totalEstimate.toLocaleString()}` },
              { type: "mrkdwn", text: `*申請番号:*\n${tripPoNumber}` },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `申請者: <@${applicantSlackId}>（${dept}） / 申請日: ${new Date().toLocaleDateString("ja-JP")} / 承認者: ${approverSlackId ? `<@${approverSlackId}>` : "未設定"}`,
              },
            ],
          },
        ];
        const result = await client.chat.postMessage({
          channel: SLACK_TRIP_CHANNEL,
          text: `✈️ 出張予約完了: ${destination}（${applicantName}）`,
          blocks,
        });
        slackTs = result.ts || "";

        // slackMessageTsをDBに保存
        if (slackTs) {
          await db
            .update(purchaseRequests)
            .set({ slackMessageTs: slackTs, slackChannelId: SLACK_TRIP_CHANNEL })
            .where(eq(purchaseRequests.poNumber, tripPoNumber));

          // 承認DM送信（購買と同じフロー）
          if (approverSlackId) {
            try {
              const info: RequestInfo = {
                poNumber: tripPoNumber,
                itemName: itemName,
                amount: `¥${tripTotal.toLocaleString()}`,
                applicant: applicantName,
                department: dept,
                supplierName: supplierName ?? "",
                paymentMethod: "会社カード",
                applicantSlackId,
                approverSlackId,
                inspectorSlackId: "",
              };
              await sendApprovalDM(client, info, SLACK_TRIP_CHANNEL, slackTs);
            } catch (e) {
              console.error("[trip-submit] sendApprovalDM failed:", e);
              await notifyOps(
                client,
                `⚠️ 出張予約完了の承認DM送信に失敗 (${tripPoNumber}): ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }
      } catch (e) {
        console.error("[trip-submit] Slack post failed:", e);
        // Slack失敗でも申請は成功扱い
        try {
          const client = getSlackClient();
          await notifyOps(
            client,
            `⚠️ 出張予約完了のSlack通知に失敗 (${tripPoNumber}): ${e instanceof Error ? e.message : String(e)}`,
          );
        } catch {
          /* ignore */
        }
      }
    }

    await invalidateRecentRequests();

    return NextResponse.json({
      ok: true,
      poNumber: tripPoNumber,
      dailyAllowance,
      totalEstimate,
      ...(slackTs ? {} : { warning: "Slack通知に失敗しましたが、申請は保存されました" }),
    });
  } catch (e) {
    console.error("[trip-submit] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

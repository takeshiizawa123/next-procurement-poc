import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackSignature } from "@/lib/slack-signature";
import {
  getSlackClient,
  actionHandlers,
  handlePoTestCommand,
  handlePurchaseCommand,
  handleReturnSubmit,
  parsePurchaseFormValues,
  buildNewRequestBlocks,
  buildPurchasedRequestBlocks,
  sendApprovalDM,
  notifyOps,
  calcPaymentDueDate,
  sendAmountDiffApproval,
  type PurchaseFormData,
  type RequestInfo,
  savePurchaseDraft,
  loadPurchaseDraft,
  clearPurchaseDraft,
} from "@/lib/slack";
import { registerPurchase, updateStatus, getStatus, getRecentRequests, getEmployees, checkSlackEventProcessed } from "@/lib/gas-client";
import { resolveApprovalRoute } from "@/lib/approval-router";
import { createTripExpense } from "@/lib/mf-expense";
import { generateTripPredictions } from "@/lib/prediction";
import { extractFromImage, matchAmount, downloadSlackFile, verifyInvoiceRegistration } from "@/lib/ocr";

// Vercel Serverless の最大実行時間（証憑処理: OCR+Drive+仕訳で時間がかかる）
export const maxDuration = 60;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

/**
 * Slack Events / Interactive Messages / Slash Commands の統一エンドポイント
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    // Slack署名検証（url_verification 以外）
    const slackTimestamp = request.headers.get("x-slack-request-timestamp") || "";
    const slackSignature = request.headers.get("x-slack-signature") || "";

    // url_verification はパース後に判定するため、署名検証を先にペイロード確認
    // ただし署名が存在する場合は必ず検証する
    if (!SIGNING_SECRET) {
      console.error("[slack] SLACK_SIGNING_SECRET is not configured — rejecting request");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }
    if (!slackSignature || !verifySlackSignature(body, slackTimestamp, slackSignature, SIGNING_SECRET)) {
      console.warn("[slack] signature verification failed — missing or invalid signature");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    // Content-Type に応じてペイロードをパース
    const contentType = request.headers.get("content-type") || "";
    let payload: Record<string, unknown>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      if (params.has("payload")) {
        payload = JSON.parse(params.get("payload")!);
      } else {
        payload = Object.fromEntries(params.entries());
      }
    } else {
      payload = JSON.parse(body);
    }

    // URL Verification
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // 冪等性チェック: Slackリトライで重複処理を防止
    const deliveryId = request.headers.get("x-slack-retry-num")
      ? `${request.headers.get("x-slack-unique-id") || slackTimestamp}-retry${request.headers.get("x-slack-retry-num")}`
      : null;
    // Interactive messages / view submissions はaction_idやview_idで冪等性確保
    const interactionId = (payload.type === "block_actions" || payload.type === "view_submission")
      ? (payload as Record<string, unknown>).trigger_id as string || null
      : null;
    const idempotencyKey = deliveryId || interactionId;
    if (idempotencyKey) {
      const eventType = (payload.type as string) || (payload.command as string) || "unknown";
      const alreadyProcessed = await checkSlackEventProcessed(idempotencyKey, eventType);
      if (alreadyProcessed) {
        console.log(`[slack] Duplicate event skipped: ${idempotencyKey}`);
        return new NextResponse("", { status: 200 });
      }
    }

    // Slash Commands — 同期的に処理してレスポンスを返す
    if (typeof payload.command === "string") {
      const command = payload.command as string;
      const channelId = payload.channel_id as string;
      const userId = payload.user_id as string;

      if (command === "/po-test") {
        try {
          const client = getSlackClient();
          await handlePoTestCommand(client, channelId, userId);
          return new NextResponse("", { status: 200 });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return NextResponse.json({
            response_type: "ephemeral",
            text: `Error: ${msg}`,
          });
        }
      }

      if (command === "/purchase") {
        const triggerId = payload.trigger_id as string;
        if (!triggerId) {
          return NextResponse.json({
            response_type: "ephemeral",
            text: "Error: trigger_id が取得できませんでした",
          });
        }
        try {
          const client = getSlackClient();
          const result = await handlePurchaseCommand(client, triggerId, channelId, userId);
          // chooser の場合はエフェメラルを投稿済みなので空レスポンス
          // modal の場合も views.open 済みなので空レスポンス
          return new NextResponse(result === "chooser" ? "" : "", { status: 200 });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return NextResponse.json({
            response_type: "ephemeral",
            text: `Error: ${msg}`,
          });
        }
      }

      if (command === "/trip") {
        const triggerId = payload.trigger_id as string;
        if (!triggerId) {
          return NextResponse.json({
            response_type: "ephemeral",
            text: "Error: trigger_id が取得できませんでした",
          });
        }
        try {
          const client = getSlackClient();
          await client.views.open({
            trigger_id: triggerId,
            view: buildTripModal(channelId),
          });
          return new NextResponse("", { status: 200 });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return NextResponse.json({
            response_type: "ephemeral",
            text: `Error: ${msg}`,
          });
        }
      }

      if (command === "/mystatus") {
        try {
          const client = getSlackClient();
          const reqResult = await getRecentRequests(undefined, 50);
          const all = reqResult.success ? (reqResult.data?.requests || []) : [];
          // ユーザーの申請のみ抽出
          const mine = all.filter((r) => r.applicant.includes(userId));
          const active = mine.filter((r) =>
            r.approvalStatus === "承認待ち" ||
            (r.approvalStatus === "承認済" && r.orderStatus === "未発注") ||
            (r.orderStatus === "発注済" && r.inspectionStatus === "未検収") ||
            (r.inspectionStatus === "検収済" && r.voucherStatus === "要取得")
          );

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
          const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
          const myPageUrl = `${baseUrl}/purchase/my?user_id=${userId}`;

          if (active.length === 0) {
            return NextResponse.json({
              response_type: "ephemeral",
              text: `✅ 未対応の申請はありません。\n<${myPageUrl}|マイページを開く>`,
            });
          }

          const lines = [`📋 *あなたの未対応案件（${active.length}件）*\n`];
          for (const r of active.slice(0, 10)) {
            let status = "";
            let action = "";
            if (r.approvalStatus === "承認待ち") {
              status = "⏳承認待ち"; action = "部門長の承認を待っています";
            } else if (r.orderStatus === "未発注") {
              status = "🛒発注未完了"; action = "[発注完了] ボタンを押してください";
            } else if (r.inspectionStatus === "未検収") {
              status = "📦検収待ち"; action = "届いたら [検収完了] を押してください";
            } else if (r.voucherStatus === "要取得") {
              status = "📎証憑待ち"; action = "スレッドに証憑を添付してください";
            }
            const link = r.slackLink ? ` <${r.slackLink}|開く>` : "";
            lines.push(`• ${r.prNumber}: ${r.itemName} — ${status}${link}`);
            if (action) lines.push(`  → ${action}`);
          }
          if (active.length > 10) lines.push(`…他 ${active.length - 10}件`);
          lines.push(`\n<${myPageUrl}|マイページで全件確認>`);

          return NextResponse.json({
            response_type: "ephemeral",
            text: lines.join("\n"),
          });
        } catch (error) {
          console.error("[mystatus] Error:", error);
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
          const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
          return NextResponse.json({
            response_type: "ephemeral",
            text: `⚠️ ステータスの取得に失敗しました。しばらくしてから再度お試しください。\n<${baseUrl}/purchase/my?user_id=${userId}|マイページで確認>`,
          });
        }
      }

      // /ask — 対話型AIアシスタント
      if (command === "/ask") {
        const appUrl = process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL || "localhost:3000";
        const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
        const query = (typeof payload.text === "string" ? payload.text : "").trim();
        if (!query) {
          return NextResponse.json({
            response_type: "ephemeral",
            text: "質問を入力してください。\n例: `/ask 過去にモニター買った？` `/ask Amazon先月いくら？` `/ask 消耗品費の上位は？`",
          });
        }

        // 非同期でAI応答を生成（3秒以内にSlackに200を返す必要がある）
        after(async () => {
          const slackClient = getSlackClient();
          try {
            const res = await fetch(`${baseUrl}/api/ai/ask`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.CRON_SECRET || ""}`,
              },
              body: JSON.stringify({ query, userId }),
            });
            const data = await res.json();
            const answer = data.answer || "回答を生成できませんでした。";

            await slackClient.chat.postMessage({
              channel: userId,
              text: `🤖 *AIアシスタント*\n\n> ${query}\n\n${answer}`,
            });
          } catch (e) {
            console.error("[/ask] Error:", e);
            await slackClient.chat.postMessage({
              channel: userId,
              text: `⚠️ AIアシスタントでエラーが発生しました: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        });

        return NextResponse.json({
          response_type: "ephemeral",
          text: "🤖 考え中... DMで回答をお送りします。",
        });
      }

      return NextResponse.json({
        response_type: "ephemeral",
        text: `Unknown command: ${command}`,
      });
    }

    // モーダル送信（view_submission）
    if (payload.type === "view_submission") {
      const view = payload.view as {
        callback_id: string;
        private_metadata: string;
        state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
      };

      if (view.callback_id === "purchase_submit") {
        const userId = (payload.user as { id: string }).id;
        const userName = (payload.user as { name?: string; username?: string }).name
          || (payload.user as { username?: string }).username
          || userId;
        const formData = parsePurchaseFormValues(view.state.values);
        const targetChannelId = view.private_metadata || PURCHASE_CHANNEL;

        // 購入理由バリデーション（モーダル内エラー表示）
        const hasReference = !!(formData.katanaPo || formData.hubspotDealId || formData.budgetNumber);
        if (!hasReference && !formData.notes) {
          // バリデーションエラー時に下書き保存（次回モーダル起動時に復元）
          after(async () => { await savePurchaseDraft(userId, formData as unknown as Record<string, unknown>); });
          return NextResponse.json({
            response_action: "errors",
            errors: {
              notes: "PO番号・HubSpot案件番号・実行予算番号のいずれもない場合は購入理由を入力してください",
            },
          });
        }

        // 申請成功 → 下書きクリア（バックグラウンド）
        after(async () => { await clearPurchaseDraft(userId); });

        // モーダルを即座に閉じる（3秒制限対策）
        // バックグラウンドで後続処理
        after(async () => {
          await handlePurchaseSubmission(userId, userName, formData, targetChannelId);
        });

        return NextResponse.json({ response_action: "clear" });
      }

      if (view.callback_id === "partial_inspection_submit") {
        const userId = (payload.user as { id: string }).id;
        const actionValue = view.private_metadata;
        const inspectedQty = parseInt(
          view.state.values.inspected_qty_block?.inspected_qty?.value || "0",
          10,
        );
        const note = (view.state.values.inspection_note_block?.inspection_note as { value?: string })?.value || "";

        after(async () => {
          await handlePartialInspectionSubmit(userId, actionValue, inspectedQty, note);
        });

        return NextResponse.json({ response_action: "clear" });
      }

      if (view.callback_id === "return_submit") {
        const userId = (payload.user as { id: string }).id;
        const userName = (payload.user as { name?: string; username?: string }).name
          || (payload.user as { username?: string }).username
          || userId;

        after(async () => {
          const client = getSlackClient();
          await handleReturnSubmit(client, view, userId, userName);
        });

        return NextResponse.json({ response_action: "clear" });
      }

      if (view.callback_id === "trip_submit") {
        const userId = (payload.user as { id: string }).id;
        const targetChannelId = view.private_metadata || TRIP_CHANNEL;
        const vals = view.state.values;

        after(async () => {
          await handleTripSubmission(userId, vals, targetChannelId);
        });

        return NextResponse.json({ response_action: "clear" });
      }

      return NextResponse.json({ response_action: "clear" });
    }

    // Events API（file_shared等）
    if (payload.type === "event_callback") {
      const event = payload.event as { type: string; file_id?: string; channel_id?: string; channel?: string; thread_ts?: string; files?: Array<{ id: string }>; ts?: string; subtype?: string };
      const eventChannel = event.channel_id || event.channel || "";

      // ファイル添付検知: スレッド内メッセージのファイル、または file_shared イベント
      const isFileShare = event.thread_ts && (
        (event.type === "message" && event.subtype === "file_share") ||
        (event.type === "message" && event.files && event.files.length > 0) ||
        (event.type === "file_shared" && event.file_id)
      );

      if (isFileShare) {
        console.log(`[slack] file_share detected: channel=${eventChannel} thread=${event.thread_ts}`);
        after(async () => {
          try {
            await handleFileSharedInThread(eventChannel, event.thread_ts || "", event.ts || "");
          } catch (e) {
            console.error("[slack] file_share handler error:", e);
          }
        });
      }
      return new NextResponse("", { status: 200 });
    }

    // Interactive Messages（ボタン）
    if (payload.type === "block_actions") {
      try {
        await handleBlockActions(payload);
      } catch (error) {
        console.error("[slack] block_actions error:", error);
      }
      return new NextResponse("", { status: 200 });
    }

    return new NextResponse("", { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[slack] fatal error:", msg);
    return NextResponse.json({ error: msg }, { status: 200 });
  }
}

// --- 出張申請 ---

const TRIP_CHANNEL = process.env.SLACK_TRIP_CHANNEL || "";

/** /trip コマンド用モーダル定義 */
function buildTripModal(channelId: string) {
  return {
    type: "modal" as const,
    callback_id: "trip_submit",
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "出張申請" },
    submit: { type: "plain_text" as const, text: "申請する" },
    close: { type: "plain_text" as const, text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "destination_block",
        label: { type: "plain_text", text: "行き先" },
        element: {
          type: "plain_text_input",
          action_id: "destination",
          placeholder: { type: "plain_text", text: "例: 大阪本社" },
        },
      },
      {
        type: "input",
        block_id: "start_date_block",
        label: { type: "plain_text", text: "出張開始日" },
        element: { type: "datepicker", action_id: "start_date" },
      },
      {
        type: "input",
        block_id: "end_date_block",
        label: { type: "plain_text", text: "出張終了日" },
        element: { type: "datepicker", action_id: "end_date" },
      },
      {
        type: "input",
        block_id: "purpose_block",
        label: { type: "plain_text", text: "出張目的" },
        element: {
          type: "plain_text_input",
          action_id: "purpose",
          multiline: true,
          placeholder: { type: "plain_text", text: "例: クライアントとの打合せ" },
        },
      },
      {
        type: "input",
        block_id: "transport_block",
        label: { type: "plain_text", text: "利用交通手段・便名" },
        element: {
          type: "plain_text_input",
          action_id: "transport",
          placeholder: { type: "plain_text", text: "例: 新幹線のぞみ 東京→新大阪 / レンタカー / タイムズカー" },
        },
      },
      {
        type: "input",
        block_id: "amount_block",
        label: { type: "plain_text", text: "概算額（円）" },
        element: {
          type: "number_input",
          action_id: "amount",
          is_decimal_allowed: false,
          min_value: "1",
          placeholder: { type: "plain_text", text: "例: 45000" },
        },
      },
      // 概算チェックボックス
      {
        type: "input",
        block_id: "trip_estimate_block",
        label: { type: "plain_text", text: "金額の確度" },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: "trip_estimate_check",
          options: [
            {
              text: { type: "plain_text" as const, text: "📐 概算（金額未確定）" },
              value: "estimate",
              description: { type: "plain_text" as const, text: "実額確定後にMFカード明細と自動比較されます" },
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "accommodation_block",
        label: { type: "plain_text", text: "宿泊先（該当する場合）" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "accommodation",
          placeholder: { type: "plain_text", text: "例: じゃらんで予約済み / ホテル名" },
        },
      },
      {
        type: "input",
        block_id: "hubspot_block",
        label: { type: "plain_text", text: "HubSpot案件番号" },
        hint: { type: "plain_text", text: "案件に紐づく出張の場合に入力" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "hubspot_deal_id",
          placeholder: { type: "plain_text", text: "例: 12345678" },
        },
      },
    ],
  };
}

/** 部分検収モーダル送信の処理 */
async function handlePartialInspectionSubmit(
  userId: string,
  actionValue: string,
  inspectedQty: number,
  note: string,
): Promise<void> {
  const client = getSlackClient();
  const parts = actionValue.split("|");
  const poNumber = parts[0] || "";

  // ユーザー名取得
  let userName = userId;
  try {
    const info = await client.users.info({ user: userId });
    userName = info.user?.real_name || info.user?.name || userId;
  } catch {
    // ignore
  }

  // GASから現在のステータスを取得して検収数量を確認
  const statusResult = await getStatus(poNumber);
  const statusData = statusResult.success ? statusResult.data : null;
  const totalQty = Number(statusData?.["数量"] || statusData?.["quantity"] || 1);
  const prevInspected = Number(statusData?.["検収済数量"] || 0);
  const newInspected = prevInspected + inspectedQty;
  const isComplete = newInspected >= totalQty;

  // GASに検収数量を更新
  const todayStr = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  const updates: Record<string, string> = {
    "検収済数量": String(newInspected),
  };
  if (isComplete) {
    updates["検収ステータス"] = "検収済";
    updates["検収日"] = todayStr;
  } else {
    updates["検収ステータス"] = `部分検収（${newInspected}/${totalQty}）`;
  }
  updateStatus(poNumber, updates).catch((e) =>
    console.error("[partial-inspection] GAS update error:", e)
  );

  // スレッドにメッセージを確認する必要がある — チャンネルIDを探す
  const slackTs = String(statusData?.["スレッドTS"] || statusData?.["slackTs"] || "");
  const channelId = process.env.SLACK_PURCHASE_CHANNEL || "";

  if (channelId) {
    const noteText = note ? `（${note}）` : "";
    const progressBar = `${"█".repeat(Math.min(10, Math.round((newInspected / totalQty) * 10)))}${"░".repeat(Math.max(0, 10 - Math.round((newInspected / totalQty) * 10)))}`;

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: slackTs || undefined,
      text: [
        `📦 *部分検収* ${poNumber}（${userName}）`,
        `  今回: ${inspectedQty}個 → 累計: ${newInspected}/${totalQty}個 ${progressBar}${noteText}`,
        ...(isComplete
          ? [`  ✅ *全数検収完了* — 証憑を添付してください。`]
          : [`  ⏳ 残り ${totalQty - newInspected}個`]),
      ].join("\n"),
    });
  }

  if (isComplete) {
    // 全数に到達 → OPS通知
    const { notifyOps: ops } = await import("@/lib/slack");
    await ops(client, `📦 *検収完了*（部分検収→全数到達） ${poNumber}（${userName}）— 証憑待ち`);

    // 固定資産通知
    const rawAmount = parts[4] || "0";
    const amount = parseInt(rawAmount, 10);
    if (amount >= 100000) {
      await ops(
        client,
        [
          `🏷️ *固定資産登録が必要です*`,
          `  申請番号: ${poNumber}`,
          `  取得価額: ¥${amount.toLocaleString()}`,
          `  取得日: ${todayStr}`,
          `  → MF固定資産に登録してください`,
        ].join("\n"),
      );
    }
  }
}

/** 出張申請の送信処理 */
async function handleTripSubmission(
  userId: string,
  vals: Record<string, Record<string, { value?: string; selected_date?: string }>>,
  targetChannelId: string,
): Promise<void> {
  const client = getSlackClient();

  const destination = vals.destination_block?.destination?.value || "";
  const startDate = vals.start_date_block?.start_date?.selected_date || "";
  const endDate = vals.end_date_block?.end_date?.selected_date || "";
  const purpose = vals.purpose_block?.purpose?.value || "";
  const transport = vals.transport_block?.transport?.value || "";
  const amount = parseInt(vals.amount_block?.amount?.value || "0", 10);
  const accommodation = vals.accommodation_block?.accommodation?.value || "";
  const hubspotDealId = vals.hubspot_block?.hubspot_deal_id?.value || "";

  // 概算チェックボックスの解析
  const tripEstimateBlock = vals.trip_estimate_block?.trip_estimate_check;
  const tripSelectedOptions = (tripEstimateBlock as unknown as { selected_options?: { value: string }[] })?.selected_options || [];
  const isTripEstimate = tripSelectedOptions.some((o: { value: string }) => o.value === "estimate");

  // バリデーション
  const tripErrors: string[] = [];
  if (!destination) tripErrors.push("行き先が未入力です");
  if (!startDate) tripErrors.push("出張開始日が未選択です");
  if (!endDate) tripErrors.push("出張終了日が未選択です");
  if (!purpose) tripErrors.push("出張目的が未入力です");
  if (!transport) tripErrors.push("利用交通手段が未入力です");
  if (amount <= 0 || isNaN(amount)) tripErrors.push("概算額は1円以上を入力してください");
  if (startDate && endDate && startDate > endDate) {
    tripErrors.push("出張開始日は終了日以前にしてください");
  }

  if (tripErrors.length > 0) {
    await client.chat.postMessage({
      channel: userId,
      text: `⚠️ 出張申請にエラーがあります:\n${tripErrors.map((e) => `• ${e}`).join("\n")}`,
    });
    return;
  }

  // ユーザー名取得
  let userName = userId;
  try {
    const info = await client.users.info({ user: userId });
    userName = info.user?.real_name || info.user?.name || userId;
  } catch {
    // ignore
  }

  // 部門取得（従業員マスタから）
  let department = "";
  try {
    const empResult = await getEmployees();
    if (empResult.success && empResult.data?.employees) {
      const emp = empResult.data.employees.find(
        (e) => e.slackId === userId || e.name === userName,
      );
      if (emp) {
        department = emp.departmentName;
        if (!userName || userName === userId) userName = emp.name;
      }
    }
  } catch {
    // ignore
  }

  // 泊数計算
  const start = new Date(startDate);
  const end = new Date(endDate);
  const nights = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  const tripType = nights > 0 ? `${nights}泊${nights + 1}日` : "日帰り";

  // 日当計算（宿泊3,000円/日、日帰り1,000円）
  const DAILY_ALLOWANCE_OVERNIGHT = 3000;
  const DAILY_ALLOWANCE_DAY_TRIP = 1000;
  const dailyAllowance = nights > 0
    ? DAILY_ALLOWANCE_OVERNIGHT * (nights + 1)
    : DAILY_ALLOWANCE_DAY_TRIP;
  const totalEstimate = amount + dailyAllowance;

  // #出張チャンネルに投稿
  const channelId = targetChannelId || TRIP_CHANNEL;
  if (!channelId) {
    await client.chat.postMessage({
      channel: userId,
      text: "⚠️ 出張チャンネルが設定されていません。管理者に連絡してください。",
    });
    return;
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `✈️ 出張申請 — ${userName}` },
    },
    ...(isTripEstimate
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: "📐 概算（金額未確定）— 実額確定後にMFカード明細と自動比較されます" }] }]
      : []),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*行き先:* ${destination}` },
        { type: "mrkdwn", text: `*日程:* ${startDate} 〜 ${endDate}（${tripType}）` },
        { type: "mrkdwn", text: `*目的:* ${purpose}` },
        { type: "mrkdwn", text: `*交通:* ${transport}` },
        { type: "mrkdwn", text: `*概算額:* ¥${amount.toLocaleString()}${isTripEstimate ? "（概算）" : ""}` },
        { type: "mrkdwn", text: `*日当:* ¥${dailyAllowance.toLocaleString()}（${nights > 0 ? `¥${DAILY_ALLOWANCE_OVERNIGHT.toLocaleString()}×${nights + 1}日` : "日帰り"}）` },
        { type: "mrkdwn", text: `*合計見込:* ¥${totalEstimate.toLocaleString()}` },
        { type: "mrkdwn", text: `*申請者:* <@${userId}>${department ? `（${department}）` : ""}` },
      ],
    },
    ...(accommodation
      ? [{ type: "section", text: { type: "mrkdwn", text: `*宿泊:* ${accommodation}` } }]
      : []),
    ...(hubspotDealId
      ? [{ type: "section", text: { type: "mrkdwn", text: `*HubSpot案件:* ${hubspotDealId}` } }]
      : []),
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `申請日: ${new Date().toLocaleDateString("ja-JP")}` },
      ],
    },
  ];

  await client.chat.postMessage({
    channel: channelId,
    blocks,
    text: `出張申請: ${destination} ${startDate}〜${endDate} ¥${amount.toLocaleString()} (${userName})`,
  });

  // MF経費に経費明細作成（トークンが設定されている場合のみ）
  let mfExpenseId = "";
  if (process.env.MF_EXPENSE_ACCESS_TOKEN) {
    try {
      const result = await createTripExpense({
        amount,
        date: startDate,
        destination,
        purpose,
        transport,
      });
      mfExpenseId = result.id;
      console.log("[trip] MF Expense created:", result.id);
    } catch (e) {
      console.error("[trip] MF Expense error:", e);
    }
  }

  // 申請者にDM
  await client.chat.postMessage({
    channel: userId,
    text: [
      `✈️ 出張申請を受け付けました`,
      `行き先: ${destination}（${startDate} 〜 ${endDate}）`,
      `概算額: ¥${amount.toLocaleString()} + 日当 ¥${dailyAllowance.toLocaleString()} = 合計見込 ¥${totalEstimate.toLocaleString()}`,
      ...(mfExpenseId ? [`MF経費ID: ${mfExpenseId}`] : []),
      "",
      `交通費の精算は、出張後にMFビジネスカードの明細が反映されたら自動処理されます。`,
      `宿泊費はじゃらんCSV取込で処理されます。`,
      `日当は給与と合わせて支給されます。`,
    ].join("\n"),
  });

  // カード予測レコード生成（交通費・宿泊費。日当はカード決済でないため除外）
  // 概算額を交通費として扱い、宿泊費は accommodation テキストから金額を抽出（なければ0）
  const accommodationAmount = accommodation
    ? parseInt(accommodation.replace(/[^\d]/g, ""), 10) || 0
    : 0;
  const transportAmount = amount - accommodationAmount; // 概算額から宿泊費を差し引いた残り

  generateTripPredictions({
    applicantSlackId: userId,
    applicantName: userName,
    transportAmount: transportAmount > 0 ? transportAmount : amount,
    accommodationAmount,
    startDate,
    checkInDate: startDate, // チェックイン日は出発日と同じとする
    destination,
    isEstimate: isTripEstimate,
  }).catch((e) => console.error("[trip] Prediction generation error:", e));

  console.log("[trip] Submission complete:", { userId, destination, startDate, endDate, amount });
}

// --- 購買申請 submit ハンドラー ---

const PURCHASE_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";

// 暫定承認者（従業員マスタ実装まで環境変数で指定）
const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";

async function handlePurchaseSubmission(
  userId: string,
  userName: string,
  formData: PurchaseFormData,
  targetChannelId: string
): Promise<void> {
  console.log("[purchase] formData:", {
    requestType: formData.requestType,
    itemName: formData.itemName,
    amount: formData.amount,
    quantity: formData.quantity,
    paymentMethod: formData.paymentMethod,
    supplierName: formData.supplierName,
    katanaPo: formData.katanaPo || "(empty)",
    hubspotDealId: formData.hubspotDealId || "(empty)",
    budgetNumber: formData.budgetNumber || "(empty)",
    notes: formData.notes ? `${formData.notes.slice(0, 50)}...` : "(empty)",
    isEstimate: formData.isEstimate,
    assetUsage: formData.assetUsage || "(empty)",
  });
  try {
    const client = getSlackClient();

    const totalAmount = formData.amount * (formData.quantity || 1);
    const amount = (formData.quantity || 1) > 1
      ? `¥${totalAmount.toLocaleString()}（単価¥${formData.amount.toLocaleString()} × ${formData.quantity}）`
      : `¥${totalAmount.toLocaleString()}`;

    // 承認ルート解決（従業員マスタから部門長を取得）
    const approvalRoute = await resolveApprovalRoute(userName, userId, totalAmount);
    const department = approvalRoute.employee?.departmentName || "";
    const approverSlackId = approvalRoute.primaryApprover || DEFAULT_APPROVER;

    // #purchase-request にメッセージ投稿
    const channelId = targetChannelId || PURCHASE_CHANNEL;
    if (!channelId) {
      console.error("[purchase] SLACK_PURCHASE_CHANNEL is not set");
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ 購買申請の投稿先チャンネルが設定されていません。管理者に連絡してください。\n申請内容: ${formData.itemName} ${amount}`,
      });
      return;
    }

    const isPurchased = formData.requestType === "購入済";
    const isPostReport = formData.requestType === "緊急事後報告";
    const isEstimate = formData.isEstimate;

    // 事後報告のバリデーション: 緊急理由が必須
    if (isPostReport && !formData.emergencyReason) {
      const client = getSlackClient();
      await client.chat.postMessage({
        channel: userId,
        text: "⚠️ 緊急事後報告の場合は「緊急理由」の入力が必須です。再度申請してください。",
      });
      return;
    }

    // GAS登録を先に行い、GAS発番のPO番号を取得
    let poNumber = "";
    try {
      const gasResult = await registerPurchase({
        applicant: userName,
        itemName: formData.itemName,
        totalAmount: totalAmount,
        unitPrice: formData.amount,
        quantity: formData.quantity || 1,
        purchaseSource: formData.supplierName,
        paymentMethod: formData.paymentMethod,
        accountTitle: "",
        isPurchased: isPurchased || isPostReport,
        budgetNumber: formData.budgetNumber || undefined,
        katanaPo: formData.katanaPo || undefined,
        hubspotInfo: formData.hubspotDealId || undefined,
        remarks: formData.notes || undefined,
        purpose: formData.assetUsage || undefined,
      });
      if (gasResult.success && gasResult.data?.prNumber) {
        poNumber = gasResult.data.prNumber;
        console.log("[purchase] GAS registered:", gasResult.data);
      } else {
        console.error("[purchase] GAS register failed:", gasResult.error);
      }
    } catch (gasError) {
      console.error("[purchase] GAS register error:", gasError);
    }

    // GAS発番失敗時のフォールバック（ローカル発番）
    if (!poNumber) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
      poNumber = `PO-${yyyymm}-${seq}`;
      console.warn("[purchase] Falling back to local PO number:", poNumber);
    }

    const requestInfo: RequestInfo = {
      poNumber,
      itemName: formData.itemName,
      amount,
      unitPrice: formData.amount,
      applicant: `<@${userId}>`,
      department,
      supplierName: formData.supplierName,
      paymentMethod: formData.paymentMethod,
      applicantSlackId: userId,
      approverSlackId: isPurchased ? "" : approverSlackId,
      inspectorSlackId: formData.inspectorSlackId || userId,
      paymentDueDate: formData.paymentMethod.includes("前払い")
        ? new Date().toISOString().slice(0, 10)
        : formData.paymentMethod.includes("請求書") ? calcPaymentDueDate() : undefined,
    };

    // 購入済・事後報告 → 承認・発注スキップ、即「検収済・証憑待ち」（事後報告は事後承認へ）
    // 購入前 → 通常の承認フロー
    const blocks = (isPurchased || isPostReport)
      ? buildPurchasedRequestBlocks(requestInfo)
      : buildNewRequestBlocks(requestInfo);

    // 概算・事後報告のバッジをブロックに挿入
    const badges: string[] = [];
    if (isEstimate) badges.push("📐 概算（金額未確定）");
    if (isPostReport) badges.push("🚨 緊急事後報告");
    if (badges.length > 0) {
      blocks.splice(1, 0, {
        type: "context" as const,
        elements: [{ type: "mrkdwn" as const, text: badges.join("　") }],
      });
    }
    if (isPostReport && formData.emergencyReason) {
      blocks.splice(badges.length > 0 ? 2 : 1, 0, {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*🚨 緊急理由:* ${formData.emergencyReason}` },
      });
    }
    if (isPostReport && formData.purchaseDate) {
      blocks.splice(badges.length > 0 ? 3 : 1, 0, {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*📅 購入日:* ${formData.purchaseDate}` },
      });
    }

    const mentionText = !(isPurchased || isPostReport) && approverSlackId
      ? ` — 承認者: <@${approverSlackId}>`
      : "";
    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `購買申請: ${poNumber} ${formData.itemName} ${amount}${mentionText}`,
    });

    // Slack投稿後にGASのスレッドTS情報を更新
    if (result.ts) {
      try {
        await updateStatus(poNumber, { "スレッドTS": result.ts });
      } catch (e) {
        console.error("[purchase] Failed to update GAS with Slack TS:", e);
      }
    }

    // 承認者メンションをスレッドに投稿
    if (!isPurchased && approverSlackId && result.ts) {
      const approverMention = `<@${approverSlackId}>`;
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: result.ts,
        text: `📋 承認依頼: ${approverMention}`,
      });
    }

    console.log("[purchase] Posted to channel:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
      isPurchased,
      approver: approverSlackId,
    });

    if (isPostReport) {
      // 緊急事後報告: 証憑催促 + 事後承認依頼
      if (result.ts) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: result.ts,
          text: [
            `🚨 緊急事後報告を受け付けました（${userName}）`,
            `緊急理由: ${formData.emergencyReason}`,
            ...(formData.purchaseDate ? [`購入日: ${formData.purchaseDate}`] : []),
            `📎 納品書・領収書をこのスレッドに添付してください。`,
            `⏸️ 事後承認が必要です。`,
          ].join("\n"),
        });
      }
      // 事後承認依頼を承認者にDM
      if (approverSlackId && result.ts) {
        try {
          await client.chat.postMessage({
            channel: approverSlackId,
            text: [
              `🚨 *緊急事後報告の承認依頼* ${poNumber}`,
              `申請者: <@${userId}>`,
              `品目: ${formData.itemName} ${amount}`,
              `緊急理由: ${formData.emergencyReason}`,
              `<https://slack.com/archives/${channelId}/p${(result.ts || "").replace(".", "")}|詳細を確認>`,
            ].join("\n"),
          });
        } catch (dmError) {
          console.error("[purchase] Failed to send post-report approval DM:", dmError);
        }
      }
      await notifyOps(client, `🚨 *緊急事後報告* ${poNumber} — ${formData.itemName} ${amount}（<@${userId}>）— 事後承認待ち`);
    } else if (isPurchased) {
      // 購入済: スレッドに証憑催促を投稿
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
      // ops通知
      await notifyOps(client, `📦 *購入済申請* ${poNumber} — ${formData.itemName} ${amount}（<@${userId}>）— 証憑待ち`);
    } else {
      // 購入前: 承認者にDM送信
      if (approverSlackId && result.ts) {
        try {
          await sendApprovalDM(client, requestInfo, channelId, result.ts);
          console.log("[purchase] Sent approval DM to:", approverSlackId);
        } catch (dmError) {
          console.error("[purchase] Failed to send approval DM:", dmError);
        }
      }
      // ops通知
      await notifyOps(client, `🔵 *新規申請* ${poNumber} — ${formData.itemName} ${amount}（<@${userId}>）— 承認待ち`);
    }

  } catch (error) {
    console.error("[purchase] submission error:", error);
    try {
      const client = getSlackClient();
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ 購買申請の処理中にエラーが発生しました。再度お試しください。\nエラー: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      console.error("[purchase] Failed to send error DM");
    }
  }
}

// --- 証憑添付自動検知 ---

/** 証憑として受け付けるMIMEタイプ */
const VOUCHER_MIME_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "画像(JPEG)",
  "image/png": "画像(PNG)",
  "image/heic": "画像(HEIC)",
  "image/webp": "画像(WebP)",
  "image/tiff": "画像(TIFF)",
};

/** ファイル名から証憑種別を推定 */
function classifyVoucher(fileName: string): string {
  const n = fileName.toLowerCase();
  if (/receipt|領収/.test(n)) return "領収書";
  if (/invoice|請求/.test(n)) return "請求書";
  if (/delivery|納品/.test(n)) return "納品書";
  if (/quotation|見積/.test(n)) return "見積書";
  return "その他証憑";
}

/**
 * スレッド内のファイル添付を検知し、購買申請の証憑として処理
 */
async function handleFileSharedInThread(channelId: string, threadTs: string, eventTs: string) {
  const client = getSlackClient();

  // 添付されたメッセージを取得（ファイル情報含む）
  let fileNames: string[] = [];
  let fileMimeTypes: string[] = [];
  let fileUrls: string[] = [];
  try {
    const replies = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      latest: eventTs,
      inclusive: true,
      limit: 1,
    });
    const msg = replies.messages?.find((m) => m.ts === eventTs);
    const files = (msg?.files || []) as Array<{ name?: string; mimetype?: string; url_private?: string }>;
    fileNames = files.map((f) => f.name || "");
    fileMimeTypes = files.map((f) => f.mimetype || "");
    fileUrls = files.map((f) => f.url_private || "");
  } catch (repliesErr) {
    console.error(`[file-share] conversations.replies failed:`, repliesErr);
  }

  // 証憑として有効なファイルがあるか検証
  const validFiles = fileMimeTypes.filter((m) => m in VOUCHER_MIME_TYPES);
  if (fileMimeTypes.length > 0 && validFiles.length === 0) {
    const accepted = Object.values(VOUCHER_MIME_TYPES).join("、");
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `⚠️ 添付ファイルは証憑として認識できませんでした。対応形式: ${accepted}`,
    });
    return;
  }

  // 親メッセージを取得してPO番号を抽出
  let parentText = "";
  let actualThreadTs = threadTs;
  try {
    const result = await client.conversations.history({
      channel: channelId,
      latest: threadTs,
      inclusive: true,
      limit: 1,
    });
    const parentMsg = result.messages?.[0];
    parentText = (parentMsg?.text || "") + " " +
      JSON.stringify(parentMsg?.blocks || []);

    // PO番号が見つからない場合、Bot投稿のサブスレッドの可能性
    // → 元のメインメッセージ（スレッドルート）を探索
    const poCheck = parentText.match(/(?:PO-\d{6}-\d{4}|PR-\d{6}-\d{1,4})/);
    if (!poCheck && parentMsg?.thread_ts && parentMsg.thread_ts !== threadTs) {
      actualThreadTs = parentMsg.thread_ts;
      const rootResult = await client.conversations.history({
        channel: channelId,
        latest: actualThreadTs,
        inclusive: true,
        limit: 1,
      });
      parentText = (rootResult.messages?.[0]?.text || "") + " " +
        JSON.stringify(rootResult.messages?.[0]?.blocks || []);
    }
  } catch (histErr) {
    console.error(`[file-share] conversations.history failed:`, histErr);
    return;
  }

  // PO番号を抽出（GAS発番形式 PR-YYYYMM-NNNN にも対応）
  const poMatch = parentText.match(/(?:PO-\d{6}-\d{4}|PR-\d{6}-\d{1,4})/);
  if (!poMatch) return;

  const prNumber = poMatch[0];

  // 証憑種別の推定
  const voucherType = fileNames.length > 0 ? classifyVoucher(fileNames[0]) : "その他証憑";
  const fileFormat = fileMimeTypes.length > 0 ? (VOUCHER_MIME_TYPES[fileMimeTypes[0]] || "不明") : "";

  console.log(`[file-share] ${prNumber} / ${voucherType} (${fileFormat})`);

  // GASでステータスを「添付済」に更新
  try {
    const gasResult = await updateStatus(prNumber, {
      "証憑対応": "添付済",
    });
    if (gasResult.success) {
      const confirmLines = [
        `📎 証憑を確認しました（${prNumber}）`,
        `種別: ${voucherType} / 形式: ${fileFormat}`,
      ];

      // 購買申請データを取得（OCR照合 + 証憑分岐で使用）
      const { getStatus } = await import("@/lib/gas-client");
      const statusResult = await getStatus(prNumber);

      // OCR結果（仕訳作成時に使用: 税率・金額・取引先）
      let detectedTaxRate: number | undefined;
      let ocrAmount: number | undefined;  // OCR読取の税込金額（証憑が正）
      let pendingReapproval = false;  // 再承認待ちなら仕訳作成を保留
      let verifiedSupplierName: string | undefined;  // 国税API確定の正式法人名

      // OCR金額照合（Gemini APIキーがあり、画像/PDFの場合）
      if (process.env.GEMINI_API_KEY && fileUrls.length > 0 && (fileMimeTypes[0]?.startsWith("image/") || fileMimeTypes[0] === "application/pdf")) {
        try {
          const botToken = process.env.SLACK_BOT_TOKEN || "";
          const { base64, mimeType } = await downloadSlackFile(fileUrls[0], botToken);
          const ocrResult = await extractFromImage(base64, mimeType);
          // OCR詳細ログ削除（正常動作確認済み）
          detectedTaxRate = ocrResult.tax_rate ?? undefined;
          if (ocrResult.amount > 0) ocrAmount = ocrResult.amount;

          // GASは税抜金額で保存。OCRは税込金額を返す
          // 税率変換によるズレを回避するため、税抜同士で直接比較
          let requestedAmount = 0;
          if (statusResult.success && statusResult.data) {
            const dataObj = statusResult.data as Record<string, unknown>;
            const requestedExclTax = Number(dataObj["合計額（税抜）"] || 0);
            const taxRate = ocrResult.tax_rate ?? 10;
            // OCR税抜金額（subtotalがあればそのまま使用、なければ税込から逆算）
            const ocrExclTax = ocrResult.subtotal ?? Math.round(ocrResult.amount / (1 + taxRate / 100));
            // 税抜同士で比較してから、matchAmount用に税込を計算
            requestedAmount = Math.round(requestedExclTax * (1 + taxRate / 100));
            if (requestedExclTax > 0 && ocrResult.amount > 0) {
              // 税抜同士の差が小さければ一致とみなす（税率変換ズレ対策）
              const exclDiff = Math.abs(ocrExclTax - requestedExclTax);
              const exclPct = requestedExclTax > 0 ? exclDiff / requestedExclTax : 0;
              if (exclDiff <= 1000 || exclPct <= 0.03) {
                // 税抜ベースで一致 → 税込変換のズレは無視
                requestedAmount = ocrResult.amount;
              }
              const match = matchAmount(ocrResult, requestedAmount);
              confirmLines.push(`金額照合: ${match.message}`);
              if (!match.isMatched) {
                if (match.requiresReapproval) {
                  // 20%超 & ¥1,000超 → 承認者に再承認ボタン送信、仕訳は保留
                  pendingReapproval = true;
                  const approver = String(dataObj["approverSlackId"] || "");
                  confirmLines.push(`🔄 金額差異が大きいため、承認者に再承認を依頼しました（仕訳は承認後に作成）`);
                  const ocrSubtotal = ocrResult.subtotal ?? Math.round(ocrResult.amount / (1 + (ocrResult.tax_rate ?? 10) / 100));
                  await sendAmountDiffApproval(
                    client, channelId, actualThreadTs, prNumber,
                    ocrResult.amount, requestedAmount, match.difference,
                    approver, ocrSubtotal,
                  );
                  await notifyOps(client, `🔄 *金額差異再承認* ${prNumber} — ${match.message}（承認者: <@${approver}>、仕訳保留）`);
                } else {
                  confirmLines.push(`⚠️ 管理本部に確認を依頼しました`);
                  await notifyOps(client, `⚠️ *金額不一致* ${prNumber} — ${match.message}`);
                }
              }
            }
          }

          // 税率情報の表示
          if (ocrResult.tax_rate != null) {
            const taxInfo = ocrResult.tax_amount
              ? `税率${ocrResult.tax_rate}%（税額 ¥${ocrResult.tax_amount.toLocaleString()}）`
              : `税率${ocrResult.tax_rate}%`;
            confirmLines.push(`消費税: ${taxInfo}`);
          }

          // 複数税率混在の警告
          if (ocrResult.has_mixed_tax_rates && ocrResult.tax_breakdown) {
            const breakdown = ocrResult.tax_breakdown
              .map((b) => `${b.rate}% ¥${b.subtotal.toLocaleString()}（税¥${b.tax.toLocaleString()}）`)
              .join(" + ");
            confirmLines.push(`⚠️ *複数税率混在*: ${breakdown}`);
            confirmLines.push("※仕訳は主税率で登録されます。軽減税率分を別仕訳する場合は管理本部で手動対応が必要です。");
            // OPSにも通知
            try {
              await notifyOps(
                client,
                `⚠️ *複数税率混在の証憑* ${prNumber}\n${breakdown}\n仕訳を分割するか確認してください（現状は主税率のみで仕訳）`,
              );
            } catch { /* 無視 */ }
          }

          // OCR結果をGASに保存（カラム名に合わせてマッピング）
          const ocrUpdates: Record<string, string> = {};
          // 証憑金額（OCR読み取り税込金額）
          if (ocrResult.amount > 0) {
            ocrUpdates["証憑金額"] = String(ocrResult.amount);
          }
          // 税区分
          if (ocrResult.tax_rate != null) {
            ocrUpdates["税区分"] = `課税${ocrResult.tax_rate}%`;
          }
          // 金額照合結果 + 証憑ベースで合計額上書き
          if (statusResult.success && statusResult.data) {
            const reqAmt = requestedAmount;
            if (reqAmt > 0 && ocrResult.amount > 0) {
              const diff = ocrResult.amount - reqAmt;
              const match = matchAmount(ocrResult, reqAmt);
              ocrUpdates["金額照合"] = diff === 0 ? "一致" : `不一致（差額${diff > 0 ? "+" : ""}¥${diff.toLocaleString()}）`;
              // 一致 or 許容範囲内 → 証憑金額で合計額を上書き（再承認要は承認後に上書き）
              if (match.isMatched && ocrResult.amount > 0) {
                const ocrSubtotal = ocrResult.subtotal ?? Math.round(ocrResult.amount / (1 + (ocrResult.tax_rate ?? 10) / 100));
                ocrUpdates["合計額（税抜）"] = String(ocrSubtotal);
              }
            }
          }

          // 適格請求書の検証 + GAS保存
          if (ocrResult.registration_number) {
            const verification = await verifyInvoiceRegistration(ocrResult.registration_number);
            ocrUpdates["適格番号"] = ocrResult.registration_number;
            if (verification.valid) {
              verifiedSupplierName = verification.name;
              ocrUpdates["MF取引先"] = verification.name || "";
              confirmLines.push(`適格請求書: ${verification.registrationNumber}（${verification.name}）`);
            } else {
              confirmLines.push(`⚠️ 適格請求書: ${verification.registrationNumber} — ${verification.error}`);
              ocrUpdates["適格番号"] = `${ocrResult.registration_number}（検証失敗）`;
              const { getTransitionalDeductionRate } = await import("@/lib/ocr");
              const deduction = getTransitionalDeductionRate();
              confirmLines.push(`💰 ${deduction.message}`);
              await notifyOps(client,
                `⚠️ *適格請求書検証失敗* ${prNumber} — ${verification.registrationNumber}: ${verification.error}\n` +
                `💰 *${deduction.message}*（仕入税額控除 ${deduction.rate}%）`);
            }
          } else if (ocrResult.document_type === "invoice") {
            confirmLines.push(`⚠️ 登録番号なし（適格請求書でない可能性）`);
            ocrUpdates["適格番号"] = "番号なし";
            const { getTransitionalDeductionRate } = await import("@/lib/ocr");
            const deduction = getTransitionalDeductionRate();
            confirmLines.push(`💰 ${deduction.message}`);
            await notifyOps(client,
              `⚠️ *登録番号なし* ${prNumber} — 請求書に適格請求書の登録番号が見当たりません\n` +
              `💰 *${deduction.message}*（仕入税額控除 ${deduction.rate}%）`);
          }
          // OCR結果をGASスプレッドシートに保存
          if (Object.keys(ocrUpdates).length > 0) {
            try {
              await updateStatus(prNumber, ocrUpdates);
            } catch (e) {
              console.error(`[file-share] GAS OCR update error for ${prNumber}:`, e);
            }
          }
        } catch (ocrErr) {
          console.error(`[file-share] OCR error for ${prNumber}:`, ocrErr);
          // OCR失敗は証憑検知自体には影響しない
        }
      }

      // 支払方法で証憑転送先を分岐
      const paymentMethod = String((statusResult?.data as Record<string, unknown>)?.["支払方法"] || "");
      const statusData = statusResult?.data as Record<string, unknown> | undefined;
      const isEmployeeExpense = paymentMethod.includes("立替");

      // 勘定科目が未設定の場合、RAG推定を実行してGAS保存（全支払方法共通）
      let estimatedAccount = String(statusData?.["勘定科目"] || "");
      if (!estimatedAccount && statusData) {
        try {
          const { estimateAccountFromHistory } = await import("@/lib/account-estimator");
          const itemName = String(statusData["品目名"] || "");
          const supplierForRag = String(statusData["購入先"] || "");
          const department = String(statusData["部門"] || "");
          const totalAmt = Number(statusData["合計額（税込）"] || statusData["合計額（税抜）"] || 0);
          const ocrItems = statusData["証憑品名"] ? String(statusData["証憑品名"]) : undefined;
          const ragResult = await estimateAccountFromHistory(
            ocrItems || itemName,
            verifiedSupplierName || supplierForRag,
            ocrAmount || totalAmt,
            department || undefined,
            detectedTaxRate ? `課税仕入${detectedTaxRate}%` : undefined,
            Number(statusData["単価"] || 0) || undefined,
          );
          estimatedAccount = ragResult.account;
          console.log(`[file-share] RAG estimation for ${prNumber}: ${estimatedAccount} (${ragResult.confidence})`);
          await updateStatus(prNumber, { "勘定科目": estimatedAccount });
        } catch (ragErr) {
          console.warn(`[file-share] RAG estimation failed for ${prNumber}:`, ragErr);
          estimatedAccount = "消耗品費";
        }
      }

      if (isEmployeeExpense) {
        // 従業員立替 → MF経費に証憑転送
        if (process.env.MF_EXPENSE_ACCESS_TOKEN && fileUrls.length > 0) {
          try {
            const botToken = process.env.SLACK_BOT_TOKEN || "";
            const { uploadReceiptToMfExpense } = await import("@/lib/mf-expense");
            const fileRes = await fetch(fileUrls[0], {
              headers: { Authorization: `Bearer ${botToken}` },
              signal: AbortSignal.timeout(15000),
            });
            if (fileRes.ok) {
              const buf = Buffer.from(await fileRes.arrayBuffer());
              const mfResult = await uploadReceiptToMfExpense(buf, fileNames[0] || "receipt.pdf", fileMimeTypes[0] || "application/pdf");
              confirmLines.push(`MF経費に証憑を転送しました。MF経費で経費申請の提出をお願いします。`);
              console.log(`[file-share] MF Expense uploaded: ${prNumber}`, mfResult);
            }
          } catch (mfErr) {
            console.error(`[file-share] MF Expense upload error for ${prNumber}:`, mfErr);
          }
        }
        confirmLines.push(`📋 MF経費で経費申請の提出をお忘れなく。それ以外の作業は完了です。`);
      } else {
        // MFカード・請求書払い → Google Drive + MF会計Plus API仕訳
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY && fileUrls.length > 0) {
          try {
            const botToken = process.env.SLACK_BOT_TOKEN || "";
            const fileRes = await fetch(fileUrls[0], {
              headers: { Authorization: `Bearer ${botToken}` },
              signal: AbortSignal.timeout(15000),
            });
            if (fileRes.ok) {
              const buf = Buffer.from(await fileRes.arrayBuffer());
              // 仕訳日 = 検収日（原則）→ 取引日 → 本日のフォールバック
              const txDate = String(statusData?.["検収日"] || statusData?.["申請日"] || new Date().toISOString().slice(0, 10));
              const txAmountExclTax = Number(statusData?.["合計額（税抜）"] || 0);
              // 発注データは税抜なので税込に換算（仕訳は税込ベース）
              const txAmount = txAmountExclTax > 0
                ? Math.round(txAmountExclTax * (1 + (detectedTaxRate ?? 10) / 100))
                : 0;
              const supplier = String(statusData?.["購入先"] || "不明");

              // Google Driveにアップロード
              const { uploadVoucherToDrive } = await import("@/lib/google-drive");
              const driveResult = await uploadVoucherToDrive({
                fileBuffer: buf,
                mimeType: fileMimeTypes[0] || "application/pdf",
                transactionDate: txDate,
                amount: txAmount,
                supplierName: supplier,
                poNumber: prNumber,
                docType: voucherType,
                originalFileName: fileNames[0] || "receipt.pdf",
              });
              confirmLines.push(`Google Driveに証憑を保存しました: ${driveResult.fileName}`);
              console.log(`[file-share] Drive uploaded: ${prNumber}`, driveResult);

              // MF会計Plus仕訳を作成（証憑金額優先、再承認待ちは保留）
              // 仕訳金額: OCR証憑金額（税込）があればそちらを正とする。なければ発注データにフォールバック
              const journalAmount = ocrAmount || txAmount;
              if (pendingReapproval) {
                // 再承認待ち → 仕訳は承認後に作成（handleAmountDiffApproveで処理）
                confirmLines.push(`⏸️ 仕訳登録は金額差異の再承認後に自動作成されます`);
                console.log(`[file-share] Journal deferred (pending reapproval): ${prNumber}`);
              } else if (process.env.MF_OAUTH_CLIENT_ID && journalAmount > 0) {
                try {
                  const { buildJournalFromPurchase, createJournal } = await import("@/lib/mf-accounting");
                  // 勘定科目は分岐前のRAG推定で確定済み
                  const accountTitle = estimatedAccount || "消耗品費";
                  const department = String(statusData?.["部門"] || "");
                  const itemName = String(statusData?.["品目名"] || "");
                  const katanaPo = String(statusData?.["PO番号"] || "");
                  const budgetNum = String(statusData?.["予算番号"] || "");
                  const hubspotDealId = String(statusData?.["HubSpot/案件名"] || "");
                  // 取引先: 国税API確定名 > 発注データの購入先
                  const journalSupplier = verifiedSupplierName || supplier;
                  // 適格請求書判��
                  const qualifiedNum = String(statusData?.["適格番号"] || "");
                  const isQualifiedInvoice = qualifiedNum.startsWith("T") && qualifiedNum.length > 1;
                  const journalReq = await buildJournalFromPurchase({
                    transactionDate: txDate,
                    accountTitle,
                    amount: journalAmount,
                    paymentMethod,
                    supplierName: journalSupplier,
                    department: department || undefined,
                    poNumber: prNumber,
                    memo: `証憑: ${driveResult.webViewLink}`,
                    ocrTaxRate: detectedTaxRate,
                    itemName: itemName || undefined,
                    katanaPo: katanaPo || undefined,
                    budgetNumber: budgetNum || undefined,
                    hubspotDealId: hubspotDealId || undefined,
                    isQualifiedInvoice,
                  });
                  const journalRes = await createJournal(journalReq);
                  const amountSource = ocrAmount ? "証憑" : "発注";
                  confirmLines.push(`MF会計Plusに仕訳を登録しました（ID: ${journalRes.id}、金額: ${amountSource}ベース ¥${journalAmount.toLocaleString()}）`);
                  console.log(`[file-share] Journal created: ${prNumber} (amount source: ${amountSource}, ¥${journalAmount})`, journalRes);

                  // GASにStage 1仕訳IDを記録
                  await updateStatus(prNumber, {
                    "仕訳ID": String(journalRes.id),
                    "Stage": "1",
                  });
                } catch (journalErr) {
                  console.error(`[file-share] Journal create error for ${prNumber}:`, journalErr);
                  confirmLines.push(`⚠️ 仕訳登録に失敗しました。経理に手動登録を依頼してください。`);
                }
              }
            }
          } catch (driveErr) {
            console.error(`[file-share] Drive upload error for ${prNumber}:`, driveErr);
            confirmLines.push(`⚠️ Drive保存に失敗しました。手動でアップロードしてください。`);
          }
        }
        confirmLines.push(`📋 証憑処理が完了しました。経理の仕訳承認をお待ちください。`);
      }
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: actualThreadTs,
        text: confirmLines.join("\n"),
      });
      await notifyOps(client, `📎 *証憑添付* ${prNumber} — ${voucherType} — 仕訳待ちに移行`);
      console.log(`[file-share] GAS updated: ${prNumber} → 添付済 (${voucherType})`);
    } else {
      // GAS更新レスポンスが success: false でも証憑検知は通知する
      console.warn(`[file-share] GAS returned success=false but proceeding with notification for ${prNumber}`);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: actualThreadTs,
        text: `📎 証憑を確認しました（${prNumber}）\n種別: ${voucherType} / 形式: ${fileFormat}\n⚠️ ステータス更新に問題がある可能性があります。管理本部に確認してください。`,
      });
    }
  } catch (e) {
    console.error(`[file-share] GAS update error for ${prNumber}:`, e);
    // GASエラーでも最低限の通知
    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: actualThreadTs,
        text: `📎 証憑ファイルを検知しました（${prNumber}）\n⚠️ 自動処理でエラーが発生しました。管理本部に確認してください。`,
      });
    } catch { /* Slack送信も失敗した場合は諦める */ }
  }
}

// --- Interactive Messages ハンドラー ---

async function handleBlockActions(
  payload: Record<string, unknown>
): Promise<void> {
  const client = getSlackClient();

  const user = payload.user as {
    id: string;
    name?: string;
    username?: string;
  };
  const actions = payload.actions as Array<{
    action_id: string;
    value: string;
  }>;
  const channel = payload.channel as { id: string };
  const message = payload.message as { ts: string; thread_ts?: string };

  if (!user || !actions || !channel || !message) {
    console.error("Invalid block_actions payload");
    return;
  }

  // thread_ts があればスレッドルートを使用（リプライ上のボタン押下時の分裂防止）
  const threadRootTs = message.thread_ts || message.ts;

  for (const action of actions) {
    const handler = actionHandlers[action.action_id];
    if (handler) {
      await handler({
        client,
        body: payload,
        userId: user.id,
        userName: user.name || user.username || user.id,
        channelId: channel.id,
        messageTs: threadRootTs,
        actionValue: action.value,
      });
    } else {
      console.warn(`Unknown action_id: ${action.action_id}`);
    }
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { updateStatus, getStatus } from "@/lib/gas-client";
import { estimateAccountFromHistory } from "@/lib/account-estimator";
import { requireApiKey } from "@/lib/api-auth";

const PURCHASE_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";

/**
 * 証憑アップロードAPI（Webマイページ用・APIキー認証）
 * POST /api/purchase/upload-voucher
 *
 * multipart/form-data:
 *   file: 証憑ファイル（PDF/画像）
 *   prNumber: 購買番号
 *   slackTs: SlackスレッドTS（任意。空ならGASから取得）
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const prNumber = (formData.get("prNumber") as string)?.trim() || "";
    let slackTs = (formData.get("slackTs") as string)?.trim() || "";
    const uploadType = (formData.get("type") as string)?.trim() || "voucher"; // "voucher" | "delivery_note"

    if (!file || !prNumber) {
      return NextResponse.json({ error: "file と prNumber は必須です" }, { status: 400 });
    }

    // ファイルサイズ制限（10MB）
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `ファイルサイズが上限（10MB）を超えています: ${(file.size / 1024 / 1024).toFixed(1)}MB` },
        { status: 400 },
      );
    }

    // MIMEタイプチェック
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp", "image/tiff"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: `非対応のファイル形式です: ${file.type}` }, { status: 400 });
    }

    // スレッドTSが未指定ならGASから取得
    if (!slackTs) {
      try {
        const statusResult = await getStatus(prNumber);
        const statusData = statusResult?.data as Record<string, unknown> | undefined;
        slackTs = String(statusData?.["スレッドTS"] || "");
      } catch { /* ignore */ }
    }

    if (!slackTs || !PURCHASE_CHANNEL) {
      return NextResponse.json(
        { error: "Slackスレッド情報が取得できません。管理者に連絡してください。" },
        { status: 400 },
      );
    }

    const client = getSlackClient();

    // Slackにファイルアップロード
    const buffer = Buffer.from(await file.arrayBuffer());
    const isDeliveryNote = uploadType === "delivery_note";
    await client.filesUploadV2({
      channel_id: PURCHASE_CHANNEL,
      thread_ts: slackTs,
      file: buffer,
      filename: file.name,
      initial_comment: isDeliveryNote
        ? `📄 Webから納品書が提出されました（${prNumber}）`
        : `📎 Webから証憑が提出されました（${prNumber}）`,
    });

    // GASステータス更新（納品書の場合は証憑対応を変えない）
    if (!isDeliveryNote) {
      await updateStatus(prNumber, { "証憑対応": "添付済" });
    }

    // 勘定科目が未設定の場合、RAG推定を実行してGAS保存
    try {
      const statusResult = await getStatus(prNumber);
      const statusData = statusResult?.data as Record<string, unknown> | undefined;
      const existingAccount = String(statusData?.["勘定科目"] || "");
      if (!existingAccount && statusData) {
        const itemName = String(statusData["品目名"] || "");
        const supplier = String(statusData["購入先"] || "");
        const department = String(statusData["部門"] || "");
        const totalAmt = Number(statusData["合計額（税込）"] || statusData["合計額（税抜）"] || 0);
        const ragResult = await estimateAccountFromHistory(
          itemName, supplier, totalAmt, department || undefined,
        );
        console.log(`[upload-voucher] RAG estimation for ${prNumber}: ${ragResult?.account} (${ragResult?.confidence})`);
        // RAG推定結果がnull/undefinedまたはaccountが空の場合はGAS保存をスキップ
        if (ragResult?.account) {
          await updateStatus(prNumber, { "勘定科目": ragResult.account });
        } else {
          console.warn(`[upload-voucher] RAG estimation returned empty for ${prNumber}, skipping GAS save`);
        }
      }
    } catch (ragErr) {
      console.warn(`[upload-voucher] RAG estimation failed for ${prNumber}:`, ragErr);
    }

    console.log("[upload-voucher] Uploaded:", { prNumber, channel: PURCHASE_CHANNEL, fileName: file.name });

    return NextResponse.json({ ok: true, prNumber });
  } catch (error) {
    console.error("[upload-voucher] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { updateStatus } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 証憑アップロードAPI（Webマイページ用・APIキー認証）
 * POST /api/purchase/upload-voucher
 *
 * multipart/form-data:
 *   file: 証憑ファイル（PDF/画像）
 *   prNumber: 購買番号
 *   slackLink: Slackスレッドリンク
 *
 * Slackスレッドにファイルを投稿し、GASステータスを更新する。
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const prNumber = (formData.get("prNumber") as string)?.trim() || "";
    const slackLink = (formData.get("slackLink") as string)?.trim() || "";

    if (!file || !prNumber) {
      return NextResponse.json({ error: "file と prNumber は必須です" }, { status: 400 });
    }

    // MIMEタイプチェック
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp", "image/tiff"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: `非対応のファイル形式です: ${file.type}` }, { status: 400 });
    }

    const client = getSlackClient();

    // slackLinkからチャンネルID + thread_tsを抽出
    const channelMatch = slackLink.match(/archives\/([A-Z0-9]+)\//);
    const tsMatch = slackLink.match(/\/p(\d+)$/);
    const channelId = channelMatch?.[1] || "";
    const threadTs = tsMatch ? tsMatch[1].slice(0, 10) + "." + tsMatch[1].slice(10) : "";

    if (!channelId || !threadTs) {
      return NextResponse.json({ error: "Slackリンクが無効です" }, { status: 400 });
    }

    // Slackにファイルアップロード
    const buffer = Buffer.from(await file.arrayBuffer());
    await client.filesUploadV2({
      channel_id: channelId,
      thread_ts: threadTs,
      file: buffer,
      filename: file.name,
      initial_comment: `📎 Webから証憑が提出されました（${prNumber}）`,
    });

    // GASステータス更新
    await updateStatus(prNumber, { "証憑対応": "添付済" });

    console.log("[upload-voucher] Uploaded:", { prNumber, channelId, fileName: file.name });

    return NextResponse.json({ ok: true, prNumber });
  } catch (error) {
    console.error("[upload-voucher] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

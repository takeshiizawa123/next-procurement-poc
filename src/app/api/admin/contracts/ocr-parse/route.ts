import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { extractContractFields } from "@/lib/contract-ocr";

/**
 * 契約書PDFからOCR抽出
 * POST /api/admin/contracts/ocr-parse
 *
 * Body: multipart/form-data with `file` field (PDF or image)
 * Returns: ContractOcrResult + fileBase64（後続のNotion保管用に保持）
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    // 簡易バリデーション
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "ファイルサイズは20MB以下にしてください" }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: `非対応ファイル形式: ${file.type}` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const extracted = await extractContractFields(base64, file.type);

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      extracted,
    });
  } catch (e) {
    console.error("[contracts/ocr-parse] Error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { parseJalanCsv, importAccommodationRecords } from "@/lib/mf-expense";
import * as iconv from "iconv-lite";

/**
 * じゃらんCSV取込API
 * POST /api/trip/import-csv
 *
 * Content-Type: multipart/form-data
 * Body: file (CSV), dry_run ("true" | "false")
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const dryRun = formData.get("dry_run") === "true";

    if (!file) {
      return NextResponse.json({ error: "CSVファイルが必要です" }, { status: 400 });
    }

    // CP932 (Shift-JIS) デコード
    const buffer = Buffer.from(await file.arrayBuffer());
    let csvText: string;

    // BOMまたはUTF-8の場合はそのまま、それ以外はCP932として処理
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      csvText = buffer.toString("utf-8");
    } else {
      try {
        csvText = iconv.decode(buffer, "CP932");
      } catch {
        csvText = buffer.toString("utf-8");
      }
    }

    const records = parseJalanCsv(csvText);
    if (records.length === 0) {
      return NextResponse.json({ error: "有効なレコードが見つかりません" }, { status: 400 });
    }

    const result = await importAccommodationRecords(records, dryRun);

    return NextResponse.json({
      ok: true,
      dryRun,
      totalRecords: records.length,
      imported: result.imported,
      errors: result.errors,
      records: dryRun ? records : undefined,
    });
  } catch (error) {
    console.error("[trip/import-csv] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

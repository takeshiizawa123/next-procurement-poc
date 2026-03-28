/**
 * Gemini Vision OCR — 証憑からの構造化データ抽出
 *
 * 参考: procureflow_agent_archive.md §2
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.0-flash";

// --- 型定義 ---

export interface OcrItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface OcrResult {
  document_type: "delivery_note" | "invoice" | "receipt" | "unknown";
  date: string;           // YYYY-MM-DD
  amount: number;         // 税込合計
  tax_rate?: number;      // 消費税率（10, 8, 0）
  tax_amount?: number;    // 消費税額
  subtotal?: number;      // 税抜金額
  vendor_name: string;
  items: OcrItem[];
  confidence: number;     // 0-1
  invoice_number?: string;
  is_qualified_invoice?: boolean;
  registration_number?: string; // T+13桁
}

export interface OcrMatchResult {
  ocrResult: OcrResult;
  requestedAmount: number;
  difference: number;
  isMatched: boolean;
  message: string;
}

// --- OCR実行 ---

const OCR_PROMPT = `この証憑画像から以下の情報をJSON形式で抽出してください。

{
  "document_type": "delivery_note" | "invoice" | "receipt" のいずれか,
  "date": "YYYY-MM-DD形式の日付",
  "amount": 税込合計金額（数値のみ）,
  "tax_rate": 消費税率（10 or 8 or 0。複数税率の場合は主たる税率）,
  "tax_amount": 消費税額（数値のみ。記載がなければ税率から算出）,
  "subtotal": 税抜金額（数値のみ。記載がなければ税込金額から逆算）,
  "vendor_name": "発行者/店舗名",
  "items": [{ "name": "品目名", "quantity": 数量, "unit_price": 税込単価 }],
  "confidence": 0から1の確信度,
  "invoice_number": "請求書番号（あれば）",
  "is_qualified_invoice": 適格請求書かどうか（true/false）,
  "registration_number": "T+13桁の登録番号（あれば）"
}

注意:
- 金額は税込で数値のみ（カンマや円記号は除去）
- 日付はYYYY-MM-DD形式に変換
- 品目が読み取れない場合はitems: []
- 確信度は読み取り品質に基づいて0-1で設定
- 適格請求書: 登録番号（T+13桁の数字）が記載されていればtrue
- 税率: 10%対象と8%（軽減税率）対象が混在する場合、金額が大きい方の税率を設定
- JSONのみ出力（説明文は不要）`;

/**
 * 画像/PDFからOCR解析を実行
 */
export async function extractFromImage(imageBase64: string, mimeType: string): Promise<OcrResult> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY が未設定です");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: OCR_PROMPT },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini APIから結果が返されませんでした");
  }

  let parsed: Partial<OcrResult>;
  try {
    parsed = JSON.parse(content) as Partial<OcrResult>;
  } catch (e) {
    console.error("[ocr] Failed to parse Gemini response:", e, "Raw:", content.substring(0, 500));
    return {
      document_type: "unknown" as const,
      date: "",
      amount: 0,
      vendor_name: "",
      items: [],
      confidence: 0,
    };
  }

  return {
    document_type: parsed.document_type || "unknown",
    date: parsed.date || "",
    amount: Number(parsed.amount) || 0,
    tax_rate: parsed.tax_rate != null ? Number(parsed.tax_rate) : undefined,
    tax_amount: parsed.tax_amount != null ? Number(parsed.tax_amount) : undefined,
    subtotal: parsed.subtotal != null ? Number(parsed.subtotal) : undefined,
    vendor_name: parsed.vendor_name || "",
    items: Array.isArray(parsed.items) ? parsed.items : [],
    confidence: Number(parsed.confidence) || 0,
    invoice_number: parsed.invoice_number,
    is_qualified_invoice: parsed.is_qualified_invoice,
    registration_number: parsed.registration_number,
  };
}

// --- 金額照合 ---

const AMOUNT_TOLERANCE = 500;       // ±500円
const AMOUNT_TOLERANCE_PCT = 0.05;  // ±5%

/**
 * OCR結果と申請金額を照合
 */
export function matchAmount(ocrResult: OcrResult, requestedAmount: number): OcrMatchResult {
  const diff = ocrResult.amount - requestedAmount;
  const absDiff = Math.abs(diff);
  const pctDiff = requestedAmount > 0 ? absDiff / requestedAmount : 1;

  const isMatched = absDiff <= AMOUNT_TOLERANCE || pctDiff <= AMOUNT_TOLERANCE_PCT;

  let message: string;
  if (absDiff === 0) {
    message = "金額一致";
  } else if (isMatched) {
    message = `金額一致（許容範囲内: ${diff > 0 ? "+" : ""}¥${diff.toLocaleString()}）`;
  } else {
    message = `金額不一致: 証憑¥${ocrResult.amount.toLocaleString()} / 申請¥${requestedAmount.toLocaleString()}（差額: ${diff > 0 ? "+" : ""}¥${diff.toLocaleString()}）`;
  }

  return {
    ocrResult,
    requestedAmount,
    difference: diff,
    isMatched,
    message,
  };
}

// --- 適格請求書発行事業者の検証（国税庁Web-API） ---

export interface InvoiceRegistrationResult {
  valid: boolean;
  registrationNumber: string;
  name?: string;
  address?: string;
  registrationDate?: string;
  error?: string;
}

/**
 * 国税庁Web-APIで適格請求書発行事業者の登録番号を検証
 * https://www.invoice-kohyo.nta.go.jp/web-api/index.html
 */
export async function verifyInvoiceRegistration(
  registrationNumber: string,
): Promise<InvoiceRegistrationResult> {
  // T+13桁の形式チェック
  const cleaned = registrationNumber.replace(/[- ]/g, "");
  if (!/^T\d{13}$/.test(cleaned)) {
    return {
      valid: false,
      registrationNumber: cleaned,
      error: "登録番号の形式が不正です（T+13桁の数字）",
    };
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const number = cleaned.slice(1); // T を除去
    const url = `https://web-api.invoice-kohyo.nta.go.jp/1/num?id=${number}&type=21&history=0`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        valid: false,
        registrationNumber: cleaned,
        error: `国税庁API応答エラー (${res.status})`,
      };
    }

    const data = await res.json() as {
      count: string;
      "lastUpdateDate": string;
      "announcement": Array<{
        registratedNumber: string;
        name: string;
        address: string;
        registrationDate: string;
        updateDate: string;
      }>;
    };

    if (!data.announcement || data.announcement.length === 0) {
      return {
        valid: false,
        registrationNumber: cleaned,
        error: "登録番号が見つかりません（未登録または取消済）",
      };
    }

    const record = data.announcement[0];
    return {
      valid: true,
      registrationNumber: cleaned,
      name: record.name,
      address: record.address,
      registrationDate: record.registrationDate,
    };
  } catch (e) {
    console.error("[ocr] Invoice registration verification error:", e);
    return {
      valid: false,
      registrationNumber: cleaned,
      error: `検証失敗: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Slackファイルをダウンロードしてbase64に変換
 */
export async function downloadSlackFile(
  fileUrl: string,
  botToken: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Slack file download failed (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";

  return {
    base64: buffer.toString("base64"),
    mimeType,
  };
}

/**
 * Gemini Vision OCR — 契約書からの構造化データ抽出
 *
 * ocr.ts の証憑OCRをベースに、契約書専用のプロンプトとスキーマで実装。
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3-flash-preview";

// --- 型定義 ---

export interface ContractOcrResult {
  /** 取引先名（契約相手方の法人名） */
  supplierName: string;
  /** カテゴリ推定 */
  category: "派遣" | "外注" | "SaaS" | "顧問" | "賃貸" | "保守" | "清掃" | "その他";
  /** 請求タイプ推定 */
  billingType: "固定" | "従量" | "カード自動";
  /** 月額（税込、円） */
  monthlyAmount: number | null;
  /** 年額（税込、円） */
  annualAmount: number | null;
  /** 契約開始日 YYYY-MM-DD */
  contractStartDate: string;
  /** 契約終了日 YYYY-MM-DD（無期限ならnull） */
  contractEndDate: string | null;
  /** 更新タイプ推定 */
  renewalType: "自動更新" | "都度更新" | "期間満了";
  /** 勘定科目推定（消耗品費/支払手数料/地代家賃/賃借料/外注費/業務委託費/顧問料等） */
  accountTitle: string;
  /** 信頼度 (0-1) */
  confidence: number;
  /** 特記事項の原文コピー（自動更新条項、解約条項等） */
  notes: string;
}

// --- プロンプト ---

const CONTRACT_OCR_PROMPT = `この契約書から以下の情報をJSON形式で抽出してください。
配列ではなく単一のオブジェクトで返してください。

{
  "supplierName": "取引先名（契約相手方の法人名、'株式会社○○' 形式）",
  "category": "派遣" | "外注" | "SaaS" | "顧問" | "賃貸" | "保守" | "清掃" | "その他" のいずれか,
  "billingType": "固定" | "従量" | "カード自動" のいずれか,
  "monthlyAmount": 月額（税込・円、数値のみ、なければnull）,
  "annualAmount": 年額（税込・円、数値のみ、なければnull）,
  "contractStartDate": "YYYY-MM-DD形式の契約開始日",
  "contractEndDate": "YYYY-MM-DD形式の契約終了日（無期限ならnull）",
  "renewalType": "自動更新" | "都度更新" | "期間満了" のいずれか,
  "accountTitle": "勘定科目名（消耗品費/支払手数料/地代家賃/賃借料/外注費/業務委託費/顧問料/保守料 等）",
  "confidence": 0から1の確信度,
  "notes": "自動更新条項、解約予告期間、中途解約条件など、重要な特記事項の原文抜粋（200文字以内）"
}

カテゴリ判定ガイド:
- SaaS: クラウドサービス、ソフトウェア利用料、AWS/GCPなど
- 派遣: 派遣社員受入契約、スタッフサービス契約
- 外注: 業務委託、請負、制作委託
- 顧問: 税理士/弁護士/社労士等の顧問契約、コンサル契約
- 賃貸: オフィス・倉庫・機器のリース
- 保守: 保守契約、メンテナンス契約
- 清掃: 清掃業務委託
- その他: 上記に当てはまらない役務提供

請求タイプ判定:
- 固定: 月額○○円・年額○○円など定額
- 従量: タイムシートベース・作業時間ベース・成果物ベース
- カード自動: クレジットカード自動引き落としが明記されている場合

金額抽出:
- 「月額○○円（税込）」が最優先。税抜の場合は税率（通常10%）を加算して税込額へ変換
- 月額の記載がなく年額のみなら annualAmount に入れ monthlyAmount は算出して設定（年額÷12）
- カンマ・円記号は除去
- 読み取れない場合は null

日付:
- 契約開始日: 「契約期間」「有効期間」欄の開始日
- 契約終了日: 期間満了日。自動更新の場合も初期期間の終了日を記載
- 「令和5年4月1日」→ "2023-04-01" に変換

勘定科目推定:
- SaaS → "支払手数料" or "通信費"
- 派遣 → "派遣料"
- 外注 → "外注費" or "業務委託費"
- 顧問 → "支払報酬料" or "顧問料"
- 賃貸 → "地代家賃" or "賃借料"
- 保守 → "修繕費" or "保守料"
- 清掃 → "清掃費" or "修繕費"

confidence:
- 全主要項目（取引先・月額・期間）が明確に読み取れた: 0.8-1.0
- 一部推定を含む: 0.5-0.8
- 多くが不明: 0-0.5

JSONのみ出力（説明文は不要）`;

// --- OCR実行 ---

/**
 * 契約書PDFまたは画像からOCR抽出
 */
export async function extractContractFields(
  fileBase64: string,
  mimeType: string,
): Promise<ContractOcrResult> {
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
            { text: CONTRACT_OCR_PROMPT },
            {
              inline_data: {
                mime_type: mimeType,
                data: fileBase64,
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
    signal: AbortSignal.timeout(60000), // 契約書は大きめなので60s
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error("Gemini APIから結果が返されませんでした");
  }

  let parsed: Partial<ContractOcrResult>;
  try {
    const raw = JSON.parse(content);
    parsed = (Array.isArray(raw) ? raw[0] : raw) as Partial<ContractOcrResult>;
  } catch (e) {
    console.error("[contract-ocr] Failed to parse:", e, "Raw:", content.substring(0, 500));
    // フォールバック: 空の結果を返す
    return {
      supplierName: "",
      category: "その他",
      billingType: "固定",
      monthlyAmount: null,
      annualAmount: null,
      contractStartDate: "",
      contractEndDate: null,
      renewalType: "自動更新",
      accountTitle: "支払手数料",
      confidence: 0,
      notes: "OCR解析失敗（フォーマット不明）",
    };
  }

  // 有効値の正規化
  const validCategories = ["派遣", "外注", "SaaS", "顧問", "賃貸", "保守", "清掃", "その他"];
  const validBillingTypes = ["固定", "従量", "カード自動"];
  const validRenewals = ["自動更新", "都度更新", "期間満了"];

  return {
    supplierName: parsed.supplierName || "",
    category: validCategories.includes(parsed.category as string)
      ? (parsed.category as ContractOcrResult["category"])
      : "その他",
    billingType: validBillingTypes.includes(parsed.billingType as string)
      ? (parsed.billingType as ContractOcrResult["billingType"])
      : "固定",
    monthlyAmount: parsed.monthlyAmount != null ? Number(parsed.monthlyAmount) : null,
    annualAmount: parsed.annualAmount != null ? Number(parsed.annualAmount) : null,
    contractStartDate: parsed.contractStartDate || "",
    contractEndDate: parsed.contractEndDate || null,
    renewalType: validRenewals.includes(parsed.renewalType as string)
      ? (parsed.renewalType as ContractOcrResult["renewalType"])
      : "自動更新",
    accountTitle: parsed.accountTitle || "支払手数料",
    confidence: Number(parsed.confidence) || 0,
    notes: (parsed.notes || "").slice(0, 500),
  };
}

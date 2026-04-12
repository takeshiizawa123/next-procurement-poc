/**
 * 勘定科目推定ロジック
 *
 * 品目名・購入先のキーワードマッチで勘定科目を推定する。
 * 優先順位: 品目名キーワード > 購入先 > 金額ベース
 */

interface EstimationRule {
  keywords: RegExp;
  account: string;
  subAccount?: string;
}

// 品目名ベースのルール（優先度高）
const ITEM_RULES: EstimationRule[] = [
  // IT機器・備品（10万円以上は固定資産）
  { keywords: /ノートPC|パソコン|PC|MacBook|ThinkPad|Surface/i, account: "工具器具備品" },
  { keywords: /モニター|ディスプレイ|液晶/i, account: "工具器具備品" },
  { keywords: /サーバー|サーバ|NAS/i, account: "工具器具備品" },
  { keywords: /プリンター|プリンタ|複合機/i, account: "工具器具備品" },
  { keywords: /タブレット|iPad/i, account: "工具器具備品" },
  { keywords: /キーボード|マウス|ヘッドセット|Webカメラ|USBハブ|充電器|ケーブル|アダプタ/i, account: "消耗品費", subAccount: "PC周辺機器" },

  // ソフトウェア・ライセンス
  { keywords: /ライセンス|サブスク|月額|年額|SaaS|クラウド/i, account: "支払手数料", subAccount: "ソフトウェア" },
  { keywords: /ソフトウェア|ソフト|Microsoft|Adobe|Office/i, account: "支払手数料", subAccount: "ソフトウェア" },

  // 事務用品
  { keywords: /コピー用紙|用紙|紙|封筒|ファイル|バインダー/i, account: "事務用品費" },
  { keywords: /ペン|ボールペン|マーカー|付箋|ノート|クリップ/i, account: "事務用品費" },
  { keywords: /トナー|インク|カートリッジ/i, account: "事務用品費" },
  { keywords: /切手|はがき|レターパック|郵便/i, account: "通信費" },

  // 電子部品・材料（製造系）
  { keywords: /基板|PCB|プリント基板/i, account: "材料費" },
  { keywords: /抵抗|コンデンサ|IC|半導体|ダイオード|トランジスタ/i, account: "材料費", subAccount: "電子部品" },
  { keywords: /センサー|センサ|モーター|モータ|アクチュエータ/i, account: "材料費", subAccount: "電子部品" },
  { keywords: /ケーブル|コネクタ|ハーネス|端子/i, account: "材料費" },
  { keywords: /ねじ|ボルト|ナット|ワッシャ|スペーサ/i, account: "材料費", subAccount: "機械部品" },
  { keywords: /3Dプリンタ.*フィラメント|フィラメント|レジン/i, account: "材料費" },

  // 工具
  { keywords: /工具|ドライバー|レンチ|ペンチ|ニッパー|はんだ/i, account: "消耗品費", subAccount: "工具" },
  { keywords: /テスター|オシロ|計測器|測定器/i, account: "工具器具備品" },

  // 書籍・研修
  { keywords: /書籍|本|技術書|参考書|雑誌/i, account: "新聞図書費" },
  { keywords: /研修|セミナー|講座|トレーニング/i, account: "研修費" },

  // 消耗品一般
  { keywords: /電池|バッテリー|乾電池/i, account: "消耗品費" },
  { keywords: /洗剤|ティッシュ|ペーパータオル|ゴミ袋|掃除/i, account: "消耗品費", subAccount: "衛生用品" },
  { keywords: /飲料|お茶|コーヒー|水|菓子/i, account: "福利厚生費" },
];

// 購入先ベースのデフォルトルール（品目名で判定できない場合のフォールバック）
const SUPPLIER_DEFAULTS: Record<string, string> = {
  "Amazon": "消耗品費",
  "モノタロウ": "消耗品費",
  "アスクル": "事務用品費",
  "ASKUL": "事務用品費",
  "ヨドバシ": "消耗品費",
  "ビックカメラ": "消耗品費",
  "チップワンストップ": "材料費",
  "DigiKey": "材料費",
  "Mouser": "材料費",
  "ミスミ": "材料費",
  "RSコンポーネンツ": "材料費",
  "マルツ": "材料費",
  "秋月電子": "材料費",
  "スイッチサイエンス": "材料費",
  "DELL": "工具器具備品",
  "Lenovo": "工具器具備品",
};

export interface AccountEstimation {
  account: string;
  subAccount: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * 勘定科目を推定
 */
export function estimateAccount(
  itemName: string,
  supplierName: string,
  totalAmount: number,
  unitPrice?: number,
): AccountEstimation {
  // 固定資産判定は単価ベース（会計基準: 取得価額は1単位あたり）
  const assetJudgeAmount = unitPrice ?? totalAmount;

  // 1. 品目名キーワードマッチ（優先）
  for (const rule of ITEM_RULES) {
    if (rule.keywords.test(itemName)) {
      let account = rule.account;
      let reason = `品目名「${itemName}」から推定`;

      // 単価10万円以上の工具器具備品は固定資産に格上げ
      if (account === "工具器具備品" && assetJudgeAmount >= 100000) {
        account = "工具器具備品（固定資産）";
      }
      // 単価10万円未満の工具器具備品は消耗品費に格下げ
      if (account === "工具器具備品" && assetJudgeAmount > 0 && assetJudgeAmount < 100000) {
        account = "消耗品費";
      }
      // 材料費の1万円基準: 1万円未満の材料系品目は消耗品費
      if (account === "材料費" && totalAmount > 0 && totalAmount < 10000) {
        account = "消耗品費";
        reason += `（1万円未満のため消耗品費）`;
      }

      return {
        account,
        subAccount: rule.subAccount || "",
        confidence: "high",
        reason,
      };
    }
  }

  // 2. 購入先デフォルト
  for (const [supplier, account] of Object.entries(SUPPLIER_DEFAULTS)) {
    if (supplierName.includes(supplier) || supplier.includes(supplierName)) {
      return {
        account,
        subAccount: "",
        confidence: "medium",
        reason: `購入先「${supplierName}」から推定`,
      };
    }
  }

  // 3. 金額ベースの推定（最低信頼度）— 単価ベース
  if (assetJudgeAmount >= 100000) {
    return {
      account: "工具器具備品（固定資産）",
      subAccount: "",
      confidence: "low",
      reason: "単価10万円以上のため固定資産の可能性",
    };
  }

  return {
    account: "消耗品費",
    subAccount: "",
    confidence: "low",
    reason: "デフォルト（品目名・購入先から判定不可）",
  };
}

// --- 過去仕訳ベースの推定 ---

import { getJournalStats, getGasAccounts, getGasTaxes, searchJournalRows } from "./gas-client";
import type { CounterpartyAccountStat, DeptAccountTaxStat, JournalRow, JournalRowsResult, GasAccount, GasTax } from "./gas-client";

/** 費用科目のみフィルタ（貸方科目の普通預金・未払金・売掛金等を除外） */
const BALANCE_SHEET_ACCOUNTS = new Set([
  "普通預金", "当座預金", "現金", "未払金", "買掛金", "売掛金",
  "前受金", "前払金", "預り金", "仮受金", "仮払金", "立替金",
  "受取手形", "支払手形", "短期借入金", "長期借入金",
  "資本金", "利益剰余金", "売上高",
]);

function isExpenseAccount(name: string): boolean {
  return !BALANCE_SHEET_ACCOUNTS.has(name);
}

// --- RAGベース推定（Claude API + 過去仕訳原票） ---

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

interface RagEstimation extends AccountEstimation {
  taxType?: string;
}

/**
 * 原票行をプロンプト用のテキスト行に変換
 */
function formatJournalRow(r: JournalRow): string {
  const amt = r.amount > 0 ? `¥${r.amount.toLocaleString()}` : "";
  return `  ${r.date} 「${r.remark}」→ ${r.account} (${r.taxType}) ${amt}${r.counterparty ? ` [${r.counterparty}]` : ""}`;
}

/**
 * 過去仕訳の原票＋部門統計からLLMコンテキストを構築
 */
function buildContext(
  journalRows: JournalRowsResult | null,
  deptStats: DeptAccountTaxStat[],
  supplierName: string,
  department?: string,
): string {
  const lines: string[] = [];

  // 取引先一致の過去仕訳（原票）
  if (journalRows?.supplierMatches && journalRows.supplierMatches.length > 0) {
    lines.push(`【取引先「${supplierName}」の過去仕訳（直近${journalRows.supplierMatches.length}件）】`);
    for (const r of journalRows.supplierMatches) {
      lines.push(formatJournalRow(r));
    }
  }

  // 類似品名の過去仕訳（原票）
  if (journalRows?.keywordMatches && journalRows.keywordMatches.length > 0) {
    lines.push(`【類似品名の過去仕訳（${journalRows.keywordMatches.length}件）】`);
    for (const r of journalRows.keywordMatches) {
      lines.push(formatJournalRow(r));
    }
  }

  // 部門の過去パターン（集計統計 — 傾向把握用に残す）
  if (department && deptStats.length > 0) {
    const filtered = deptStats
      .filter((s) => s.department === department && isExpenseAccount(s.account))
      .slice(0, 10);
    if (filtered.length > 0) {
      lines.push(`【部門「${department}」の過去仕訳傾向】`);
      for (const s of filtered) {
        lines.push(`  ${s.account} (${s.taxType}) — ${s.count}件`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Claude APIを呼び出して勘定科目・税区分を推定（RAG）
 * accountNames / taxNames は MF マスタから取得した正式名。AI はこの中からのみ選択する。
 */
async function callClaudeForEstimation(
  itemName: string,
  supplierName: string,
  totalAmount: number,
  department: string | undefined,
  context: string,
  accountNames: string[],
  taxNames: string[],
  ocrTaxCategory?: string,
  unitPrice?: number,
): Promise<RagEstimation | null> {
  if (!ANTHROPIC_API_KEY) return null;
  if (accountNames.length === 0) return null;

  const quantity = unitPrice && unitPrice > 0 ? Math.round(totalAmount / unitPrice) : 1;
  const unitPriceInfo = unitPrice
    ? `\n- 単価（税込）: ¥${unitPrice.toLocaleString()}（数量: ${quantity}）`
    : "";

  const prompt = `あなたは日本の企業の経理担当者です。購買データから最適な勘定科目と税区分を判定してください。

## 購買データ
- 品名: ${itemName || "（未入力）"}
- 取引先: ${supplierName || "（未入力）"}
- 金額（税込合計）: ¥${totalAmount.toLocaleString()}${unitPriceInfo}
- 部門: ${department || "（未入力）"}

## 判定の最重要ポイント
**品名の内容から「何を購入したか」を判断し、それに適した勘定科目を選んでください。**
取引先名（Amazonなど）は様々な品目を扱うため、取引先だけでは判断できません。
品名から購入物の性質を読み取ることが最も重要です。

## 会計基準（必須）
- **固定資産の判定は「単価（1個あたりの取得価額）」で行う**。複数個購入の場合、総額ではなく単価で判定すること
- 税抜単価10万円未満の有形物品（PC・機器含む）は固定資産に計上せず、消耗品費等の費用科目で即時費用処理する（少額減価償却資産の特例）
- 税抜単価10万円以上の有形物品のみ固定資産（工具器具備品等）に計上する
- **数量1の場合でも、品名から消耗品（ケーブル、文具、部品等）と判断できるなら消耗品費を選ぶこと。**金額が高くても品名の性質を優先する
${ocrTaxCategory ? `\n## 証憑から読み取った税区分（OCR）: ${ocrTaxCategory}\n※証憑の税区分は参考情報です。使用可能な税区分リストの中から最も近いものを選んでください。` : ""}

## 過去の仕訳実績（参考）
${context || "（過去データなし）"}
※以下は同一取引先・類似品名の過去仕訳の実例です。品名の類似性から科目を判断してください。
※取引先が汎用（Amazon等）の場合、取引先の傾向より品名の類似性を重視してください。
※部門別の傾向はその部門でよく使われる科目の参考です。

## 使用可能な勘定科目（この中から必ず1つ選んでください）
${accountNames.join("、")}

## 使用可能な税区分（この中から必ず1つ選んでください）
${taxNames.join("、")}

以下のJSON形式のみで回答してください（説明不要）:
{"account": "勘定科目名", "taxType": "税区分名", "confidence": "high|medium|low", "reason": "判定理由（30文字以内）"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn("[rag-estimator] Claude API error:", res.status, await res.text());
      return null;
    }

    const data = await res.json() as { content: { type: string; text: string }[] };
    const text = data.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      account: string;
      taxType?: string;
      confidence?: string;
      reason?: string;
    };

    return {
      account: parsed.account,
      subAccount: "",
      confidence: (parsed.confidence as "high" | "medium" | "low") || "medium",
      reason: `AI推定: ${parsed.reason || parsed.account}`,
      taxType: parsed.taxType,
    };
  } catch (e) {
    console.warn("[rag-estimator] Claude API call failed:", e);
    return null;
  }
}

/**
 * RAGベース勘定科目推定（メイン関数）
 *
 * 1. 過去仕訳原票を検索 + 統計・MFマスタを並列取得
 * 2. 原票ベースのコンテキストでClaude APIに推定依頼
 * 3. 失敗時は頻度ベース → ルールベースにフォールバック
 */
export async function estimateAccountFromHistory(
  itemName: string,
  supplierName: string,
  totalAmount: number,
  department?: string,
  ocrTaxCategory?: string,
  unitPrice?: number,
): Promise<RagEstimation> {
  // 過去仕訳原票検索 + 統計 + MFマスタを並列取得
  const [journalRows, stats, acctResult, taxResult] = await Promise.all([
    searchJournalRows(supplierName, itemName).catch(() => null),
    getJournalStats(),
    getGasAccounts().catch(() => null),
    getGasTaxes().catch(() => null),
  ]);

  const accounts = (acctResult?.success && acctResult.data?.accounts || []).filter((a: GasAccount) => a.available);
  const taxes = (taxResult?.success && taxResult.data?.taxes || []).filter((t: GasTax) => t.available);
  const accountNames = accounts.map((a: GasAccount) => a.name);
  const taxNames = taxes.map((t: GasTax) => t.name);

  // RAG推定を試行（原票 + 部門統計をコンテキストに）
  const deptStats = stats?.deptAccountTax || [];
  if (ANTHROPIC_API_KEY && accountNames.length > 0) {
    const context = buildContext(journalRows, deptStats, supplierName, department);
    const ragResult = await callClaudeForEstimation(
      itemName, supplierName, totalAmount, department, context,
      accountNames, taxNames, ocrTaxCategory, unitPrice,
    );
    if (ragResult) return ragResult;
  }

  // フォールバック: 頻度ベース推定（集計統計を使用）
  if (stats && supplierName) {
    const cpStats = stats.counterpartyAccounts.filter(
      (s: CounterpartyAccountStat) =>
        s.counterparty === supplierName && isExpenseAccount(s.account),
    );

    if (cpStats.length > 0) {
      const totalCount = cpStats.reduce((sum: number, s: CounterpartyAccountStat) => sum + s.count, 0);
      const top = cpStats[0];

      if (top.count >= 2 && top.count / totalCount >= 0.7) {
        return {
          account: top.account,
          subAccount: "",
          confidence: "high",
          reason: `過去仕訳: ${supplierName}→${top.account} ${top.count}/${totalCount}件`,
        };
      }

      if (top.count >= 2) {
        return {
          account: top.account,
          subAccount: "",
          confidence: "medium",
          reason: `過去仕訳: ${supplierName}→${top.account} ${top.count}/${totalCount}件（複数科目あり）`,
        };
      }
    }
  }

  // 最終フォールバック: ルールベース
  return estimateAccount(itemName, supplierName, totalAmount, unitPrice);
}

/**
 * 税区分の共通/課税接頭辞を過去仕訳データから推定
 *
 * @returns "共通" → "共通課税仕入" 系、"" → "課税仕入" 系
 */
export async function estimateTaxPrefix(
  department: string,
  account: string,
): Promise<"共通" | ""> {
  const stats = await getJournalStats();

  if (stats && department && account) {
    const deptStats = stats.deptAccountTax.filter(
      (s: DeptAccountTaxStat) => s.department === department && s.account === account,
    );

    if (deptStats.length > 0) {
      const top = deptStats[0];
      if (top.taxType.includes("共通")) {
        return "共通";
      }
      if (top.taxType.includes("課税仕入")) {
        return "";
      }
    }
  }

  // フォールバック: デフォルトは共通課税仕入
  return "共通";
}

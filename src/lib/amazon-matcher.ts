/**
 * Amazon ビジネス注文履歴CSV パーサー + 購買申請マッチングエンジン
 */

// --- 型定義 ---

export interface AmazonOrderLine {
  id: string;
  orderDate: string;       // YYYY-MM-DD
  orderNumber: string;
  productName: string;
  sellerName: string;
  buyerName: string;
  buyerEmail: string;
  lineTotal: number;       // 商品および配送料の合計（税込）
  orderTotal: number;      // 注文の合計（税込）
  quantity: number;
  invoiceRegNumber: string;
  invoiceIssuerName: string;
  cardLast4: string;
  paymentAmount: number;
  orderStatus: string;
  asin: string;
}

export interface PurchaseRequestForMatch {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  department: string;
  paymentMethod: string;
}

export interface AmazonConfidentMatch {
  order: AmazonOrderLine;
  request: PurchaseRequestForMatch;
  score: number;
  amountDiff: number;
}

export interface AmazonCandidateMatch {
  order: AmazonOrderLine;
  candidates: {
    request: PurchaseRequestForMatch;
    score: number;
    amountDiff: number;
  }[];
}

export interface AmazonMatchResult {
  matched: AmazonConfidentMatch[];
  candidates: AmazonCandidateMatch[];
  unmatchedOrders: AmazonOrderLine[];
  unmatchedRequests: PurchaseRequestForMatch[];
  summary: {
    totalOrders: number;
    totalRequests: number;
    matchedCount: number;
    candidateCount: number;
    unmatchedOrderCount: number;
    unmatchedRequestCount: number;
    matchRate: string;
  };
}

// --- ユーティリティ（card-matcher.tsから移植） ---

function daysDiff(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24)));
}

function normalizeText(s: string): string {
  return s
    .toUpperCase()
    .replace(/[\s.\-_,()（）「」【】]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
}

function fuzzyScore(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;
  const prefixLen = Math.min(na.length, nb.length, 6);
  if (na.slice(0, prefixLen) === nb.slice(0, prefixLen)) return 70;
  const bigramsA = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  let overlap = 0;
  let totalB = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    totalB++;
    if (bigramsA.has(nb.slice(i, i + 2))) overlap++;
  }
  if (totalB === 0) return 0;
  return Math.round((overlap / Math.max(bigramsA.size, totalB)) * 100);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// --- CSVパーサー ---

const COLUMN_MAP: Record<string, keyof AmazonOrderLine> = {
  "注文日": "orderDate",
  "注文番号": "orderNumber",
  "商品名": "productName",
  "出品者名": "sellerName",
  "アカウントユーザー": "buyerName",
  "ユーザーのEメール": "buyerEmail",
  "商品および配送料の合計（税込）": "lineTotal",
  "注文の合計（税込）": "orderTotal",
  "商品の数量": "quantity",
  "適格請求書発行事業者登録番号": "invoiceRegNumber",
  "適格請求書（または支払い明細書）発行者名": "invoiceIssuerName",
  "クレジットカード番号（下4桁）": "cardLast4",
  "支払い金額": "paymentAmount",
  "注文状況": "orderStatus",
  "ASIN": "asin",
};

function parseAmount(s: string): number {
  if (!s || s === "該当無し") return 0;
  return Math.round(Number(s.replace(/[¥,，="]/g, "")) || 0);
}

export function parseAmazonCsv(text: string): AmazonOrderLine[] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const colIdx: Partial<Record<keyof AmazonOrderLine, number>> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (COLUMN_MAP[h]) {
      colIdx[COLUMN_MAP[h]] = i;
    }
  }

  const results: AmazonOrderLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const get = (key: keyof AmazonOrderLine): string => {
      const idx = colIdx[key];
      return idx !== undefined ? (cols[idx] || "").trim() : "";
    };

    const orderStatus = get("orderStatus");
    if (orderStatus.includes("キャンセル")) continue;

    const orderDate = get("orderDate").replace(/\//g, "-");
    const orderNumber = get("orderNumber");
    if (!orderNumber) continue;

    results.push({
      id: `${orderNumber}-${i}`,
      orderDate,
      orderNumber,
      productName: get("productName"),
      sellerName: get("sellerName"),
      buyerName: get("buyerName"),
      buyerEmail: get("buyerEmail"),
      lineTotal: parseAmount(get("lineTotal")),
      orderTotal: parseAmount(get("orderTotal")),
      quantity: parseInt(get("quantity"), 10) || 1,
      invoiceRegNumber: get("invoiceRegNumber").replace(/^="|"$/g, ""),
      invoiceIssuerName: get("invoiceIssuerName"),
      cardLast4: get("cardLast4").replace(/^="|"$/g, ""),
      paymentAmount: parseAmount(get("paymentAmount")),
      orderStatus,
      asin: get("asin"),
    });
  }
  return results;
}

// --- マッチングエンジン ---

const SCORE_THRESHOLD_AUTO = 80;
const SCORE_THRESHOLD_CANDIDATE = 45;

function scoreMatch(order: AmazonOrderLine, req: PurchaseRequestForMatch): number {
  let score = 0;

  // 金額一致 (50点)
  const amount = order.lineTotal || order.orderTotal;
  if (amount > 0 && req.totalAmount > 0) {
    const diff = Math.abs(amount - req.totalAmount);
    const ratio = diff / Math.max(amount, req.totalAmount);
    if (diff === 0) score += 50;
    else if (ratio <= 0.05) score += 40;
    else if (ratio <= 0.10) score += 20;
    else if (ratio <= 0.20) score += 5;
  }

  // 品名類似 (25点)
  if (order.productName && req.itemName) {
    score += Math.round(fuzzyScore(order.productName, req.itemName) * 0.25);
  }

  // 日付近接 (15点)
  if (order.orderDate && req.applicationDate) {
    const dd = daysDiff(order.orderDate, req.applicationDate);
    if (dd === 0) score += 15;
    else if (dd <= 3) score += 12;
    else if (dd <= 7) score += 8;
    else if (dd <= 14) score += 3;
  }

  // 申請者一致 (10点)
  if (order.buyerName && req.applicant) {
    const buyerNorm = normalizeText(order.buyerName);
    const applicantNorm = normalizeText(req.applicant);
    if (buyerNorm === applicantNorm) score += 10;
    else if (buyerNorm.includes(applicantNorm) || applicantNorm.includes(buyerNorm)) score += 7;
  }

  return score;
}

export function executeAmazonMatching(
  orders: AmazonOrderLine[],
  requests: PurchaseRequestForMatch[],
): AmazonMatchResult {
  // Amazon購入のみフィルタ（supplierNameにAmazonを含む申請）
  const amazonRequests = requests.filter(
    (r) => /amazon|アマゾン/i.test(r.supplierName),
  );

  const matchedOrderIds = new Set<string>();
  const matchedReqIds = new Set<string>();
  const matched: AmazonConfidentMatch[] = [];
  const candidates: AmazonCandidateMatch[] = [];

  // 各注文行に対してスコア計算
  for (const order of orders) {
    const scored = amazonRequests
      .filter((r) => !matchedReqIds.has(r.prNumber))
      .map((r) => ({
        request: r,
        score: scoreMatch(order, r),
        amountDiff: (order.lineTotal || order.orderTotal) - r.totalAmount,
      }))
      .filter((s) => s.score >= SCORE_THRESHOLD_CANDIDATE)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;

    // 最高スコアが閾値以上かつ2位と十分な差がある → 自動一致
    if (
      scored[0].score >= SCORE_THRESHOLD_AUTO &&
      (scored.length === 1 || scored[0].score - scored[1].score >= 10)
    ) {
      matched.push({
        order,
        request: scored[0].request,
        score: scored[0].score,
        amountDiff: scored[0].amountDiff,
      });
      matchedOrderIds.add(order.id);
      matchedReqIds.add(scored[0].request.prNumber);
    } else {
      candidates.push({
        order,
        candidates: scored.slice(0, 3),
      });
      matchedOrderIds.add(order.id);
    }
  }

  const unmatchedOrders = orders.filter((o) => !matchedOrderIds.has(o.id));
  const unmatchedRequests = amazonRequests.filter((r) => !matchedReqIds.has(r.prNumber));
  const total = orders.length + amazonRequests.length;
  const matchedTotal = matched.length * 2;

  return {
    matched,
    candidates,
    unmatchedOrders,
    unmatchedRequests,
    summary: {
      totalOrders: orders.length,
      totalRequests: amazonRequests.length,
      matchedCount: matched.length,
      candidateCount: candidates.length,
      unmatchedOrderCount: unmatchedOrders.length,
      unmatchedRequestCount: unmatchedRequests.length,
      matchRate: total > 0 ? `${Math.round((matchedTotal / total) * 100)}%` : "0%",
    },
  };
}

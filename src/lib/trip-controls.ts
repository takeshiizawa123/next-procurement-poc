/**
 * 出張統制エンジン
 *
 * 発見的統制:
 * 1. カード明細 vs 申請額の差異検知
 * 2. 未申請カード利用検出
 * 3. 同一区間の重複検出
 *
 * 行動変容的統制:
 * 4. 部門別出張コスト集計
 * 5. 個人別出張ランキング
 */

import { and, eq, gte, lte, like, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { purchaseRequests, predictedTransactions, employees } from "@/db/schema";
import type { NormalizedCardStatement } from "./mf-expense";

// ============================================================================
// 1. カード明細 vs 申請額の差異検知
// ============================================================================

export interface AmountVariance {
  poNumber: string;
  applicantName: string;
  department: string;
  itemName: string;
  /** 申請額 */
  requestedAmount: number;
  /** カード明細額（マッチした場合） */
  actualAmount: number;
  /** 差額（actual - requested） */
  diff: number;
  /** 差額率 */
  diffRate: number;
  /** 重要度 */
  severity: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * マッチ済み予測の差額を検出
 * @param month YYYY-MM 形式
 * @param thresholdAmount 差額閾値（円、デフォルト1000）
 * @param thresholdRate 差額率閾値（デフォルト0.1 = 10%）
 */
export async function detectAmountVariances(
  month: string,
  thresholdAmount = 1000,
  thresholdRate = 0.1,
): Promise<AmountVariance[]> {
  const [year, mo] = month.split("-").map(Number);
  const from = new Date(year, mo - 1, 1).toISOString().slice(0, 10);
  const to = new Date(year, mo, 0).toISOString().slice(0, 10); // 月末

  const matched = await db
    .select()
    .from(predictedTransactions)
    .where(
      and(
        eq(predictedTransactions.status, "matched"),
        gte(predictedTransactions.predictedDate, from),
        lte(predictedTransactions.predictedDate, to),
      ),
    );

  const variances: AmountVariance[] = [];

  for (const p of matched) {
    if (p.amountDiff == null || p.amountDiff === 0) continue;

    const absDiff = Math.abs(p.amountDiff);
    const rate = p.predictedAmount > 0 ? absDiff / p.predictedAmount : 0;

    if (absDiff >= thresholdAmount || rate >= thresholdRate) {
      // 申請元の情報を取得
      let applicantName = p.applicant ?? "";
      let department = "";
      let itemName = "";
      if (p.poNumber) {
        const req = await db
          .select()
          .from(purchaseRequests)
          .where(eq(purchaseRequests.poNumber, p.poNumber))
          .limit(1);
        if (req.length > 0) {
          applicantName = req[0].applicantName;
          department = req[0].department;
          itemName = req[0].itemName;
        }
      }

      variances.push({
        poNumber: p.poNumber ?? p.id,
        applicantName,
        department,
        itemName: itemName || `${p.type}: ${p.supplier ?? ""}`,
        requestedAmount: p.predictedAmount,
        actualAmount: p.predictedAmount + p.amountDiff,
        diff: p.amountDiff,
        diffRate: rate,
        severity: rate >= 0.2 || absDiff >= 5000 ? "HIGH" : rate >= 0.1 ? "MEDIUM" : "LOW",
      });
    }
  }

  return variances.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

// ============================================================================
// 2. 未申請カード利用検出
// ============================================================================

export interface UnreportedUsage {
  /** MF経費のoffice_member_id */
  officeMemberId: string;
  /** 従業員名 */
  memberName: string;
  /** 部門 */
  department: string;
  /** 未申請のカード利用件数 */
  count: number;
  /** 合計金額 */
  totalAmount: number;
  /** 明細一覧 */
  items: {
    date: string;
    remark: string;
    amount: number;
  }[];
}

/**
 * MF経費のカード明細のうち、予測テーブルにマッチしないものを検出
 */
export async function detectUnreportedUsage(
  statements: NormalizedCardStatement[],
): Promise<UnreportedUsage[]> {
  // manual/input_done（手動立替精算）は除外、automatic（カード自動取込）のみ対象
  const cardStatements = statements.filter(
    (s) => s.source !== "manual" && s.source !== "input_done",
  );

  if (cardStatements.length === 0) return [];

  // 全pendingの予測を取得
  const pending = await db
    .select()
    .from(predictedTransactions)
    .where(eq(predictedTransactions.status, "pending"));

  const matched = await db
    .select()
    .from(predictedTransactions)
    .where(eq(predictedTransactions.status, "matched"));

  // 既にマッチ済みのMF ex_transaction_idを集める
  const matchedExIds = new Set(matched.map((m) => m.mfExTransactionId).filter(Boolean));

  // 従業員情報を取得
  const allEmployees = await db.select().from(employees);
  const empMap = new Map(allEmployees.map((e) => [e.mfOfficeMemberId, e]));

  // 各カード明細について、対応する予測があるか確認
  const unreportedMap = new Map<string, UnreportedUsage>();

  for (const stmt of cardStatements) {
    if (matchedExIds.has(stmt.mfExTransactionId)) continue;

    // 同じoffice_member_idのpending予測で金額・日付が近いものがあればスキップ
    const hasPending = pending.some(
      (p) =>
        p.mfOfficeMemberId === stmt.officeMemberId &&
        Math.abs(p.predictedAmount - stmt.amount) / Math.max(p.predictedAmount, 1) < 0.2 &&
        Math.abs(
          new Date(p.predictedDate).getTime() - new Date(stmt.date).getTime(),
        ) <
          14 * 24 * 60 * 60 * 1000, // 14日以内
    );
    if (hasPending) continue;

    // 未申請として記録
    const emp = empMap.get(stmt.officeMemberId);
    const key = stmt.officeMemberId;
    const existing = unreportedMap.get(key) ?? {
      officeMemberId: stmt.officeMemberId,
      memberName: stmt.memberName || emp?.name || "不明",
      department: emp?.departmentName || "",
      count: 0,
      totalAmount: 0,
      items: [],
    };
    existing.count++;
    existing.totalAmount += stmt.amount;
    existing.items.push({
      date: stmt.date,
      remark: stmt.remark,
      amount: stmt.amount,
    });
    unreportedMap.set(key, existing);
  }

  return Array.from(unreportedMap.values()).sort(
    (a, b) => b.totalAmount - a.totalAmount,
  );
}

// ============================================================================
// 3. 同一区間の重複検出
// ============================================================================

export interface DuplicateRoute {
  applicantName: string;
  department: string;
  /** 区間（例: 東京→大阪） */
  route: string;
  /** 該当期間内の出張回数 */
  count: number;
  /** 該当する申請一覧 */
  trips: {
    poNumber: string;
    date: string;
    amount: number;
  }[];
}

/**
 * 同一区間を短期間に複数回の重複を検出
 * @param days 検出対象期間（日数、デフォルト30日）
 * @param minCount 最低回数（デフォルト2回）
 */
export async function detectDuplicateRoutes(
  days = 30,
  minCount = 2,
): Promise<DuplicateRoute[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 出張申請のみ取得（TRIP-* または item_name に「出張」を含む）
  const trips = await db
    .select()
    .from(purchaseRequests)
    .where(
      and(
        gte(purchaseRequests.applicationDate, new Date(since)),
        like(purchaseRequests.itemName, "%出張%"),
      ),
    )
    .orderBy(desc(purchaseRequests.applicationDate));

  // 申請者 × 行き先でグルーピング
  const routeMap = new Map<string, DuplicateRoute>();

  for (const trip of trips) {
    // item_name から行き先を抽出: "出張: 大阪 (2026-04-21 〜 2026-04-22)"
    const destMatch = trip.itemName.match(/出張:\s*([^\s(（]+)/);
    const destination = destMatch?.[1] || trip.supplierName || "不明";
    const key = `${trip.applicantName}|${destination}`;

    const existing = routeMap.get(key) ?? {
      applicantName: trip.applicantName,
      department: trip.department,
      route: destination,
      count: 0,
      trips: [],
    };
    existing.count++;
    existing.trips.push({
      poNumber: trip.poNumber,
      date: trip.applicationDate?.toISOString().slice(0, 10) ?? "",
      amount: trip.totalAmount,
    });
    routeMap.set(key, existing);
  }

  return Array.from(routeMap.values())
    .filter((r) => r.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// 4. 部門別出張コスト集計
// ============================================================================

export interface DepartmentTripCost {
  department: string;
  /** 出張件数 */
  tripCount: number;
  /** 合計金額 */
  totalAmount: number;
  /** 平均金額 */
  avgAmount: number;
  /** 前月比（%、前月データがあれば） */
  momChange?: number;
}

/**
 * 部門別の出張コストを集計
 * @param month YYYY-MM 形式
 */
export async function getDepartmentTripCosts(month: string): Promise<DepartmentTripCost[]> {
  const [year, mo] = month.split("-").map(Number);
  const from = new Date(year, mo - 1, 1);
  const to = new Date(year, mo, 0); // 月末
  const prevFrom = new Date(year, mo - 2, 1);
  const prevTo = new Date(year, mo - 1, 0);

  // 当月
  const current = await db
    .select()
    .from(purchaseRequests)
    .where(
      and(
        gte(purchaseRequests.applicationDate, from),
        lte(purchaseRequests.applicationDate, to),
        like(purchaseRequests.itemName, "%出張%"),
      ),
    );

  // 前月
  const previous = await db
    .select()
    .from(purchaseRequests)
    .where(
      and(
        gte(purchaseRequests.applicationDate, prevFrom),
        lte(purchaseRequests.applicationDate, prevTo),
        like(purchaseRequests.itemName, "%出張%"),
      ),
    );

  // 部門別集計
  const deptMap = new Map<string, { count: number; total: number }>();
  const prevDeptMap = new Map<string, number>();

  for (const trip of current) {
    const dept = trip.department || "不明";
    const existing = deptMap.get(dept) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += trip.totalAmount;
    deptMap.set(dept, existing);
  }

  for (const trip of previous) {
    const dept = trip.department || "不明";
    prevDeptMap.set(dept, (prevDeptMap.get(dept) ?? 0) + trip.totalAmount);
  }

  const results: DepartmentTripCost[] = [];
  for (const [dept, data] of deptMap) {
    const prevTotal = prevDeptMap.get(dept);
    results.push({
      department: dept,
      tripCount: data.count,
      totalAmount: data.total,
      avgAmount: data.count > 0 ? Math.round(data.total / data.count) : 0,
      momChange: prevTotal != null && prevTotal > 0
        ? Math.round(((data.total - prevTotal) / prevTotal) * 100)
        : undefined,
    });
  }

  return results.sort((a, b) => b.totalAmount - a.totalAmount);
}

// ============================================================================
// 5. 個人別出張ランキング
// ============================================================================

export interface PersonalTripRanking {
  rank: number;
  applicantName: string;
  department: string;
  slackId: string;
  /** 出張件数 */
  tripCount: number;
  /** 合計金額 */
  totalAmount: number;
  /** 直近の出張 */
  lastTrip?: {
    poNumber: string;
    destination: string;
    date: string;
  };
}

/**
 * 個人別の出張支出ランキング
 * @param month YYYY-MM 形式
 * @param limit 上位N名（デフォルト10）
 */
export async function getPersonalTripRanking(
  month: string,
  limit = 10,
): Promise<PersonalTripRanking[]> {
  const [year, mo] = month.split("-").map(Number);
  const from = new Date(year, mo - 1, 1);
  const to = new Date(year, mo, 0);

  const trips = await db
    .select()
    .from(purchaseRequests)
    .where(
      and(
        gte(purchaseRequests.applicationDate, from),
        lte(purchaseRequests.applicationDate, to),
        like(purchaseRequests.itemName, "%出張%"),
      ),
    )
    .orderBy(desc(purchaseRequests.applicationDate));

  // 個人別集計
  const personMap = new Map<
    string,
    {
      name: string;
      dept: string;
      slackId: string;
      count: number;
      total: number;
      lastTrip?: { poNumber: string; destination: string; date: string };
    }
  >();

  for (const trip of trips) {
    const key = trip.applicantSlackId || trip.applicantName;
    const existing = personMap.get(key) ?? {
      name: trip.applicantName,
      dept: trip.department,
      slackId: trip.applicantSlackId,
      count: 0,
      total: 0,
    };
    existing.count++;
    existing.total += trip.totalAmount;
    if (!existing.lastTrip) {
      const destMatch = trip.itemName.match(/出張:\s*([^\s(（]+)/);
      existing.lastTrip = {
        poNumber: trip.poNumber,
        destination: destMatch?.[1] || "不明",
        date: trip.applicationDate?.toISOString().slice(0, 10) ?? "",
      };
    }
    personMap.set(key, existing);
  }

  const sorted = Array.from(personMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  return sorted.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    applicantName: p.name,
    department: p.dept,
    slackId: p.slackId,
    tripCount: p.count,
    totalAmount: p.total,
    lastTrip: p.lastTrip,
  }));
}

// ============================================================================
// 統合レポート生成（Slack投稿用）
// ============================================================================

export interface TripControlReport {
  month: string;
  variances: AmountVariance[];
  unreported: UnreportedUsage[];
  duplicates: DuplicateRoute[];
  departmentCosts: DepartmentTripCost[];
  ranking: PersonalTripRanking[];
}

/**
 * Slack投稿用のレポートテキストを生成
 */
export function formatReportForSlack(report: TripControlReport): string {
  const lines: string[] = [
    `📊 *出張統制レポート* — ${report.month}`,
    "",
  ];

  // 差異検知
  if (report.variances.length > 0) {
    lines.push(`🔴 *金額差異検知（${report.variances.length}件）*`);
    for (const v of report.variances.slice(0, 5)) {
      const sign = v.diff > 0 ? "+" : "";
      lines.push(
        `  ${v.severity === "HIGH" ? "🚨" : "⚠️"} ${v.poNumber} ${v.applicantName} — 申請¥${v.requestedAmount.toLocaleString()} → 実額¥${v.actualAmount.toLocaleString()}（${sign}¥${v.diff.toLocaleString()}）`,
      );
    }
    lines.push("");
  }

  // 未申請利用
  if (report.unreported.length > 0) {
    lines.push(`🟡 *未申請カード利用（${report.unreported.length}名）*`);
    for (const u of report.unreported.slice(0, 5)) {
      lines.push(
        `  ⚠️ ${u.memberName}（${u.department}）— ${u.count}件 ¥${u.totalAmount.toLocaleString()}`,
      );
    }
    lines.push("");
  }

  // 重複区間
  if (report.duplicates.length > 0) {
    lines.push(`🔵 *同一区間重複（${report.duplicates.length}件）*`);
    for (const d of report.duplicates.slice(0, 5)) {
      lines.push(
        `  📍 ${d.applicantName} → ${d.route} × ${d.count}回（${d.department}）`,
      );
    }
    lines.push("");
  }

  // 部門別コスト
  if (report.departmentCosts.length > 0) {
    lines.push(`📊 *部門別出張コスト*`);
    for (const dc of report.departmentCosts) {
      const mom = dc.momChange != null ? `（前月比${dc.momChange >= 0 ? "+" : ""}${dc.momChange}%）` : "";
      lines.push(
        `  ${dc.department}: ${dc.tripCount}件 ¥${dc.totalAmount.toLocaleString()} ${mom}`,
      );
    }
    lines.push("");
  }

  // 個人ランキング
  if (report.ranking.length > 0) {
    lines.push(`🏆 *個人別出張ランキング（上位5名）*`);
    for (const r of report.ranking.slice(0, 5)) {
      lines.push(
        `  ${r.rank}. ${r.applicantName}（${r.department}）— ${r.tripCount}件 ¥${r.totalAmount.toLocaleString()}`,
      );
    }
  }

  return lines.join("\n");
}

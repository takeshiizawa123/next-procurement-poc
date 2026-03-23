"use client";

import { Suspense, useState, useEffect } from "react";

interface PurchaseRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  approvalStatus: string;
  orderStatus: string;
  inspectionStatus: string;
  voucherStatus: string;
  type: string;
  department: string;
}

function overallLabel(req: PurchaseRequest): string {
  if (req.type === "購入報告") {
    return req.voucherStatus === "添付済" ? "完了" : "証憑待ち";
  }
  if (req.approvalStatus === "差戻し") return "差戻し";
  if (req.approvalStatus === "承認待ち") return "承認待ち";
  if (req.orderStatus === "未発注") return "発注待ち";
  if (req.inspectionStatus === "未検収") return "検収待ち";
  if (req.voucherStatus === "要取得") return "証憑待ち";
  return "完了";
}

function DashboardInner() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/purchase/recent?limit=30")
      .then((r) => r.json())
      .then((d: { requests?: PurchaseRequest[] }) => setRequests(d.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-gray-500 animate-pulse">読み込み中...</div>;
  }

  // --- 集計 ---
  const totalAmount = requests.reduce((s, r) => s + (r.totalAmount || 0), 0);
  const statusCounts: Record<string, number> = {};
  const deptStats: Record<string, { count: number; amount: number }> = {};
  const supplierStats: Record<string, { count: number; amount: number }> = {};
  const monthlyStats: Record<string, { count: number; amount: number }> = {};

  for (const req of requests) {
    // ステータス別
    const label = overallLabel(req);
    statusCounts[label] = (statusCounts[label] || 0) + 1;

    // 部門別
    const dept = req.department || "未設定";
    if (!deptStats[dept]) deptStats[dept] = { count: 0, amount: 0 };
    deptStats[dept].count++;
    deptStats[dept].amount += req.totalAmount || 0;

    // 購入先別
    const sup = req.supplierName || "その他";
    if (!supplierStats[sup]) supplierStats[sup] = { count: 0, amount: 0 };
    supplierStats[sup].count++;
    supplierStats[sup].amount += req.totalAmount || 0;

    // 月別
    const dateStr = String(req.applicationDate);
    const monthMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})/);
    const month = monthMatch ? `${monthMatch[1]}/${monthMatch[2].padStart(2, "0")}` : "不明";
    if (!monthlyStats[month]) monthlyStats[month] = { count: 0, amount: 0 };
    monthlyStats[month].count++;
    monthlyStats[month].amount += req.totalAmount || 0;
  }

  const statusOrder = ["承認待ち", "発注待ち", "検収待ち", "証憑待ち", "差戻し", "完了"];
  const statusColorMap: Record<string, string> = {
    "承認待ち": "bg-yellow-400",
    "発注待ち": "bg-blue-400",
    "検収待ち": "bg-indigo-400",
    "証憑待ち": "bg-amber-400",
    "差戻し": "bg-red-400",
    "完了": "bg-green-400",
  };

  const sortedDepts = Object.entries(deptStats).sort((a, b) => b[1].amount - a[1].amount);
  const sortedSuppliers = Object.entries(supplierStats).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10);
  const sortedMonths = Object.entries(monthlyStats).sort((a, b) => a[0].localeCompare(b[0]));

  // 最大値（バーの幅計算用）
  const maxDeptAmount = Math.max(...sortedDepts.map(([, v]) => v.amount), 1);
  const maxSupplierAmount = Math.max(...sortedSuppliers.map(([, v]) => v.amount), 1);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold mb-6">購買ダッシュボード</h1>

      {/* KPI カード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-gray-800">{requests.length}</div>
          <div className="text-sm text-gray-500">総申請件数</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-blue-600">
            {statusCounts["承認待ち"] || 0}
          </div>
          <div className="text-sm text-gray-500">承認待ち</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-3xl font-bold text-green-600">
            {statusCounts["完了"] || 0}
          </div>
          <div className="text-sm text-gray-500">完了</div>
        </div>
        <div className="bg-white border rounded-xl p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-gray-800">
            ¥{totalAmount.toLocaleString()}
          </div>
          <div className="text-sm text-gray-500">合計金額</div>
        </div>
      </div>

      {/* ステータス分布 */}
      <div className="bg-white border rounded-xl p-4 mb-6 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 mb-3">ステータス分布</h2>
        {requests.length > 0 && (
          <div className="flex rounded-lg overflow-hidden h-8 mb-3">
            {statusOrder.map((s) => {
              const count = statusCounts[s] || 0;
              if (count === 0) return null;
              const pct = (count / requests.length) * 100;
              return (
                <div
                  key={s}
                  className={`${statusColorMap[s] || "bg-gray-300"} flex items-center justify-center text-white text-xs font-medium`}
                  style={{ width: `${pct}%`, minWidth: pct > 5 ? undefined : "24px" }}
                  title={`${s}: ${count}件`}
                >
                  {pct >= 10 ? count : ""}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          {statusOrder.map((s) => {
            const count = statusCounts[s] || 0;
            if (count === 0) return null;
            return (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-3 h-3 rounded-sm ${statusColorMap[s]}`} />
                <span>{s}: {count}件</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        {/* 部門別 */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-3">部門別</h2>
          <div className="space-y-2">
            {sortedDepts.map(([dept, stat]) => (
              <div key={dept}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span>{dept}</span>
                  <span className="text-gray-500">{stat.count}件 / ¥{stat.amount.toLocaleString()}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 rounded-full h-2"
                    style={{ width: `${(stat.amount / maxDeptAmount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {sortedDepts.length === 0 && <p className="text-sm text-gray-400">データなし</p>}
          </div>
        </div>

        {/* 購入先TOP10 */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-3">購入先 TOP{sortedSuppliers.length}</h2>
          <div className="space-y-2">
            {sortedSuppliers.map(([sup, stat]) => (
              <div key={sup}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span>{sup}</span>
                  <span className="text-gray-500">{stat.count}件 / ¥{stat.amount.toLocaleString()}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-indigo-500 rounded-full h-2"
                    style={{ width: `${(stat.amount / maxSupplierAmount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {sortedSuppliers.length === 0 && <p className="text-sm text-gray-400">データなし</p>}
          </div>
        </div>
      </div>

      {/* 月別推移 */}
      {sortedMonths.length > 0 && (
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-3">月別推移</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">月</th>
                  <th className="py-2 pr-4 text-right">件数</th>
                  <th className="py-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {sortedMonths.map(([month, stat]) => (
                  <tr key={month} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{month}</td>
                    <td className="py-2 pr-4 text-right">{stat.count}件</td>
                    <td className="py-2 text-right">¥{stat.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto p-6 text-center text-gray-500">読み込み中...</div>}>
      <DashboardInner />
    </Suspense>
  );
}

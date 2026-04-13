"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface AmountVariance {
  poNumber: string;
  applicantName: string;
  department: string;
  itemName: string;
  requestedAmount: number;
  actualAmount: number;
  diff: number;
  diffRate: number;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

interface DuplicateRoute {
  applicantName: string;
  department: string;
  route: string;
  count: number;
  trips: { poNumber: string; date: string; amount: number }[];
}

interface DepartmentCost {
  department: string;
  tripCount: number;
  totalAmount: number;
  avgAmount: number;
  momChange?: number;
}

interface PersonalRanking {
  rank: number;
  applicantName: string;
  department: string;
  tripCount: number;
  totalAmount: number;
  lastTrip?: { poNumber: string; destination: string; date: string };
}

interface ControlData {
  month: string;
  variances: AmountVariance[];
  duplicates: DuplicateRoute[];
  departmentCosts: DepartmentCost[];
  ranking: PersonalRanking[];
  summary: {
    varianceCount: number;
    highSeverityCount: number;
    duplicateRouteCount: number;
    totalTripCost: number;
    totalTripCount: number;
  };
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

export default function TripControlsPage() {
  const user = useUser();
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!month) return; // mount前はスキップ
    setLoading(true);
    setError("");
    apiFetch(`/api/admin/trip-controls?month=${month}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d);
        else setError(d.error || "取得に失敗しました");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  if (!mounted || !user.loaded) return <div className="p-8 text-gray-400">読み込み中...</div>;
  if (!user.isAdmin) return <div className="p-8 text-red-500">管理本部のみアクセスできます</div>;

  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">📊 出張統制ダッシュボード</h1>
            <p className="text-sm text-gray-500">出張コストの可視化と異常検知</p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        {loading && <div className="text-center py-10 text-gray-400">データ取得中...</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md mb-4">{error}</div>}

        {data && (
          <div className="space-y-6">
            {/* サマリカード */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border p-4">
                <div className="text-2xl font-bold text-gray-800">{data.summary.totalTripCount}</div>
                <div className="text-xs text-gray-500">出張件数</div>
              </div>
              <div className="bg-white rounded-lg border p-4">
                <div className="text-2xl font-bold text-gray-800">{formatYen(data.summary.totalTripCost)}</div>
                <div className="text-xs text-gray-500">合計金額</div>
              </div>
              <div className="bg-white rounded-lg border p-4">
                <div className={`text-2xl font-bold ${data.summary.varianceCount > 0 ? "text-red-600" : "text-green-600"}`}>
                  {data.summary.varianceCount}
                </div>
                <div className="text-xs text-gray-500">金額差異</div>
              </div>
              <div className="bg-white rounded-lg border p-4">
                <div className={`text-2xl font-bold ${data.summary.duplicateRouteCount > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {data.summary.duplicateRouteCount}
                </div>
                <div className="text-xs text-gray-500">重複区間</div>
              </div>
            </div>

            {/* 金額差異 */}
            <section className="bg-white rounded-lg border">
              <div className="p-4 border-b">
                <h2 className="font-semibold text-gray-800">🔴 金額差異検知</h2>
                <p className="text-xs text-gray-500">申請額 vs カード決済額の差異（±10%または±¥1,000以上）</p>
              </div>
              {data.variances.length === 0 ? (
                <div className="p-4 text-sm text-green-600">差異なし ✓</div>
              ) : (
                <div className="divide-y">
                  {data.variances.map((v) => (
                    <div key={v.poNumber} className="p-4 flex items-center gap-4">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${v.severity === "HIGH" ? "bg-red-100 text-red-700" : v.severity === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                        {v.severity}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{v.poNumber} {v.itemName}</div>
                        <div className="text-xs text-gray-500">{v.applicantName}（{v.department}）</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm">申請 {formatYen(v.requestedAmount)} → 実額 {formatYen(v.actualAmount)}</div>
                        <div className={`text-xs font-bold ${v.diff > 0 ? "text-red-600" : "text-blue-600"}`}>
                          {v.diff > 0 ? "+" : ""}{formatYen(v.diff)}（{Math.round(v.diffRate * 100)}%）
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 重複区間 */}
            <section className="bg-white rounded-lg border">
              <div className="p-4 border-b">
                <h2 className="font-semibold text-gray-800">🔵 同一区間重複</h2>
                <p className="text-xs text-gray-500">30日以内に同じ区間を2回以上</p>
              </div>
              {data.duplicates.length === 0 ? (
                <div className="p-4 text-sm text-green-600">重複なし ✓</div>
              ) : (
                <div className="divide-y">
                  {data.duplicates.map((d, i) => (
                    <div key={i} className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium">{d.applicantName}</span>
                        <span className="text-xs text-gray-500">（{d.department}）</span>
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">→ {d.route} × {d.count}回</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {d.trips.map((t) => (
                          <span key={t.poNumber} className="text-xs bg-gray-100 px-2 py-1 rounded">
                            {t.poNumber} {t.date} {formatYen(t.amount)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 部門別コスト */}
            <section className="bg-white rounded-lg border">
              <div className="p-4 border-b">
                <h2 className="font-semibold text-gray-800">📊 部門別出張コスト</h2>
              </div>
              {data.departmentCosts.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">データなし</div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 font-medium text-gray-600">部門</th>
                      <th className="text-right p-3 font-medium text-gray-600">件数</th>
                      <th className="text-right p-3 font-medium text-gray-600">合計</th>
                      <th className="text-right p-3 font-medium text-gray-600">平均</th>
                      <th className="text-right p-3 font-medium text-gray-600">前月比</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.departmentCosts.map((dc) => (
                      <tr key={dc.department}>
                        <td className="p-3 font-medium">{dc.department}</td>
                        <td className="p-3 text-right">{dc.tripCount}</td>
                        <td className="p-3 text-right font-medium">{formatYen(dc.totalAmount)}</td>
                        <td className="p-3 text-right text-gray-500">{formatYen(dc.avgAmount)}</td>
                        <td className="p-3 text-right">
                          {dc.momChange != null ? (
                            <span className={dc.momChange > 20 ? "text-red-600 font-bold" : dc.momChange < -10 ? "text-green-600" : "text-gray-600"}>
                              {dc.momChange >= 0 ? "+" : ""}{dc.momChange}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </section>

            {/* 個人ランキング */}
            <section className="bg-white rounded-lg border">
              <div className="p-4 border-b">
                <h2 className="font-semibold text-gray-800">🏆 個人別出張ランキング</h2>
              </div>
              {data.ranking.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">データなし</div>
              ) : (
                <div className="divide-y">
                  {data.ranking.map((r) => (
                    <div key={r.rank} className="p-4 flex items-center gap-4">
                      <span className={`text-lg font-bold w-8 text-center ${r.rank <= 3 ? "text-amber-500" : "text-gray-400"}`}>
                        {r.rank}
                      </span>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{r.applicantName}<span className="text-gray-400 ml-2">（{r.department}）</span></div>
                        {r.lastTrip && (
                          <div className="text-xs text-gray-500">直近: {r.lastTrip.destination} ({r.lastTrip.date})</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">{formatYen(r.totalAmount)}</div>
                        <div className="text-xs text-gray-500">{r.tripCount}件</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

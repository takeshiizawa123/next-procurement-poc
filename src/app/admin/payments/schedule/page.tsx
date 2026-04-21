"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface ScheduleItem {
  contractId: number;
  contractNumber: string;
  supplierName: string;
  category: string;
  scheduledDate: string;
  resolvedDate: string;
  shifted: boolean;
  amount: number;
  paymentMethod: string | null;
  accountTitle: string;
  billingType: string;
}

interface ScheduleResult {
  ok: boolean;
  period: { from: string; to: string };
  count: number;
  totalAmount: number;
  byMethod: Record<string, { count: number; total: number }>;
  items: ScheduleItem[];
}

function defaultMonths() {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  d.setMonth(d.getMonth() + 2);
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { from, to };
}

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function formatWithWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${dateStr} (${WEEKDAY_JP[d.getDay()]})`;
}

export default function PaymentSchedulePage() {
  const user = useUser();
  const defaults = defaultMonths();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [data, setData] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methodFilter, setMethodFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/payments/schedule?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "取得失敗");
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold">管理本部のみアクセス可能</p>
        </div>
      </div>
    );
  }

  const filteredItems = data
    ? data.items.filter((i) => methodFilter === "all" || (i.paymentMethod || "未設定") === methodFilter)
    : [];

  // 週次グループ化
  const byWeek: Array<{ weekLabel: string; items: ScheduleItem[]; total: number }> = [];
  for (const i of filteredItems) {
    const d = new Date(i.resolvedDate + "T00:00:00");
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekLabel = `${weekStart.getMonth() + 1}/${weekStart.getDate()}週`;
    let week = byWeek[byWeek.length - 1];
    if (!week || week.weekLabel !== weekLabel) {
      week = { weekLabel, items: [], total: 0 };
      byWeek.push(week);
    }
    week.items.push(i);
    week.total += i.amount;
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">支払スケジュール</h1>
        <a href="/admin/contracts" className="text-sm text-gray-500 hover:text-gray-700">
          ← 契約管理に戻る
        </a>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
        💡 契約マスタから今後の支払予定を自動生成。土日祝・年末年始は**翌銀行営業日**に繰延表示。
      </div>

      <div className="bg-white border rounded-xl p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-gray-600 mb-1">開始月</label>
          <input type="month" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">終了月</label>
          <input type="month" value={to} onChange={(e) => setTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? "読込中..." : "更新"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border rounded-xl p-3">
              <p className="text-xs text-gray-500">期間</p>
              <p className="text-sm font-medium">{data.period.from} 〜 {data.period.to}</p>
            </div>
            <div className="bg-white border rounded-xl p-3">
              <p className="text-xs text-gray-500">支払予定件数</p>
              <p className="text-lg font-bold">{data.count}件</p>
            </div>
            <div className="bg-white border rounded-xl p-3">
              <p className="text-xs text-gray-500">支払総額</p>
              <p className="text-lg font-bold text-blue-700">¥{data.totalAmount.toLocaleString()}</p>
            </div>
            <div className="bg-white border rounded-xl p-3">
              <p className="text-xs text-gray-500">繰延件数</p>
              <p className="text-lg font-bold text-orange-600">
                {data.items.filter((i) => i.shifted).length}件
              </p>
            </div>
          </div>

          {/* Method filter */}
          <div className="bg-white border rounded-xl p-3 mb-4">
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-gray-500 mr-2">支払方法:</span>
              <button
                onClick={() => setMethodFilter("all")}
                className={`text-xs px-3 py-1 rounded-full ${
                  methodFilter === "all" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                全て ({data.count})
              </button>
              {Object.entries(data.byMethod)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([m, v]) => (
                  <button
                    key={m}
                    onClick={() => setMethodFilter(m)}
                    className={`text-xs px-3 py-1 rounded-full ${
                      methodFilter === m ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {m} ({v.count}件 / ¥{v.total.toLocaleString()})
                  </button>
                ))}
            </div>
          </div>

          {/* Schedule list */}
          <div className="bg-white border rounded-xl overflow-hidden">
            {byWeek.length === 0 ? (
              <div className="text-center text-gray-400 py-8">該当なし</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">実支払日</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">約定日</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">取引先</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">カテゴリ</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">金額</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">支払方法</th>
                  </tr>
                </thead>
                <tbody>
                  {byWeek.map((week, wi) => (
                    <>
                      <tr key={`w-${wi}`} className="bg-gray-100 border-y">
                        <td colSpan={4} className="px-3 py-1 text-xs font-medium text-gray-600">
                          📅 {week.weekLabel} ({week.items.length}件)
                        </td>
                        <td className="px-3 py-1 text-right text-xs font-medium text-gray-700">
                          ¥{week.total.toLocaleString()}
                        </td>
                        <td />
                      </tr>
                      {week.items.map((i, ii) => (
                        <tr key={`i-${wi}-${ii}`} className="border-b hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs font-medium">
                            {formatWithWeekday(i.resolvedDate)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {i.shifted ? (
                              <span className="text-orange-600">
                                🔶 {formatWithWeekday(i.scheduledDate)} → 繰延
                              </span>
                            ) : (
                              formatWithWeekday(i.scheduledDate)
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <a href={`/admin/contracts/${i.contractId}`} className="hover:underline text-blue-700">
                              {i.supplierName}
                            </a>
                            <div className="text-xs text-gray-400">
                              {i.contractNumber} {i.accountTitle}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                              {i.category}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            ¥{i.amount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600">
                            {i.paymentMethod || "-"}
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

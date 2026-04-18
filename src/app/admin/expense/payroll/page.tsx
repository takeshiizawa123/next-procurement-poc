"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface PayrollRow {
  payrollCode: string | null;
  slackId: string;
  name: string;
  employmentType: string | null;
  expenseAmount: number;
  tripAllowance: number;
  expensePoNumbers: string[];
  tripPoNumbers: string[];
}

interface PayrollResponse {
  ok: boolean;
  month: string;
  period: { from: string; to: string };
  summary: {
    totalEmployees: number;
    totalExpense: number;
    totalTripAllowance: number;
    unmappedCount: number;
  };
  rows: PayrollRow[];
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function PayrollPage() {
  const user = useUser();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/expense/payroll?month=${month}`);
      if (!res.ok) throw new Error("Failed");
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function downloadCsv() {
    if (!data) return;
    const header = "社員コード,氏名,雇用区分,立替経費,出張手当";
    const rows = data.rows.map((r) =>
      [r.payrollCode || "", r.name, r.employmentType || "", r.expenseAmount, r.tripAllowance].join(","),
    );
    const csv = "\uFEFF" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `立替出張手当_${data.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyForPayrollSheet() {
    if (!data) return;
    // 給与関連一覧表の「立替経費」「出張手当」列にコピペする形式
    // タブ区切り: コード\t氏名\t立替経費\t出張手当
    const text = data.rows
      .map((r) => `${r.payrollCode || ""}\t${r.name}\t${r.expenseAmount}\t${r.tripAllowance}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessage(`✅ ${data.rows.length}行をクリップボードにコピーしました`);
      setTimeout(() => setCopiedMessage(null), 3000);
    } catch {
      setCopiedMessage("❌ クリップボードへのコピーに失敗");
    }
  }

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold">管理本部のみアクセス可能</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-bold">給与連携 — 立替経費+出張手当</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
        💡 月末締め → 翌月15日支給。対象月の1日〜末日に登録された立替精算・出張手当を従業員別に集計します。
      </div>

      {/* 月選択 */}
      <div className="bg-white border rounded-xl p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-gray-600 mb-1">対象月</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "集計中..." : "集計"}
        </button>
        {data && (
          <>
            <div className="flex-1" />
            <button
              onClick={copyForPayrollSheet}
              className="px-4 py-2 text-sm border border-green-300 text-green-700 rounded-lg hover:bg-green-50"
            >
              📋 給与一覧表用コピー
            </button>
            <button
              onClick={downloadCsv}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
            >
              📎 CSVダウンロード
            </button>
          </>
        )}
      </div>

      {copiedMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
          {copiedMessage}
        </div>
      )}

      {data && (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard title="対象従業員" value={`${data.summary.totalEmployees}人`} />
            <KpiCard title="立替経費合計" value={`¥${data.summary.totalExpense.toLocaleString()}`} />
            <KpiCard title="出張手当合計" value={`¥${data.summary.totalTripAllowance.toLocaleString()}`} />
            <KpiCard
              title="社員コード未設定"
              value={`${data.summary.unmappedCount}人`}
              highlight={data.summary.unmappedCount > 0 ? "red" : undefined}
            />
          </div>

          {data.summary.unmappedCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 mb-4 text-sm">
              ⚠️ <strong>{data.summary.unmappedCount}人</strong>の社員コード（MF給与連携用6桁コード）が未設定です。
              <a href="/admin/employees/payroll-mapping" className="ml-2 text-blue-600 underline">
                マッピング設定へ
              </a>
            </div>
          )}

          {/* 集計テーブル */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">社員コード</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">氏名</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">雇用区分</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">立替経費</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">出張手当</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">内訳</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                      対象データがありません
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <>
                      <tr key={r.slackId} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">
                          {r.payrollCode || <span className="text-red-500">未設定</span>}
                        </td>
                        <td className="px-4 py-2">{r.name}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.employmentType || "-"}</td>
                        <td className="px-4 py-2 text-right">¥{r.expenseAmount.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">¥{r.tripAllowance.toLocaleString()}</td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => setExpanded(expanded === r.slackId ? null : r.slackId)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {expanded === r.slackId ? "閉じる" : "PO番号"}
                          </button>
                        </td>
                      </tr>
                      {expanded === r.slackId && (
                        <tr key={`${r.slackId}-detail`} className="bg-gray-50 border-b">
                          <td colSpan={6} className="px-4 py-3 text-xs">
                            {r.expensePoNumbers.length > 0 && (
                              <div className="mb-1">
                                <span className="text-gray-600">立替PO: </span>
                                {r.expensePoNumbers.map((p) => (
                                  <a key={p} href={`/purchase/${p}`} className="mr-2 text-blue-600 underline">{p}</a>
                                ))}
                              </div>
                            )}
                            {r.tripPoNumbers.length > 0 && (
                              <div>
                                <span className="text-gray-600">出張PO: </span>
                                {r.tripPoNumbers.map((p) => (
                                  <a key={p} href={`/purchase/${p}`} className="mr-2 text-blue-600 underline">{p}</a>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: string;
  highlight?: "red";
}) {
  const borderColor = highlight === "red" ? "border-red-300" : "border-gray-200";
  return (
    <div className={`bg-white border ${borderColor} rounded-xl p-3`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

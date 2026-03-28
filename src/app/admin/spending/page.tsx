"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

// --- 型定義 ---

interface EmployeeSpending {
  name: string;
  department: string;
  totalAmount: number;
  count: number;
  byMonth: Record<string, { amount: number; count: number }>;
  byCategory: Record<string, { amount: number; count: number }>;
  byPayment: Record<string, { amount: number; count: number }>;
  requests: Array<{
    prNumber: string;
    date: string;
    item: string;
    amount: number;
    supplier: string;
    payment: string;
  }>;
}

interface SpendingSummary {
  totalAmount: number;
  totalCount: number;
  avgPerEmployee: number;
  employeeCount: number;
  byDepartment: Record<string, { amount: number; count: number }>;
}

interface SpendingData {
  ok: boolean;
  months: string[];
  employees: EmployeeSpending[];
  summary: SpendingSummary;
}

// --- ヘルパー ---

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

// --- メインコンポーネント ---

export default function SpendingDashboard() {
  const [data, setData] = useState<SpendingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [months, setMonths] = useState(3);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"amount" | "count">("amount");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/admin/spending?months=${months}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "取得に失敗しました");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const employees = data?.employees || [];
  const summary = data?.summary;
  const targetMonths = data?.months || [];

  const sorted = [...employees].sort((a, b) =>
    sortBy === "amount" ? b.totalAmount - a.totalAmount : b.count - a.count,
  );

  const selected = selectedEmployee
    ? employees.find((e) => e.name === selectedEmployee)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              従業員別利用傾向ダッシュボード
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              購買申請の従業員別利用状況を可視化
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="border rounded-md px-3 py-1.5 text-sm"
            >
              <option value={1}>直近1ヶ月</option>
              <option value={3}>直近3ヶ月</option>
              <option value={6}>直近6ヶ月</option>
              <option value={12}>直近12ヶ月</option>
            </select>
            <a
              href="/admin/card-matching"
              className="text-sm text-blue-600 hover:underline"
            >
              カード照合画面
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-500">読み込み中...</div>
        )}

        {!loading && data && (
          <>
            {/* サマリカード */}
            {summary && <SummaryCards summary={summary} months={months} />}

            {/* 部門別バー */}
            {summary && Object.keys(summary.byDepartment).length > 0 && (
              <DepartmentBreakdown
                byDepartment={summary.byDepartment}
                total={summary.totalAmount}
              />
            )}

            {/* 従業員テーブル + 詳細 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
              <div className="lg:col-span-2">
                <EmployeeTable
                  employees={sorted}
                  totalAmount={summary?.totalAmount || 0}
                  targetMonths={targetMonths}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  selectedEmployee={selectedEmployee}
                  onSelect={setSelectedEmployee}
                />
              </div>
              <div>
                {selected ? (
                  <EmployeeDetail
                    employee={selected}
                    targetMonths={targetMonths}
                    onClose={() => setSelectedEmployee(null)}
                  />
                ) : (
                  <div className="bg-white rounded-lg border p-6 text-center text-gray-400 text-sm">
                    従業員を選択すると詳細が表示されます
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// --- サブコンポーネント ---

function SummaryCards({ summary, months }: { summary: SpendingSummary; months: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card label={`合計金額（${months}ヶ月）`} value={yen(summary.totalAmount)} />
      <Card label="申請件数" value={`${summary.totalCount}件`} />
      <Card label="従業員数" value={`${summary.employeeCount}名`} />
      <Card label="従業員平均" value={yen(summary.avgPerEmployee)} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function DepartmentBreakdown({
  byDepartment,
  total,
}: {
  byDepartment: Record<string, { amount: number; count: number }>;
  total: number;
}) {
  const entries = Object.entries(byDepartment).sort(
    ([, a], [, b]) => b.amount - a.amount,
  );
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-purple-500",
    "bg-pink-500", "bg-indigo-500", "bg-red-500", "bg-teal-500",
  ];

  return (
    <div className="bg-white rounded-lg border p-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">部門別構成</h3>
      {/* スタックバー */}
      <div className="flex rounded-full h-4 overflow-hidden mb-3">
        {entries.map(([dept, { amount }], i) => (
          <div
            key={dept}
            className={`${colors[i % colors.length]}`}
            style={{ width: `${(amount / total) * 100}%` }}
            title={`${dept}: ${yen(amount)}`}
          />
        ))}
      </div>
      {/* 凡例 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {entries.map(([dept, { amount, count }], i) => (
          <span key={dept} className="flex items-center gap-1">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${colors[i % colors.length]}`} />
            {dept}: {yen(amount)}（{count}件, {pct(amount, total)}）
          </span>
        ))}
      </div>
    </div>
  );
}

function EmployeeTable({
  employees,
  totalAmount,
  targetMonths,
  sortBy,
  onSortChange,
  selectedEmployee,
  onSelect,
}: {
  employees: EmployeeSpending[];
  totalAmount: number;
  targetMonths: string[];
  sortBy: "amount" | "count";
  onSortChange: (s: "amount" | "count") => void;
  selectedEmployee: string | null;
  onSelect: (name: string | null) => void;
}) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          従業員別ランキング（{employees.length}名）
        </h3>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => onSortChange("amount")}
            className={`px-2 py-1 rounded ${sortBy === "amount" ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-500 hover:bg-gray-100"}`}
          >
            金額順
          </button>
          <button
            onClick={() => onSortChange("count")}
            className={`px-2 py-1 rounded ${sortBy === "count" ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-500 hover:bg-gray-100"}`}
          >
            件数順
          </button>
        </div>
      </div>

      <div className="divide-y">
        {employees.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            データがありません
          </div>
        )}
        {employees.map((emp, idx) => {
          const isSelected = emp.name === selectedEmployee;
          const barWidth = totalAmount > 0 ? (emp.totalAmount / totalAmount) * 100 : 0;

          return (
            <button
              key={emp.name}
              onClick={() => onSelect(isSelected ? null : emp.name)}
              className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-5 text-right">
                    {idx + 1}
                  </span>
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {emp.name}
                    </span>
                    {emp.department && (
                      <span className="ml-2 text-xs text-gray-400">
                        {emp.department}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-gray-900">
                    {yen(emp.totalAmount)}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    {emp.count}件
                  </span>
                </div>
              </div>
              {/* ミニバー */}
              <div className="mt-1.5 ml-8">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                {/* 月別ミニスパークライン */}
                <div className="flex gap-1 mt-1 text-[10px] text-gray-400">
                  {targetMonths
                    .slice()
                    .reverse()
                    .map((m) => {
                      const d = emp.byMonth[m];
                      return (
                        <span key={m}>
                          {m.slice(5)}: {d ? yen(d.amount) : "-"}
                        </span>
                      );
                    })}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeDetail({
  employee,
  targetMonths,
  onClose,
}: {
  employee: EmployeeSpending;
  targetMonths: string[];
  onClose: () => void;
}) {
  const catEntries = Object.entries(employee.byCategory).sort(
    ([, a], [, b]) => b.amount - a.amount,
  );
  const payEntries = Object.entries(employee.byPayment).sort(
    ([, a], [, b]) => b.amount - a.amount,
  );

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-blue-50">
        <div>
          <p className="text-sm font-bold text-gray-900">{employee.name}</p>
          {employee.department && (
            <p className="text-xs text-gray-500">{employee.department}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          x
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* 合計 */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">合計</span>
          <span className="font-bold">{yen(employee.totalAmount)}（{employee.count}件）</span>
        </div>

        {/* 月別推移 */}
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">月別推移</p>
          <div className="space-y-1">
            {targetMonths
              .slice()
              .reverse()
              .map((m) => {
                const d = employee.byMonth[m];
                const maxMonth = Math.max(
                  ...targetMonths.map(
                    (tm) => employee.byMonth[tm]?.amount || 0,
                  ),
                );
                const w = d && maxMonth > 0 ? (d.amount / maxMonth) * 100 : 0;
                return (
                  <div key={m} className="flex items-center gap-2 text-xs">
                    <span className="w-10 text-gray-400">{m.slice(5)}月</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-gray-600">
                      {d ? `${yen(d.amount)}` : "-"}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 勘定科目別 */}
        {catEntries.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">
              勘定科目別
            </p>
            <div className="space-y-0.5 text-xs">
              {catEntries.map(([cat, { amount, count }]) => (
                <div key={cat} className="flex justify-between text-gray-600">
                  <span>{cat}</span>
                  <span>
                    {yen(amount)}（{count}件）
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 支払方法別 */}
        {payEntries.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">
              支払方法別
            </p>
            <div className="space-y-0.5 text-xs">
              {payEntries.map(([pay, { amount, count }]) => (
                <div key={pay} className="flex justify-between text-gray-600">
                  <span>{pay}</span>
                  <span>
                    {yen(amount)}（{count}件）
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 直近申請 */}
        {employee.requests.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">
              直近の申請
            </p>
            <div className="space-y-1 text-xs max-h-60 overflow-y-auto">
              {employee.requests.map((r) => (
                <div
                  key={r.prNumber}
                  className="flex justify-between text-gray-600 py-0.5 border-b border-gray-50"
                >
                  <div className="truncate flex-1 mr-2">
                    <span className="text-gray-400">{r.date?.slice(5)}</span>{" "}
                    {r.item}
                  </div>
                  <span className="whitespace-nowrap font-medium">
                    {yen(r.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface Contract {
  id: string;
  contract_number: string;
  category: string;
  vendor_name: string;
  monthly_amount: number | null;
  annual_amount: number | null;
  contract_start_date: string;
  contract_end_date: string | null;
  is_active: boolean;
  billing_type: string;
  renewal_type: string;
}

export default function ContractsPage() {
  const user = useUser();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/admin/contracts");
        if (!res.ok) throw new Error("取得に失敗しました");
        const data = await res.json();
        setContracts(data.contracts || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold mb-2">アクセス権限がありません</p>
          <p className="text-sm text-red-600">このページは管理本部のみ閲覧できます。</p>
          <a href="/dashboard" className="mt-4 inline-block text-sm text-blue-600 hover:underline">ダッシュボードに戻る</a>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-gray-500 animate-pulse">読み込み中...</div>;
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  const filtered = contracts.filter((c) => {
    if (filter === "active") return c.is_active;
    if (filter === "inactive") return !c.is_active;
    return true;
  });

  const activeContracts = contracts.filter((c) => c.is_active);
  const totalMonthly = activeContracts.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);

  const today = new Date();
  const sixtyDaysFromNow = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);

  function isRenewalSoon(c: Contract): boolean {
    if (!c.is_active || !c.contract_end_date) return false;
    const endDate = new Date(c.contract_end_date);
    return endDate <= sixtyDaysFromNow && endDate >= today;
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ja-JP");
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">契約管理</h1>
        <a
          href="/admin/contracts/new"
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          新規契約登録
        </a>
      </div>

      {/* Summary */}
      <div className="flex gap-4 mb-4">
        <div className="bg-white border rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">有効契約数</p>
          <p className="text-lg font-bold text-gray-800">{activeContracts.length}件</p>
        </div>
        <div className="bg-white border rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">月額合計</p>
          <p className="text-lg font-bold text-gray-800">&yen;{totalMonthly.toLocaleString()}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {([
          { key: "active", label: "契約中" },
          { key: "inactive", label: "終了" },
          { key: "all", label: "すべて" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-lg ${
              filter === tab.key
                ? "bg-blue-100 text-blue-700 font-medium"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">契約番号</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">カテゴリ</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">取引先</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">月額</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">契約期間</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => { window.location.href = `/admin/contracts/${c.id}`; }}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.contract_number}</td>
                  <td className="px-4 py-3 text-gray-700">{c.category}</td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{c.vendor_name}</td>
                  <td className="px-4 py-3 text-right text-gray-800">
                    {c.monthly_amount != null ? `\u00a5${c.monthly_amount.toLocaleString()}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {formatDate(c.contract_start_date)} ~ {formatDate(c.contract_end_date)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                      c.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {c.is_active ? "契約中" : "終了"}
                    </span>
                    {isRenewalSoon(c) && (
                      <span className="ml-1 inline-block text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                        更新間近
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-8">該当する契約がありません</div>
        )}
      </div>
    </div>
  );
}

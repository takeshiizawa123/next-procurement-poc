"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface Candidate {
  accountId: number;
  accountName: string;
  counterpartyId: number;
  counterpartyName: string;
  monthsActive: number;
  totalMonths: number;
  monthlyAmounts: Array<{ month: string; amount: number; count: number }>;
  avgMonthlyAmount: number;
  minAmount: number;
  maxAmount: number;
  variationPct: number;
  billingType: "固定" | "従量" | "カード自動";
  category: string;
  accountTitle: string;
  totalAmount: number;
}

interface Result {
  ok: boolean;
  period: { from: string; to: string; months: number };
  threshold: { monthsRequired: number };
  totalPatterns: number;
  candidates: Candidate[];
}

function defaultMonths() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // 前月を終了月
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  d.setMonth(d.getMonth() - 2); // 3ヶ月前を開始月
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { from, to };
}

export default function ContractCandidatesPage() {
  const user = useUser();
  const defaults = defaultMonths();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<"all" | "固定" | "従量">("all");

  async function analyze() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await apiFetch(`/api/admin/contract-candidates?from=${from}&to=${to}`);
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

  function registerLink(c: Candidate): string {
    const params = new URLSearchParams({
      prefill: "1",
      category: c.category,
      billingType: c.billingType,
      supplierName: c.counterpartyName,
      accountTitle: c.accountTitle,
      monthlyAmount: String(c.avgMonthlyAmount),
      department: "管理本部", // デフォルト
    });
    return `/admin/contracts/new?${params}`;
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

  const filteredCandidates = data
    ? data.candidates.filter((c) => selectedFilter === "all" || c.billingType === selectedFilter)
    : [];

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold mb-4">継続契約 登録候補リスト</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
        💡 MF会計Plusの過去仕訳から「同じ取引先 × 同じ勘定科目」が繰り返し発生しているパターンを抽出。<br />
        これらを契約マスタに登録すれば、月次の見積計上・仕訳登録が自動化できます。
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
        <button onClick={analyze} disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? "分析中（取得に時間かかります）…" : "候補を抽出"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      {data && (
        <>
          <div className="bg-white border rounded-xl p-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <span>期間: <strong>{data.period.from} 〜 {data.period.to}</strong> ({data.period.months}ヶ月)</span>
              <span>|</span>
              <span>対象ペア: {data.totalPatterns}件</span>
              <span>|</span>
              <span>候補（{data.threshold.monthsRequired}ヶ月以上発生）: <strong className="text-blue-600">{data.candidates.length}件</strong></span>
              <span className="flex-1" />
              <div className="flex gap-1">
                {(["all", "固定", "従量"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSelectedFilter(f)}
                    className={`text-xs px-2 py-1 rounded ${
                      selectedFilter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {f === "all" ? "全件" : f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="bg-white border rounded-xl p-6 text-center text-gray-400">
              該当する候補なし
            </div>
          ) : (
            <div className="bg-white border rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium">取引先</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">勘定科目</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">カテゴリ</th>
                    <th className="px-3 py-2 text-center text-xs font-medium">請求タイプ</th>
                    <th className="px-3 py-2 text-center text-xs font-medium">発生月</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">月平均</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">変動</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">合計</th>
                    <th className="px-3 py-2 text-center text-xs font-medium">アクション</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((c, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{c.counterpartyName}</td>
                      <td className="px-3 py-2 text-xs">{c.accountName}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">{c.category}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          c.billingType === "固定" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                        }`}>
                          {c.billingType}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {c.monthsActive}/{c.totalMonths}
                      </td>
                      <td className="px-3 py-2 text-right">¥{c.avgMonthlyAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <span className={c.variationPct > 10 ? "text-orange-600" : "text-gray-500"}>
                          {c.variationPct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">¥{c.totalAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <a
                          href={registerLink(c)}
                          className="inline-block text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          契約登録
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

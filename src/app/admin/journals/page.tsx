"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

interface PurchaseRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  department: string;
  approvalStatus: string;
  orderStatus: string;
  inspectionStatus: string;
  voucherStatus: string;
  accountTitle: string;
  paymentMethod: string;
  slackLink: string;
}

type Tab = "pending" | "registered";

export default function JournalManagement() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [registering, setRegistering] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [bulkRegistering, setBulkRegistering] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch("/api/purchase/recent?limit=100")
      .then((r) => r.json())
      .then((d: { requests?: PurchaseRequest[] }) => setRequests(d.requests || []))
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 仕訳待ち: 証憑完了 & 未計上
  const pending = requests.filter((r) =>
    r.voucherStatus === "添付済" &&
    r.inspectionStatus === "検収済" &&
    r.approvalStatus === "承認済" &&
    !results[r.prNumber]?.ok
  );

  // 計上済み
  const registered = requests.filter((r) =>
    results[r.prNumber]?.ok ||
    (r as unknown as Record<string, string>)["仕訳ステータス"] === "計上済"
  );

  const displayed = tab === "pending" ? pending : registered;

  // 仕訳登録（単件）
  const registerJournal = async (prNumber: string) => {
    setRegistering((prev) => ({ ...prev, [prNumber]: true }));
    try {
      const res = await apiFetch("/api/mf/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResults((prev) => ({ ...prev, [prNumber]: { ok: true, message: `MF仕訳ID: ${data.journalId}` } }));
      } else {
        setResults((prev) => ({ ...prev, [prNumber]: { ok: false, message: data.error || "登録に失敗しました" } }));
      }
    } catch {
      setResults((prev) => ({ ...prev, [prNumber]: { ok: false, message: "通信エラー" } }));
    } finally {
      setRegistering((prev) => ({ ...prev, [prNumber]: false }));
    }
  };

  // 仕訳一括登録
  const registerAll = async () => {
    if (!confirm(`仕訳待ち ${pending.length}件 を一括登録します。よろしいですか？`)) return;
    setBulkRegistering(true);
    for (const r of pending) {
      if (results[r.prNumber]?.ok) continue;
      await registerJournal(r.prNumber);
    }
    setBulkRegistering(false);
  };

  const totalPendingAmount = pending.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-800 text-sm">← ダッシュボード</a>
            <h1 className="text-lg font-bold">仕訳管理</h1>
          </div>
          <button onClick={fetchData} className="text-sm text-gray-500 hover:text-gray-700">
            更新
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm text-red-800">{error}</span>
            <button onClick={fetchData} className="text-sm text-red-600 underline">再読み込み</button>
          </div>
        )}

        {/* サマリーカード */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{pending.length}</div>
            <div className="text-xs text-gray-500">仕訳待ち</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{Object.values(results).filter((r) => r.ok).length}</div>
            <div className="text-xs text-gray-500">今回登録済み</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-gray-800">¥{totalPendingAmount.toLocaleString()}</div>
            <div className="text-xs text-gray-500">仕訳待ち金額</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{Object.values(results).filter((r) => !r.ok).length}</div>
            <div className="text-xs text-gray-500">エラー</div>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab("pending")}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "pending" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}
          >
            仕訳待ち（{pending.length}）
          </button>
          <button
            onClick={() => setTab("registered")}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "registered" ? "bg-green-100 text-green-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}
          >
            登録済み（{Object.values(results).filter((r) => r.ok).length}）
          </button>
        </div>

        {/* 一括登録ボタン */}
        {tab === "pending" && pending.length > 0 && (
          <div className="mb-4">
            <button
              onClick={registerAll}
              disabled={bulkRegistering}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {bulkRegistering ? "登録中..." : `全${pending.length}件を一括登録`}
            </button>
          </div>
        )}

        {/* テーブル */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">読み込み中...</div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {tab === "pending" ? "仕訳待ちの案件はありません" : "登録済みの案件はありません"}
          </div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left">
                    <th className="px-4 py-2.5 font-medium text-gray-600">PO番号</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">品目</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600 text-right">金額</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">勘定科目</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">支払方法</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">申請者</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => {
                    const result = results[r.prNumber];
                    const isRegistering = registering[r.prNumber];
                    return (
                      <tr key={r.prNumber} className={`border-b last:border-0 hover:bg-gray-50 ${result?.ok ? "bg-green-50" : result && !result.ok ? "bg-red-50" : ""}`}>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {r.slackLink ? (
                            <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{r.prNumber}</a>
                          ) : r.prNumber}
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate">{r.itemName}</td>
                        <td className="px-4 py-2.5 text-right font-mono">¥{r.totalAmount.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-xs">{r.accountTitle || "—"}</td>
                        <td className="px-4 py-2.5 text-xs">{r.paymentMethod}</td>
                        <td className="px-4 py-2.5 text-xs">{r.applicant}（{r.department}）</td>
                        <td className="px-4 py-2.5 text-center">
                          {result?.ok ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">{result.message}</span>
                          ) : result && !result.ok ? (
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-xs text-red-600">{result.message}</span>
                              <button onClick={() => registerJournal(r.prNumber)} className="text-xs text-red-600 underline">再試行</button>
                            </div>
                          ) : tab === "pending" ? (
                            <button
                              onClick={() => registerJournal(r.prNumber)}
                              disabled={isRegistering}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
                            >
                              {isRegistering ? "登録中..." : "仕訳登録"}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

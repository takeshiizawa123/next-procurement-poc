"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";
import { useParams } from "next/navigation";

interface Contract {
  id: string;
  contract_number: string;
  category: string;
  billing_type: string;
  vendor_name: string;
  monthly_amount: number | null;
  annual_amount: number | null;
  budget_limit: number | null;
  contract_start_date: string;
  contract_end_date: string | null;
  renewal_type: string;
  account_title: string;
  department: string;
  notes: string | null;
  auto_approve_fixed: boolean;
  is_active: boolean;
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_month: string;
  expected_amount: number | null;
  actual_amount: number | null;
  difference: number | null;
  status: "未受領" | "受領済" | "承認済" | "仕訳済";
  voucher_url: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  "未受領": "bg-gray-100 text-gray-600",
  "受領済": "bg-blue-100 text-blue-700",
  "承認済": "bg-green-100 text-green-700",
  "仕訳済": "bg-purple-100 text-purple-700",
};

export default function ContractDetailPage() {
  const user = useUser();
  const params = useParams();
  const contractId = params.id as string;

  const [contract, setContract] = useState<Contract | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // New invoice form
  const [newMonth, setNewMonth] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/contracts/${contractId}`);
        if (!res.ok) throw new Error("取得に失敗しました");
        const data = await res.json();
        setContract(data.contract);
        setInvoices(data.invoices || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId]);

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

  if (error || !contract) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-red-700">{error || "契約が見つかりません"}</p>
          <a href="/admin/contracts" className="mt-2 inline-block text-sm text-blue-600 hover:underline">一覧に戻る</a>
        </div>
      </div>
    );
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ja-JP");
  }

  function formatAmount(amount: number | null): string {
    if (amount == null) return "-";
    return `\u00a5${amount.toLocaleString()}`;
  }

  async function handleTerminate() {
    if (!confirm("この契約を終了しますか？")) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await apiFetch(`/api/admin/contracts/${contractId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      setContract((prev) => prev ? { ...prev, is_active: false } : prev);
      setActionResult({ type: "success", message: "契約を終了しました" });
    } catch (e) {
      setActionResult({ type: "error", message: e instanceof Error ? e.message : "通信エラー" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApproveInvoice(invoiceId: string) {
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await apiFetch(`/api/admin/contracts/${contractId}/invoices/${invoiceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "承認済" }),
      });
      if (!res.ok) throw new Error("承認に失敗しました");
      setInvoices((prev) =>
        prev.map((inv) => inv.id === invoiceId ? { ...inv, status: "承認済" } : inv)
      );
      setActionResult({ type: "success", message: "請求を承認しました" });
    } catch (e) {
      setActionResult({ type: "error", message: e instanceof Error ? e.message : "通信エラー" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!newMonth) return;
    setInvoiceSubmitting(true);
    setActionResult(null);
    try {
      const formData = new FormData();
      formData.append("invoice_month", newMonth);
      if (newAmount) formData.append("actual_amount", newAmount);
      if (newFile) formData.append("file", newFile);

      const res = await apiFetch(`/api/admin/contracts/${contractId}/invoices`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("登録に失敗しました");
      const data = await res.json();
      setInvoices((prev) => [data.invoice, ...prev]);
      setNewMonth("");
      setNewAmount("");
      setNewFile(null);
      setActionResult({ type: "success", message: "請求を登録しました" });
    } catch (e) {
      setActionResult({ type: "error", message: e instanceof Error ? e.message : "通信エラー" });
    } finally {
      setInvoiceSubmitting(false);
    }
  }

  const detailRows = [
    { label: "契約番号", value: contract.contract_number },
    { label: "カテゴリ", value: contract.category },
    { label: "請求タイプ", value: contract.billing_type },
    { label: "取引先", value: contract.vendor_name },
    { label: "月額", value: formatAmount(contract.monthly_amount) },
    { label: "年額", value: formatAmount(contract.annual_amount) },
    { label: "予算上限", value: formatAmount(contract.budget_limit) },
    { label: "契約開始日", value: formatDate(contract.contract_start_date) },
    { label: "契約終了日", value: formatDate(contract.contract_end_date) },
    { label: "更新タイプ", value: contract.renewal_type },
    { label: "勘定科目", value: contract.account_title },
    { label: "部門", value: contract.department },
    { label: "自動承認", value: contract.auto_approve_fixed ? "有効" : "無効" },
    { label: "登録日", value: formatDate(contract.created_at) },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/contracts" className="text-sm text-gray-400 hover:text-gray-600">&larr; 一覧</a>
        <h1 className="text-xl font-bold">{contract.vendor_name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          contract.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
        }`}>
          {contract.is_active ? "契約中" : "終了"}
        </span>
      </div>

      {actionResult && (
        <div className={`mb-4 text-sm px-4 py-2 rounded-xl ${
          actionResult.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {actionResult.message}
        </div>
      )}

      {/* Contract details */}
      <div className="bg-white border rounded-xl p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">契約情報</h2>
          <div className="flex gap-2">
            <a
              href={`/admin/contracts/${contractId}/edit`}
              className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 hover:bg-gray-50"
            >
              編集
            </a>
            {contract.is_active && (
              <button
                onClick={handleTerminate}
                disabled={actionLoading}
                className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {actionLoading ? "処理中..." : "契約終了"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {detailRows.map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">{row.label}</span>
              <span className="text-sm text-gray-800">{row.value}</span>
            </div>
          ))}
        </div>

        {contract.notes && (
          <div className="mt-4 pt-4 border-t">
            <span className="text-xs text-gray-500">備考</span>
            <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{contract.notes}</p>
          </div>
        )}
      </div>

      {/* Invoices section */}
      <div className="bg-white border rounded-xl p-4 sm:p-6">
        <h2 className="font-bold text-gray-800 mb-4">月次請求</h2>

        {/* New invoice form */}
        <form onSubmit={handleAddInvoice} className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">請求月</label>
              <input
                type="month"
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">請求額</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm text-gray-400">&yen;</span>
                <input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="border rounded-lg pl-7 pr-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">証憑ファイル</label>
              <input
                type="file"
                onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                className="text-sm text-gray-600"
                accept=".pdf,.png,.jpg,.jpeg"
              />
            </div>
            <button
              type="submit"
              disabled={invoiceSubmitting || !newMonth}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {invoiceSubmitting ? "登録中..." : "請求登録"}
            </button>
          </div>
        </form>

        {/* Invoice table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">請求月</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">予定額</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">請求額</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">差額</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 text-gray-700">{inv.invoice_month}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatAmount(inv.expected_amount)}</td>
                  <td className="px-4 py-3 text-right text-gray-800">{formatAmount(inv.actual_amount)}</td>
                  <td className={`px-4 py-3 text-right ${
                    inv.difference != null && inv.difference !== 0
                      ? inv.difference > 0 ? "text-red-600" : "text-green-600"
                      : "text-gray-400"
                  }`}>
                    {inv.difference != null ? `${inv.difference > 0 ? "+" : ""}${formatAmount(inv.difference)}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[inv.status] || "bg-gray-100 text-gray-600"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {(inv.status === "未受領" || inv.status === "受領済") && (
                        <button
                          onClick={() => handleApproveInvoice(inv.id)}
                          disabled={actionLoading}
                          className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded hover:bg-green-50 disabled:opacity-50"
                        >
                          承認
                        </button>
                      )}
                      {inv.voucher_url && (
                        <a
                          href={inv.voucher_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          証憑
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {invoices.length === 0 && (
          <div className="text-center text-gray-400 py-6">請求データがありません</div>
        )}
      </div>
    </div>
  );
}

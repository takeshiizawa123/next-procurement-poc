"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

interface Contract {
  id: number;
  contractNumber: string;
  category: string;
  supplierName: string;
  monthlyAmount: number | null;
  accountTitle: string;
  department: string;
  isActive: boolean;
}

interface ContractInvoice {
  id: number;
  contractId: number;
  billingMonth: string;
  invoiceAmount: number | null;
  expectedAmount: number | null;
  amountDiff: number | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  journalId: number | null;
  voucherFileUrl: string | null;
}

interface MfMasters {
  accounts: { code: string | null; name: string }[];
  taxes: { code: string | null; name: string }[];
  departments: { code: string | null; name: string }[];
  counterparties: { code: string | null; name: string }[];
}

interface Props {
  masters: MfMasters | null;
}

/**
 * 契約仕訳タブ — 承認済み請求書からMF会計Plus仕訳を登録
 */
export default function ContractJournalTab({ masters }: Props) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Record<number, ContractInvoice[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // アクティブな契約を取得
      const cRes = await apiFetch("/api/admin/contracts?active=true");
      const cData = await cRes.json();
      if (!cData.ok) throw new Error(cData.error || "契約取得失敗");
      setContracts(cData.contracts || []);

      // 各契約の当月請求書を取得
      const invoiceMap: Record<number, ContractInvoice[]> = {};
      for (const c of (cData.contracts || []) as Contract[]) {
        try {
          const iRes = await apiFetch(`/api/admin/contracts/${c.id}/invoices?month=${selectedMonth}`);
          const iData = await iRes.json();
          if (iData.ok && iData.invoices?.length > 0) {
            invoiceMap[c.id] = iData.invoices;
          }
        } catch { /* 個別エラーは無視 */ }
      }
      setInvoices(invoiceMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 仕訳登録（承認済み請求書 → MF会計Plus）
  const registerJournal = async (contract: Contract, invoice: ContractInvoice) => {
    const invKey = invoice.id;
    setRegistering((prev) => ({ ...prev, [invKey]: true }));
    try {
      const amount = invoice.invoiceAmount || invoice.expectedAmount || contract.monthlyAmount || 0;
      const res = await apiFetch("/api/mf/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prNumber: contract.contractNumber,
          overrides: {
            debitAccount: contract.accountTitle,
            department: contract.department,
            memo: `${invoice.billingMonth.replace("-", "/")} ${contract.contractNumber} ${contract.supplierName}`,
          },
          // 契約仕訳用の追加フィールド
          contractJournal: {
            contractId: contract.id,
            invoiceId: invoice.id,
            amount,
            supplierName: contract.supplierName,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResults((prev) => ({ ...prev, [invKey]: { ok: true, message: `MF仕訳ID: ${data.journalId}` } }));
        // 請求書ステータスを更新
        await apiFetch(`/api/admin/contracts/${contract.id}/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            billingMonth: invoice.billingMonth,
            invoiceAmount: amount,
            status: "仕訳済",
            journalId: data.journalId,
          }),
        });
        fetchData(); // リフレッシュ
      } else {
        setResults((prev) => ({ ...prev, [invKey]: { ok: false, message: data.error || "登録失敗" } }));
      }
    } catch (e) {
      setResults((prev) => ({ ...prev, [invKey]: { ok: false, message: "通信エラー" } }));
    } finally {
      setRegistering((prev) => ({ ...prev, [invKey]: false }));
    }
  };

  // 承認済み or 見積計上の請求書がある契約のみ表示
  const journalReady = contracts.filter((c) => {
    const invs = invoices[c.id];
    if (!invs) return false;
    return invs.some((i) => i.status === "承認済" || i.status === "見積計上");
  });

  const journalDone = contracts.filter((c) => {
    const invs = invoices[c.id];
    if (!invs) return false;
    return invs.some((i) => i.status === "仕訳済");
  });

  if (loading) {
    return <div className="text-center py-12 text-gray-400">契約データ読み込み中...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-lg">
        {error}
        <button onClick={fetchData} className="ml-3 text-red-600 underline">再試行</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 月選択 */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600" htmlFor="contract-month">対象月:</label>
        <input
          id="contract-month"
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm"
        />
        <span className="text-xs text-gray-400">
          仕訳待ち: {journalReady.length}件 / 登録済み: {journalDone.length}件
        </span>
      </div>

      {journalReady.length === 0 && journalDone.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {selectedMonth} の契約仕訳対象はありません
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-3 py-2.5 font-medium text-gray-600">契約番号</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">カテゴリ</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">取引先</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">勘定科目</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600 text-right">金額</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">ステータス</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {[...journalReady, ...journalDone].map((c) => {
                  const invs = invoices[c.id] || [];
                  const inv = invs[0];
                  if (!inv) return null;
                  const amount = inv.invoiceAmount || inv.expectedAmount || c.monthlyAmount || 0;
                  const result = results[inv.id];
                  const isReg = registering[inv.id] || false;

                  return (
                    <tr key={c.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-xs font-mono">{c.contractNumber}</td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700">{c.category}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{c.supplierName}</td>
                      <td className="px-3 py-2.5 text-xs">{c.accountTitle}</td>
                      <td className="px-3 py-2.5 text-xs text-right font-medium">
                        ¥{amount.toLocaleString()}
                        {inv.amountDiff && inv.amountDiff !== 0 && (
                          <span className={`ml-1 text-[10px] ${inv.amountDiff > 0 ? "text-red-500" : "text-green-500"}`}>
                            ({inv.amountDiff > 0 ? "+" : ""}{inv.amountDiff.toLocaleString()})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          inv.status === "仕訳済" ? "bg-green-100 text-green-700" :
                          inv.status === "承認済" ? "bg-blue-100 text-blue-700" :
                          inv.status === "見積計上" ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {result?.ok ? (
                          <span className="text-xs text-green-700">{result.message}</span>
                        ) : result && !result.ok ? (
                          <span className="text-xs text-red-600">{result.message}</span>
                        ) : inv.status === "仕訳済" ? (
                          <span className="text-xs text-gray-400">MF仕訳ID: {inv.journalId}</span>
                        ) : (inv.status === "承認済" || inv.status === "見積計上") ? (
                          <button
                            onClick={() => registerJournal(c, inv)}
                            disabled={isReg}
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            {isReg ? "登録中..." : "仕訳登録"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

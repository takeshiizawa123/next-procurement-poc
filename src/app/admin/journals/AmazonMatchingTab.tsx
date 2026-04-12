"use client";

import { useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  parseAmazonCsv,
  executeAmazonMatching,
  type AmazonOrderLine,
  type AmazonMatchResult,
  type AmazonConfidentMatch,
  type PurchaseRequestForMatch,
} from "@/lib/amazon-matcher";

interface PurchaseRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  department: string;
  paymentMethod: string;
}

type SubTab = "matched" | "candidates" | "unmatched_orders" | "unmatched_requests";

export default function AmazonMatchingTab({ requests }: { requests: PurchaseRequest[] }) {
  const [orders, setOrders] = useState<AmazonOrderLine[]>([]);
  const [result, setResult] = useState<AmazonMatchResult | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("matched");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 操作状態
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savedInvoices, setSavedInvoices] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState<Record<string, boolean>>({});
  const [notified, setNotified] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState("");

  const handleCsvLoad = useCallback((text: string) => {
    const parsed = parseAmazonCsv(text);
    setOrders(parsed);
    setResult(null);
    setSavedInvoices(new Set());
    setNotified(new Set());
    setActionMessage("");
  }, []);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvLoad(ev.target?.result as string);
    reader.readAsText(file, "UTF-8");
  }, [handleCsvLoad]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) handleFile(file);
  }, [handleFile]);

  const runMatching = useCallback(async () => {
    const reqs: PurchaseRequestForMatch[] = requests.map((r) => ({
      prNumber: r.prNumber,
      applicationDate: r.applicationDate,
      itemName: r.itemName,
      totalAmount: r.totalAmount,
      supplierName: r.supplierName,
      applicant: r.applicant,
      department: r.department,
      paymentMethod: r.paymentMethod,
    }));
    const res = executeAmazonMatching(orders, reqs);
    setResult(res);
    setSubTab("matched");

    // Slack #管理本部 にサマリ投稿 + 差額アラート（±5,000円超）
    const DIFF_THRESHOLD = 5000;
    const diffAlerts = res.matched
      .filter((m) => Math.abs(m.amountDiff) > DIFF_THRESHOLD)
      .map((m) => ({
        prNumber: m.request.prNumber,
        itemName: m.request.itemName,
        requestAmount: m.request.totalAmount,
        amazonAmount: m.order.lineTotal,
        diff: m.amountDiff,
      }));

    const dr = orders.length > 0
      ? `${orders[orders.length - 1].orderDate} ~ ${orders[0].orderDate}`
      : undefined;

    apiFetch("/api/admin/amazon-matching/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: res.summary, diffAlerts, dateRange: dr }),
    }).catch((e) => console.warn("[amazon-matching] Slack summary failed:", e));
  }, [orders, requests]);

  // --- 機能1: CSVエクスポート ---
  const exportCsv = useCallback(() => {
    if (!result) return;
    const BOM = "\uFEFF";
    const header = "照合結果,購買番号,品目（申請）,商品名（Amazon）,注文番号,申請額,Amazon額,差額,出品者,適格番号,スコア,購入者,注文日";
    const rows: string[] = [];

    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;

    for (const m of result.matched) {
      rows.push([
        "一致", m.request.prNumber, esc(m.request.itemName), esc(m.order.productName),
        m.order.orderNumber, m.request.totalAmount, m.order.lineTotal, m.amountDiff,
        esc(m.order.sellerName), m.order.invoiceRegNumber || "", m.score,
        esc(m.order.buyerName), m.order.orderDate,
      ].join(","));
    }
    for (const c of result.candidates) {
      for (const cand of c.candidates) {
        rows.push([
          "要確認", cand.request.prNumber, esc(cand.request.itemName), esc(c.order.productName),
          c.order.orderNumber, cand.request.totalAmount, c.order.lineTotal, cand.amountDiff,
          esc(c.order.sellerName), c.order.invoiceRegNumber || "", cand.score,
          esc(c.order.buyerName), c.order.orderDate,
        ].join(","));
      }
    }
    for (const o of result.unmatchedOrders) {
      rows.push([
        "未一致注文", "", "", esc(o.productName),
        o.orderNumber, "", o.lineTotal, "",
        esc(o.sellerName), o.invoiceRegNumber || "", "",
        esc(o.buyerName), o.orderDate,
      ].join(","));
    }
    for (const r of result.unmatchedRequests) {
      rows.push([
        "未一致申請", r.prNumber, esc(r.itemName), "",
        "", r.totalAmount, "", "",
        "", "", "",
        esc(r.applicant), r.applicationDate,
      ].join(","));
    }

    const csv = BOM + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Amazon照合_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [result]);

  // --- 機能2: 適格番号をGASに書き戻し ---
  const saveInvoiceNumbers = useCallback(async () => {
    if (!result) return;
    const targets = result.matched.filter(
      (m) => m.order.invoiceRegNumber && !savedInvoices.has(m.request.prNumber),
    );
    if (targets.length === 0) {
      setActionMessage("保存対象の適格番号がありません");
      return;
    }

    setSavingInvoice(true);
    setActionMessage("");
    let saved = 0;
    for (const m of targets) {
      try {
        const res = await apiFetch(`/api/purchase/${m.request.prNumber}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: { "適格番号": m.order.invoiceRegNumber },
          }),
        });
        if (res.ok) {
          saved++;
          setSavedInvoices((prev) => new Set(prev).add(m.request.prNumber));
        }
      } catch (e) {
        console.warn(`[amazon] Failed to save invoice for ${m.request.prNumber}:`, e);
      }
    }
    setSavingInvoice(false);
    setActionMessage(`${saved}/${targets.length}件の適格番号を保存しました`);
  }, [result, savedInvoices]);

  // --- 機能3: 未一致注文 → 購入者にSlack DM ---
  const notifyBuyer = useCallback(async (buyerName: string, buyerOrders: AmazonOrderLine[]) => {
    setNotifying((prev) => ({ ...prev, [buyerName]: true }));
    try {
      const res = await apiFetch("/api/admin/amazon-matching/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerName,
          orders: buyerOrders.map((o) => ({
            orderNumber: o.orderNumber,
            productName: o.productName,
            lineTotal: o.lineTotal,
            orderDate: o.orderDate,
          })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNotified((prev) => new Set(prev).add(buyerName));
        setActionMessage(`${data.employeeName} にDMを送信しました`);
      } else {
        setActionMessage(`送信失敗: ${data.error || "不明なエラー"}`);
      }
    } catch (e) {
      setActionMessage(`送信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setNotifying((prev) => ({ ...prev, [buyerName]: false }));
    }
  }, []);

  // 未一致注文を購入者ごとにグループ化
  const unmatchedByBuyer = result
    ? result.unmatchedOrders.reduce<Record<string, AmazonOrderLine[]>>((acc, o) => {
        const key = o.buyerName || "不明";
        (acc[key] ||= []).push(o);
        return acc;
      }, {})
    : {};

  const fmt = (n: number) => `¥${n.toLocaleString()}`;
  const diffBadge = (diff: number) => {
    if (diff === 0) return null;
    const color = diff > 0 ? "text-red-600 bg-red-50" : "text-blue-600 bg-blue-50";
    return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>{diff > 0 ? "+" : ""}{fmt(diff)}</span>;
  };

  const dateRange = orders.length > 0
    ? `${orders[orders.length - 1].orderDate} ~ ${orders[0].orderDate}`
    : "";

  // 適格番号付き一致件数
  const invoiceCount = result?.matched.filter((m) => m.order.invoiceRegNumber).length || 0;

  return (
    <div className="space-y-4">
      {/* CSVアップロード */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
        <p className="text-gray-500 mb-2">
          Amazonビジネス注文履歴CSVをドラッグ&ドロップ、または
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          ファイルを選択
        </button>
        {fileName && (
          <p className="mt-2 text-sm text-gray-600">{fileName} ({orders.length}件の注文行)</p>
        )}
      </div>

      {/* パース結果サマリ + 照合実行 */}
      {orders.length > 0 && !result && (
        <div className="flex items-center justify-between bg-white border rounded-lg px-4 py-3">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{orders.length}</span>件の注文行を読み込み
            {dateRange && <span className="ml-3 text-gray-400">{dateRange}</span>}
          </div>
          <button
            onClick={runMatching}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            照合実行
          </button>
        </div>
      )}

      {/* 照合結果 */}
      {result && (
        <>
          {/* サマリ + アクションボタン */}
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard label="一致" count={result.summary.matchedCount} color="green" />
            <SummaryCard label="要確認" count={result.summary.candidateCount} color="amber" />
            <SummaryCard label="未一致注文" count={result.summary.unmatchedOrderCount} color="red" />
            <SummaryCard label="未一致申請" count={result.summary.unmatchedRequestCount} color="gray" />
          </div>

          {/* アクションバー */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
            >
              CSVエクスポート
            </button>
            {invoiceCount > 0 && (
              <button
                onClick={saveInvoiceNumbers}
                disabled={savingInvoice}
                className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {savingInvoice ? "保存中..." : `適格番号を保存（${invoiceCount}件）`}
              </button>
            )}
            {actionMessage && (
              <span className="text-sm text-gray-600">{actionMessage}</span>
            )}
          </div>

          {/* サブタブ */}
          <div className="flex gap-1">
            {([
              ["matched", "一致", result.matched.length, "green"],
              ["candidates", "要確認", result.candidates.length, "amber"],
              ["unmatched_orders", "未一致注文", result.unmatchedOrders.length, "red"],
              ["unmatched_requests", "未一致申請", result.unmatchedRequests.length, "gray"],
            ] as const).map(([key, label, count, color]) => (
              <button
                key={key}
                onClick={() => setSubTab(key as SubTab)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${subTab === key ? `bg-${color}-100 text-${color}-800` : "bg-white text-gray-600 hover:bg-gray-100"}`}
              >
                {label}（{count}）
              </button>
            ))}
          </div>

          {/* 結果テーブル */}
          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              {subTab === "matched" && <MatchedTable matched={result.matched} fmt={fmt} diffBadge={diffBadge} savedInvoices={savedInvoices} />}

              {subTab === "candidates" && (
                <div className="divide-y">
                  {result.candidates.map((c) => (
                    <div key={c.order.id} className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-gray-500">{c.order.orderNumber}</span>
                        <span className="font-medium text-sm">{c.order.productName}</span>
                        <span className="text-sm text-gray-500">{fmt(c.order.lineTotal)}</span>
                        <span className="text-xs text-gray-400">{c.order.orderDate}</span>
                      </div>
                      <div className="ml-4 space-y-1">
                        {c.candidates.map((cand, ci) => (
                          <div key={ci} className="flex items-center gap-3 text-sm p-2 rounded bg-gray-50">
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">{cand.score}</span>
                            <span className="font-mono text-xs">{cand.request.prNumber}</span>
                            <span className="truncate max-w-[200px]">{cand.request.itemName}</span>
                            <span>{fmt(cand.request.totalAmount)}</span>
                            {diffBadge(cand.amountDiff)}
                            <span className="text-gray-400 text-xs">{cand.request.applicant}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {result.candidates.length === 0 && (
                    <div className="p-8 text-center text-gray-400">要確認の項目はありません</div>
                  )}
                </div>
              )}

              {subTab === "unmatched_orders" && (
                <div>
                  {Object.entries(unmatchedByBuyer).map(([buyer, buyerOrders]) => (
                    <div key={buyer} className="border-b last:border-b-0">
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                        <span className="text-sm font-medium">{buyer}（{buyerOrders.length}件）</span>
                        <button
                          onClick={() => notifyBuyer(buyer, buyerOrders)}
                          disabled={notifying[buyer] || notified.has(buyer)}
                          className={`px-3 py-1 text-xs rounded-lg font-medium ${
                            notified.has(buyer)
                              ? "bg-green-100 text-green-700"
                              : "bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300"
                          }`}
                        >
                          {notified.has(buyer) ? "送信済み" : notifying[buyer] ? "送信中..." : "事後申請依頼を送信"}
                        </button>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {buyerOrders.map((o) => (
                            <tr key={o.id} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-2 text-xs text-gray-500">{o.orderDate}</td>
                              <td className="px-3 py-2 font-mono text-xs">{o.orderNumber}</td>
                              <td className="px-3 py-2 max-w-[300px] truncate" title={o.productName}>{o.productName}</td>
                              <td className="px-3 py-2 text-right">{fmt(o.lineTotal)}</td>
                              <td className="px-3 py-2 text-xs">{o.sellerName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {result.unmatchedOrders.length === 0 && (
                    <div className="p-8 text-center text-gray-400">すべての注文が一致しました</div>
                  )}
                </div>
              )}

              {subTab === "unmatched_requests" && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-left">
                      <th className="px-3 py-2.5 font-medium text-gray-600">購買番号</th>
                      <th className="px-3 py-2.5 font-medium text-gray-600">申請日</th>
                      <th className="px-3 py-2.5 font-medium text-gray-600">品目</th>
                      <th className="px-3 py-2.5 font-medium text-gray-600 text-right">金額</th>
                      <th className="px-3 py-2.5 font-medium text-gray-600">申請者</th>
                      <th className="px-3 py-2.5 font-medium text-gray-600">部門</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatchedRequests.map((r) => (
                      <tr key={r.prNumber} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs">{r.prNumber}</td>
                        <td className="px-3 py-2 text-xs">{r.applicationDate}</td>
                        <td className="px-3 py-2 max-w-[300px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2 text-right">{fmt(r.totalAmount)}</td>
                        <td className="px-3 py-2 text-xs">{r.applicant}</td>
                        <td className="px-3 py-2 text-xs">{r.department}</td>
                      </tr>
                    ))}
                    {result.unmatchedRequests.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">すべての申請が一致しました</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- サブコンポーネント ---

function MatchedTable({
  matched, fmt, diffBadge, savedInvoices,
}: {
  matched: AmazonConfidentMatch[];
  fmt: (n: number) => string;
  diffBadge: (diff: number) => React.ReactNode;
  savedInvoices: Set<string>;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b text-left">
          <th className="px-3 py-2.5 font-medium text-gray-600">購買番号</th>
          <th className="px-3 py-2.5 font-medium text-gray-600">品目（申請）</th>
          <th className="px-3 py-2.5 font-medium text-gray-600">商品名（Amazon）</th>
          <th className="px-3 py-2.5 font-medium text-gray-600 text-right">申請額</th>
          <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Amazon額</th>
          <th className="px-3 py-2.5 font-medium text-gray-600">差額</th>
          <th className="px-3 py-2.5 font-medium text-gray-600">出品者</th>
          <th className="px-3 py-2.5 font-medium text-gray-600">適格</th>
          <th className="px-3 py-2.5 font-medium text-gray-600 text-center">スコア</th>
        </tr>
      </thead>
      <tbody>
        {matched.map((m) => (
          <tr key={m.order.id} className={`border-b hover:bg-gray-50 ${m.amountDiff !== 0 ? "bg-amber-50/50" : ""}`}>
            <td className="px-3 py-2 font-mono text-xs">{m.request.prNumber}</td>
            <td className="px-3 py-2 max-w-[200px] truncate" title={m.request.itemName}>{m.request.itemName}</td>
            <td className="px-3 py-2 max-w-[200px] truncate" title={m.order.productName}>{m.order.productName}</td>
            <td className="px-3 py-2 text-right">{fmt(m.request.totalAmount)}</td>
            <td className="px-3 py-2 text-right">{fmt(m.order.lineTotal)}</td>
            <td className="px-3 py-2">{diffBadge(m.amountDiff)}</td>
            <td className="px-3 py-2 text-xs">{m.order.sellerName}</td>
            <td className="px-3 py-2">
              {m.order.invoiceRegNumber ? (
                <span className={`text-xs ${savedInvoices.has(m.request.prNumber) ? "text-green-600 font-medium" : "text-green-600"}`}
                  title={m.order.invoiceRegNumber}>
                  {savedInvoices.has(m.request.prNumber) ? "T (saved)" : "T"}
                </span>
              ) : (
                <span className="text-gray-300 text-xs">-</span>
              )}
            </td>
            <td className="px-3 py-2 text-center">
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">{m.score}</span>
            </td>
          </tr>
        ))}
        {matched.length === 0 && (
          <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">一致する項目はありません</td></tr>
        )}
      </tbody>
    </table>
  );
}

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    green: "bg-green-50 text-green-700 border-green-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return (
    <div className={`border rounded-lg px-4 py-3 ${colorMap[color] || colorMap.gray}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

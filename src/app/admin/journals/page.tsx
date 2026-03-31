"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

// --- 定数 ---

const DEBIT_ACCOUNTS = [
  "消耗品費", "備品消耗品費", "事務用消耗品費", "工具器具備品", "ソフトウェア",
  "外注費", "業務委託費", "広告宣伝費", "旅費交通費", "通信費",
  "地代家賃", "雑費", "研究開発費", "管理諸費", "会議費",
  "接待交際費", "修繕費", "材料費", "材料仕入",
];

const TAX_CATEGORIES = [
  "共-課仕 10%", "共-課仕 8%", "課仕 10%", "課仕 8%", "非課税", "不課税", "対象外",
];

const DEPARTMENTS = ["営業部", "開発部", "管理本部", "製造部", "ロジスティクス"];

const CREDIT_MAP: Record<string, { account: string; sub: string }[]> = {
  "会社カード": [{ account: "未払金", sub: "MFカード:未請求" }, { account: "未払金", sub: "MFカード:請求" }],
  "請求書払い": [{ account: "買掛金", sub: "" }, { account: "未払金", sub: "" }],
  "請求書払い（前払い）": [{ account: "前払金", sub: "" }, { account: "買掛金", sub: "" }],
};

const ACCOUNT_TAX_MAP: Record<string, string> = {
  消耗品費: "共-課仕 10%", 備品消耗品費: "共-課仕 10%", 事務用消耗品費: "共-課仕 10%",
  工具器具備品: "共-課仕 10%", ソフトウェア: "共-課仕 10%", 外注費: "共-課仕 10%",
  業務委託費: "共-課仕 10%", 広告宣伝費: "共-課仕 10%", 旅費交通費: "共-課仕 10%",
  通信費: "共-課仕 10%", 地代家賃: "共-課仕 10%", 雑費: "共-課仕 10%",
  研究開発費: "課仕 10%", 管理諸費: "共-課仕 10%", 会議費: "共-課仕 10%",
  接待交際費: "共-課仕 10%", 修繕費: "共-課仕 10%", 材料費: "共-課仕 10%", 材料仕入: "共-課仕 10%",
};

function taxRate(cat: string): number {
  if (cat.includes("10%")) return 10;
  if (cat.includes("8%")) return 8;
  return 0;
}

function calcTax(amount: number, cat: string): number {
  const rate = taxRate(cat);
  return rate > 0 ? Math.floor(amount * rate / (100 + rate)) : 0;
}

function resolveCreditDefault(paymentMethod: string): { account: string; sub: string } {
  if (paymentMethod.includes("カード")) return { account: "未払金", sub: "MFカード:未請求" };
  if (paymentMethod.includes("前払")) return { account: "前払金", sub: "" };
  return { account: "買掛金", sub: "" };
}

// --- 型定義 ---

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
  hubspotInfo?: string;
  voucherType?: string;
  journalId?: string;
  remarks?: string;
}

interface JournalEdits {
  debitAccount: string;
  creditAccount: string;
  creditSubAccount: string;
  taxCategory: string;
  department: string;
  hubspotDealId: string;
  memo: string;
}

type Tab = "pending" | "registered";

// --- 仕訳明細コンポーネント ---

function JournalDetail({ r, edits, onEdit }: {
  r: PurchaseRequest;
  edits: Partial<JournalEdits>;
  onEdit: (field: keyof JournalEdits, value: string) => void;
}) {
  const debitAccount = edits.debitAccount ?? (r.accountTitle?.split("（")[0] || "消耗品費");
  const defaultCredit = resolveCreditDefault(r.paymentMethod);
  const creditAccount = edits.creditAccount ?? defaultCredit.account;
  const creditSubAccount = edits.creditSubAccount ?? defaultCredit.sub;
  const taxCat = edits.taxCategory ?? (ACCOUNT_TAX_MAP[debitAccount] || "共-課仕 10%");
  const dept = edits.department ?? r.department;
  const hubspot = edits.hubspotDealId ?? (r.hubspotInfo || "");
  const ym = r.applicationDate ? r.applicationDate.slice(0, 7).replace("-", "/") : new Date().toISOString().slice(0, 7).replace("-", "/");
  const memo = edits.memo ?? `${ym} ${r.prNumber} ${r.supplierName}`;
  const tax = calcTax(r.totalAmount, taxCat);
  const creditOptions = CREDIT_MAP[r.paymentMethod] || CREDIT_MAP["請求書払い"];
  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="bg-gray-50 px-4 py-4 border-t text-xs">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左: 仕訳プレビュー + 証憑確認 */}
        <div>
          <div className="font-medium text-gray-700 mb-2">仕訳プレビュー</div>
          <table className="w-full border text-xs">
            <thead><tr className="bg-gray-100"><th className="px-2 py-1.5 text-left">区分</th><th className="px-2 py-1.5 text-left">勘定科目</th><th className="px-2 py-1.5 text-left">補助</th><th className="px-2 py-1.5 text-right">金額</th><th className="px-2 py-1.5 text-right">消費税</th></tr></thead>
            <tbody>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-blue-700 font-medium">借方</td>
                <td className="px-2 py-1.5">{debitAccount}</td>
                <td className="px-2 py-1.5 text-gray-400">-</td>
                <td className="px-2 py-1.5 text-right">¥{r.totalAmount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500">¥{tax.toLocaleString()}</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-red-700 font-medium">貸方</td>
                <td className="px-2 py-1.5">{creditAccount}</td>
                <td className="px-2 py-1.5 text-gray-500">{creditSubAccount || "-"}</td>
                <td className="px-2 py-1.5 text-right">¥{r.totalAmount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-400">-</td>
              </tr>
            </tbody>
          </table>

          {/* 証憑確認リンク */}
          <div className="mt-3 p-2 bg-white border rounded">
            <div className="font-medium text-gray-700 mb-1">証憑確認</div>
            <div className="flex flex-wrap gap-2">
              {r.slackLink && (
                <a href={r.slackLink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100">
                  Slackスレッド
                </a>
              )}
              <span className="text-xs text-gray-500">
                {r.voucherType ? `種別: ${r.voucherType}` : "種別: —"}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Slackスレッドで添付された証憑ファイルを確認できます</p>
          </div>
        </div>

        {/* 右: 編集フォーム */}
        <div className="space-y-2">
          <div className="font-medium text-gray-700 mb-2">仕訳内容の編集</div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-gray-500 text-xs">借方科目</span>
              <select value={debitAccount}
                onChange={(e) => {
                  onEdit("debitAccount", e.target.value);
                  // 科目変更時に税区分も自動更新
                  const newTax = ACCOUNT_TAX_MAP[e.target.value];
                  if (newTax) onEdit("taxCategory", newTax);
                }}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {DEBIT_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500 text-xs">貸方科目</span>
              <select value={`${creditAccount}|${creditSubAccount}`}
                onChange={(e) => {
                  const [acc, sub] = e.target.value.split("|");
                  onEdit("creditAccount", acc);
                  onEdit("creditSubAccount", sub || "");
                }}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {creditOptions.map((o) => (
                  <option key={`${o.account}|${o.sub}`} value={`${o.account}|${o.sub}`}>
                    {o.account}{o.sub ? ` / ${o.sub}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-gray-500 text-xs">税区分</span>
              <select value={taxCat} onChange={(e) => onEdit("taxCategory", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500 text-xs">部門</span>
              <select value={dept} onChange={(e) => onEdit("department", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-gray-500 text-xs">プロジェクトコード（HubSpot案件番号）</span>
            <input type="text" value={hubspot} onChange={(e) => onEdit("hubspotDealId", e.target.value)}
              placeholder="例: HS-2026-042" className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          <label className="block">
            <span className="text-gray-500 text-xs">摘要</span>
            <input type="text" value={memo} onChange={(e) => onEdit("memo", e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          {hasEdits && (
            <p className="text-amber-600 text-xs mt-1">* 変更あり — 仕訳登録時に反映されます</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- メインコンポーネント ---

export default function JournalManagement() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [registering, setRegistering] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [bulkRegistering, setBulkRegistering] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Partial<JournalEdits>>>({});

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

  const pending = requests.filter((r) =>
    r.voucherStatus === "添付済" &&
    r.inspectionStatus === "検収済" &&
    r.approvalStatus === "承認済" &&
    !results[r.prNumber]?.ok
  );

  const registered = requests.filter((r) =>
    results[r.prNumber]?.ok || r.journalId
  );

  const displayed = tab === "pending" ? pending : registered;
  const totalPendingAmount = pending.reduce((s, r) => s + r.totalAmount, 0);

  const toggleExpand = (pr: string) => setExpanded((p) => ({ ...p, [pr]: !p[pr] }));
  const handleEdit = (pr: string, field: keyof JournalEdits, value: string) =>
    setEdits((p) => ({ ...p, [pr]: { ...p[pr], [field]: value } }));

  const registerJournal = async (prNumber: string) => {
    setRegistering((prev) => ({ ...prev, [prNumber]: true }));
    try {
      const res = await apiFetch("/api/mf/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber, overrides: edits[prNumber] }),
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

  const registerAll = async () => {
    if (!confirm(`仕訳待ち ${pending.length}件 を一括登録します。よろしいですか？`)) return;
    setBulkRegistering(true);
    for (const r of pending) {
      if (results[r.prNumber]?.ok) continue;
      await registerJournal(r.prNumber);
    }
    setBulkRegistering(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-800 text-sm">← ダッシュボード</a>
            <h1 className="text-lg font-bold">仕訳管理</h1>
          </div>
          <button onClick={fetchData} className="text-sm text-gray-500 hover:text-gray-700">更新</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm text-red-800">{error}</span>
            <button onClick={fetchData} className="text-sm text-red-600 underline">再読み込み</button>
          </div>
        )}

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

        <div className="flex gap-1 mb-4">
          <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "pending" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            仕訳待ち（{pending.length}）
          </button>
          <button onClick={() => setTab("registered")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "registered" ? "bg-green-100 text-green-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            登録済み（{registered.length}）
          </button>
        </div>

        {tab === "pending" && pending.length > 0 && (
          <div className="mb-4">
            <button onClick={registerAll} disabled={bulkRegistering}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
              {bulkRegistering ? "登録中..." : `全${pending.length}件を一括登録`}
            </button>
          </div>
        )}

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
                    <th className="px-3 py-2.5 font-medium text-gray-600 w-8"></th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">PO番号</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">品目</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-right">金額</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">借方</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">貸方</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">税区分</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">部門</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">PJ</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => {
                    const result = results[r.prNumber];
                    const isReg = registering[r.prNumber];
                    const isExpanded = expanded[r.prNumber];
                    const e = edits[r.prNumber] || {};
                    const debit = e.debitAccount ?? (r.accountTitle?.split("（")[0] || "消耗品費");
                    const credit = resolveCreditDefault(r.paymentMethod);
                    const creditAcc = e.creditAccount ?? credit.account;
                    const creditSub = e.creditSubAccount ?? credit.sub;
                    const taxCat = e.taxCategory ?? (ACCOUNT_TAX_MAP[debit] || "共-課仕 10%");
                    const dept = e.department ?? r.department;
                    const hubspot = e.hubspotDealId ?? (r.hubspotInfo || "");
                    const edited = Object.keys(e).length > 0;
                    return (
                      <><tr key={r.prNumber}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${result?.ok ? "bg-green-50" : result && !result.ok ? "bg-red-50" : edited ? "bg-amber-50/50" : ""}`}
                        onClick={() => toggleExpand(r.prNumber)}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{isExpanded ? "\u25BC" : "\u25B6"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {r.slackLink ? <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.prNumber}</a> : r.prNumber}
                        </td>
                        <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2.5 text-right font-mono">¥{r.totalAmount.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs">{debit}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <div>{creditAcc}</div>
                          {creditSub && <div className="text-gray-400 text-[10px]">{creditSub}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${taxCat.includes("課仕") ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {taxCat}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{dept}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">{hubspot || "-"}</td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {result?.ok ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">{result.message}</span>
                          ) : result && !result.ok ? (
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-xs text-red-600 max-w-[120px] truncate">{result.message}</span>
                              <button onClick={() => registerJournal(r.prNumber)} className="text-xs text-red-600 underline shrink-0">再試行</button>
                            </div>
                          ) : tab === "pending" ? (
                            <button onClick={() => registerJournal(r.prNumber)} disabled={isReg}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">
                              {isReg ? "登録中..." : "仕訳登録"}
                            </button>
                          ) : (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                              {r.journalId ? `MF仕訳ID: ${r.journalId}` : "登録済み"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.prNumber}-detail`}>
                          <td colSpan={10}>
                            <JournalDetail r={r} edits={e} onEdit={(field, value) => handleEdit(r.prNumber, field, value)} />
                          </td>
                        </tr>
                      )}
                      </>
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

"use client";

import { useState } from "react";
import Link from "next/link";

interface MockRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  department: string;
  debitAccount: string;
  creditAccount: string;
  creditSubAccount: string;
  taxCategory: string;
  paymentMethod: string;
  slackLink: string;
  hubspotDealId: string;
  memo: string;
}

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

const CREDIT_OPTIONS_CARD = [
  { account: "未払金", sub: "MFカード:未請求" },
  { account: "未払金", sub: "MFカード:請求" },
];
const CREDIT_OPTIONS_INVOICE = [
  { account: "買掛金", sub: "" },
  { account: "未払金", sub: "" },
];

function calcTax(amount: number, rate: number): number {
  return rate > 0 ? Math.floor(amount * rate / (100 + rate)) : 0;
}

function taxRate(cat: string): number {
  if (cat.includes("10%")) return 10;
  if (cat.includes("8%")) return 8;
  return 0;
}

const SAMPLE_PENDING: MockRequest[] = [
  { prNumber: "PR-0055", applicationDate: "2026-03-28", itemName: "ノートPC Dell Latitude 5550", totalAmount: 248000, supplierName: "Amazon.co.jp", applicant: "田中太郎", department: "営業部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0055 Amazon.co.jp" },
  { prNumber: "PR-0053", applicationDate: "2026-03-27", itemName: "Adobe Creative Cloud 年間ライセンス", totalAmount: 86400, supplierName: "Adobe Inc.", applicant: "佐藤花子", department: "開発部", debitAccount: "ソフトウェア", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#", hubspotDealId: "", memo: "PR-0053 Adobe Inc." },
  { prNumber: "PR-0051", applicationDate: "2026-03-26", itemName: "A4コピー用紙 5000枚 x 10箱", totalAmount: 32000, supplierName: "ASKUL", applicant: "鈴木一郎", department: "管理本部", debitAccount: "消耗品費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0051 ASKUL" },
  { prNumber: "PR-0049", applicationDate: "2026-03-25", itemName: "会議用プロジェクター EPSON EB-992F", totalAmount: 145000, supplierName: "ヨドバシカメラ", applicant: "山田部長", department: "営業部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0049 ヨドバシカメラ" },
  { prNumber: "PR-0047", applicationDate: "2026-03-24", itemName: "外注デザイン制作費（LP制作）", totalAmount: 330000, supplierName: "デザイン工房ABC", applicant: "伊澤剛志", department: "管理本部", debitAccount: "外注費", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#", hubspotDealId: "HS-2026-042", memo: "PR-0047 デザイン工房ABC LP制作" },
  { prNumber: "PR-0045", applicationDate: "2026-03-22", itemName: "プリンタートナー CT203091 x 4色", totalAmount: 48500, supplierName: "モノタロウ", applicant: "田中太郎", department: "営業部", debitAccount: "消耗品費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0045 モノタロウ" },
];

const SAMPLE_REGISTERED: MockRequest[] = [
  { prNumber: "PR-0044", applicationDate: "2026-03-20", itemName: "Slackビジネスプラン 月額", totalAmount: 18700, supplierName: "Slack Technologies", applicant: "伊澤剛志", department: "管理本部", debitAccount: "通信費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0044 Slack Technologies" },
  { prNumber: "PR-0042", applicationDate: "2026-03-18", itemName: "社員用デスクチェア x 3脚", totalAmount: 195000, supplierName: "Amazon.co.jp", applicant: "佐藤花子", department: "開発部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0042 Amazon.co.jp" },
  { prNumber: "PR-0040", applicationDate: "2026-03-15", itemName: "Google Workspace Business Plus", totalAmount: 24000, supplierName: "Google LLC", applicant: "伊澤剛志", department: "管理本部", debitAccount: "通信費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "PR-0040 Google LLC" },
];

type Tab = "pending" | "registered";

/** 仕訳明細の展開表示（編集可能） */
function JournalDetail({ r, edits, onEdit }: {
  r: MockRequest;
  edits: Partial<MockRequest>;
  onEdit: (field: keyof MockRequest, value: string) => void;
}) {
  const current = { ...r, ...edits };
  const rate = taxRate(current.taxCategory);
  const tax = calcTax(current.totalAmount, rate);
  const isCard = current.paymentMethod.includes("カード");
  const creditOptions = isCard ? CREDIT_OPTIONS_CARD : CREDIT_OPTIONS_INVOICE;

  return (
    <div className="bg-gray-50 px-4 py-4 border-t text-xs">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 仕訳プレビュー */}
        <div>
          <div className="font-medium text-gray-700 mb-2">仕訳プレビュー</div>
          <table className="w-full border text-xs">
            <thead><tr className="bg-gray-100"><th className="px-2 py-1.5 text-left">区分</th><th className="px-2 py-1.5 text-left">勘定科目</th><th className="px-2 py-1.5 text-left">補助</th><th className="px-2 py-1.5 text-right">金額</th><th className="px-2 py-1.5 text-right">消費税</th></tr></thead>
            <tbody>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-blue-700 font-medium">借方</td>
                <td className="px-2 py-1.5">{current.debitAccount}</td>
                <td className="px-2 py-1.5 text-gray-400">-</td>
                <td className="px-2 py-1.5 text-right">{"\u00A5"}{current.totalAmount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500">{"\u00A5"}{tax.toLocaleString()}</td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1.5 text-red-700 font-medium">貸方</td>
                <td className="px-2 py-1.5">{current.creditAccount}</td>
                <td className="px-2 py-1.5 text-gray-500">{current.creditSubAccount || "-"}</td>
                <td className="px-2 py-1.5 text-right">{"\u00A5"}{current.totalAmount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-400">-</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 編集フォーム */}
        <div className="space-y-2">
          <div className="font-medium text-gray-700 mb-2">仕訳内容の編集</div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-gray-500 text-xs">借方科目</span>
              <select value={current.debitAccount} onChange={(e) => onEdit("debitAccount", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {DEBIT_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500 text-xs">貸方科目</span>
              <select value={`${current.creditAccount}|${current.creditSubAccount}`}
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
              <select value={current.taxCategory} onChange={(e) => onEdit("taxCategory", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500 text-xs">部門</span>
              <select value={current.department} onChange={(e) => onEdit("department", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-gray-500 text-xs">プロジェクトコード（HubSpot案件番号）</span>
            <input type="text" value={current.hubspotDealId} onChange={(e) => onEdit("hubspotDealId", e.target.value)}
              placeholder="例: HS-2026-042" className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          <label className="block">
            <span className="text-gray-500 text-xs">摘要</span>
            <input type="text" value={current.memo} onChange={(e) => onEdit("memo", e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          {Object.keys(edits).length > 0 && (
            <p className="text-amber-600 text-xs mt-1">* 変更あり — 仕訳登録時に反映されます</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function JournalMock() {
  const [tab, setTab] = useState<Tab>("pending");
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [registering, setRegistering] = useState<Record<string, boolean>>({});
  const [bulkRegistering, setBulkRegistering] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Partial<MockRequest>>>({});

  const pending = SAMPLE_PENDING.filter((r) => !results[r.prNumber]?.ok);
  const registered = [...SAMPLE_REGISTERED, ...SAMPLE_PENDING.filter((r) => results[r.prNumber]?.ok)];
  const displayed = tab === "pending" ? pending : registered;
  const totalPendingAmount = pending.reduce((s, r) => s + r.totalAmount, 0);

  const toggleExpand = (prNumber: string) => {
    setExpanded((prev) => ({ ...prev, [prNumber]: !prev[prNumber] }));
  };

  const handleEdit = (prNumber: string, field: keyof MockRequest, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [prNumber]: { ...prev[prNumber], [field]: value },
    }));
  };

  const registerJournal = async (prNumber: string) => {
    setRegistering((prev) => ({ ...prev, [prNumber]: true }));
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
    if (Math.random() < 0.1) {
      setResults((prev) => ({ ...prev, [prNumber]: { ok: false, message: "MF API タイムアウト" } }));
    } else {
      const journalId = 10000 + Math.floor(Math.random() * 90000);
      setResults((prev) => ({ ...prev, [prNumber]: { ok: true, message: `MF仕訳ID: ${journalId}` } }));
    }
    setRegistering((prev) => ({ ...prev, [prNumber]: false }));
  };

  const registerAll = async () => {
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
            <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">{"\u2190"} 戻る</Link>
            <h1 className="text-lg font-bold">仕訳管理</h1>
            <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-500 rounded">MOCK</span>
          </div>
          <span className="text-xs text-gray-400">行クリックで編集</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
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
            <div className="text-lg font-bold text-gray-800">{"\u00A5"}{totalPendingAmount.toLocaleString()}</div>
            <div className="text-xs text-gray-500">仕訳待ち金額</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{Object.values(results).filter((r) => !r.ok).length}</div>
            <div className="text-xs text-gray-500">エラー</div>
          </div>
        </div>

        {/* タブ */}
        <div className="flex gap-1 mb-4">
          <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "pending" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            仕訳待ち（{pending.length}）
          </button>
          <button onClick={() => setTab("registered")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "registered" ? "bg-green-100 text-green-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            登録済み（{registered.length}）
          </button>
        </div>

        {/* 一括登録ボタン */}
        {tab === "pending" && pending.length > 0 && (
          <div className="mb-4">
            <button onClick={registerAll} disabled={bulkRegistering}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
              {bulkRegistering ? "登録中..." : `全${pending.length}件を一括登録`}
            </button>
          </div>
        )}

        {/* テーブル */}
        {displayed.length === 0 ? (
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
                    const isRegisteredTab = tab === "registered" && !result;
                    const isExpanded = expanded[r.prNumber];
                    const e = edits[r.prNumber] || {};
                    const current = { ...r, ...e };
                    const edited = Object.keys(e).length > 0;
                    return (
                      <><tr key={r.prNumber}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${result?.ok ? "bg-green-50" : result && !result.ok ? "bg-red-50" : edited ? "bg-amber-50/50" : ""}`}
                        onClick={() => toggleExpand(r.prNumber)}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{isExpanded ? "\u25BC" : "\u25B6"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.prNumber}</a>
                        </td>
                        <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{"\u00A5"}{r.totalAmount.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs">{current.debitAccount}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <div>{current.creditAccount}</div>
                          {current.creditSubAccount && <div className="text-gray-400 text-[10px]">{current.creditSubAccount}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${current.taxCategory.includes("課仕") ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {current.taxCategory}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{current.department}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">{current.hubspotDealId || "-"}</td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {result?.ok ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">{result.message}</span>
                          ) : result && !result.ok ? (
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-xs text-red-600">{result.message}</span>
                              <button onClick={() => registerJournal(r.prNumber)} className="text-xs text-red-600 underline">再試行</button>
                            </div>
                          ) : isRegisteredTab ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">MF仕訳ID: {50000 + parseInt(r.prNumber.replace(/\D/g, ""))}</span>
                          ) : (
                            <button onClick={() => registerJournal(r.prNumber)} disabled={isReg}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">
                              {isReg ? <span className="flex items-center gap-1"><span className="inline-block animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />登録中</span> : "仕訳登録"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.prNumber}-detail`}>
                          <td colSpan={10}>
                            <JournalDetail
                              r={r}
                              edits={edits[r.prNumber] || {}}
                              onEdit={(field, value) => handleEdit(r.prNumber, field, value)}
                            />
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

        {/* 操作ガイド */}
        <div className="mt-6 bg-white border rounded-lg p-4 text-sm text-gray-600">
          <h3 className="font-medium text-gray-800 mb-2">操作ガイド</h3>
          <ul className="space-y-1 list-disc list-inside">
            <li>行をクリックすると仕訳プレビュー + 編集フォームが展開されます</li>
            <li><strong>編集可能項目</strong>: 借方科目、貸方科目、税区分、部門、プロジェクトコード、摘要</li>
            <li>編集した内容は仕訳登録時にMF会計Plusに反映されます（行が黄色くハイライト）</li>
            <li><strong>PJ列</strong>: HubSpot案件番号。展開して入力/変更できます</li>
            <li>MF会計Plusにはドラフトとして登録。最終承認はMF会計Plus上で行ってください</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

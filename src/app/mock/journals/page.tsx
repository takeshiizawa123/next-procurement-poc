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
  hubspotDealId?: string;
}

/** 税込金額から税額を計算 */
function calcTax(amount: number, rate: number): number {
  return rate > 0 ? Math.floor(amount * rate / (100 + rate)) : 0;
}

const SAMPLE_PENDING: MockRequest[] = [
  { prNumber: "PR-0055", applicationDate: "2026-03-28", itemName: "ノートPC Dell Latitude 5550", totalAmount: 248000, supplierName: "Amazon.co.jp", applicant: "田中太郎", department: "営業部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
  { prNumber: "PR-0053", applicationDate: "2026-03-27", itemName: "Adobe Creative Cloud 年間ライセンス", totalAmount: 86400, supplierName: "Adobe Inc.", applicant: "佐藤花子", department: "開発部", debitAccount: "ソフトウェア", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#" },
  { prNumber: "PR-0051", applicationDate: "2026-03-26", itemName: "A4コピー用紙 5000枚 x 10箱", totalAmount: 32000, supplierName: "ASKUL", applicant: "鈴木一郎", department: "管理本部", debitAccount: "消耗品費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
  { prNumber: "PR-0049", applicationDate: "2026-03-25", itemName: "会議用プロジェクター EPSON EB-992F", totalAmount: 145000, supplierName: "ヨドバシカメラ", applicant: "山田部長", department: "営業部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
  { prNumber: "PR-0047", applicationDate: "2026-03-24", itemName: "外注デザイン制作費（LP制作）", totalAmount: 330000, supplierName: "デザイン工房ABC", applicant: "伊澤剛志", department: "管理本部", debitAccount: "外注費", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#", hubspotDealId: "HS-2026-042" },
  { prNumber: "PR-0045", applicationDate: "2026-03-22", itemName: "プリンタートナー CT203091 x 4色", totalAmount: 48500, supplierName: "モノタロウ", applicant: "田中太郎", department: "営業部", debitAccount: "消耗品費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
];

const SAMPLE_REGISTERED: MockRequest[] = [
  { prNumber: "PR-0044", applicationDate: "2026-03-20", itemName: "Slackビジネスプラン 月額", totalAmount: 18700, supplierName: "Slack Technologies", applicant: "伊澤剛志", department: "管理本部", debitAccount: "通信費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
  { prNumber: "PR-0042", applicationDate: "2026-03-18", itemName: "社員用デスクチェア x 3脚", totalAmount: 195000, supplierName: "Amazon.co.jp", applicant: "佐藤花子", department: "開発部", debitAccount: "工具器具備品", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
  { prNumber: "PR-0040", applicationDate: "2026-03-15", itemName: "Google Workspace Business Plus", totalAmount: 24000, supplierName: "Google LLC", applicant: "伊澤剛志", department: "管理本部", debitAccount: "通信費", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#" },
];

type Tab = "pending" | "registered";

/** 仕訳明細の展開表示 */
function JournalDetail({ r }: { r: MockRequest }) {
  const taxRate = r.taxCategory.includes("8%") ? 8 : r.taxCategory.includes("10%") ? 10 : 0;
  const taxAmount = calcTax(r.totalAmount, taxRate);
  return (
    <div className="bg-gray-50 px-4 py-3 border-t text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 仕訳プレビュー */}
        <div>
          <div className="font-medium text-gray-700 mb-1">仕訳プレビュー</div>
          <table className="w-full border text-xs">
            <thead><tr className="bg-gray-100"><th className="px-2 py-1 text-left">区分</th><th className="px-2 py-1 text-left">勘定科目</th><th className="px-2 py-1 text-left">補助</th><th className="px-2 py-1 text-right">金額</th><th className="px-2 py-1 text-right">消費税</th></tr></thead>
            <tbody>
              <tr className="border-t"><td className="px-2 py-1 text-blue-700 font-medium">借方</td><td className="px-2 py-1">{r.debitAccount}</td><td className="px-2 py-1 text-gray-400">-</td><td className="px-2 py-1 text-right">{"\u00A5"}{r.totalAmount.toLocaleString()}</td><td className="px-2 py-1 text-right text-gray-500">{"\u00A5"}{taxAmount.toLocaleString()}</td></tr>
              <tr className="border-t"><td className="px-2 py-1 text-red-700 font-medium">貸方</td><td className="px-2 py-1">{r.creditAccount}</td><td className="px-2 py-1 text-gray-500">{r.creditSubAccount || "-"}</td><td className="px-2 py-1 text-right">{"\u00A5"}{r.totalAmount.toLocaleString()}</td><td className="px-2 py-1 text-right text-gray-400">-</td></tr>
            </tbody>
          </table>
        </div>
        {/* 付帯情報 */}
        <div>
          <div className="font-medium text-gray-700 mb-1">付帯情報</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-gray-500">税区分:</dt><dd>{r.taxCategory}</dd>
            <dt className="text-gray-500">部門:</dt><dd>{r.department}</dd>
            <dt className="text-gray-500">摘要:</dt><dd>{r.prNumber} {r.supplierName}</dd>
            <dt className="text-gray-500">タグ:</dt><dd><span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{r.prNumber}</span></dd>
            {r.hubspotDealId && <><dt className="text-gray-500">案件:</dt><dd>{r.hubspotDealId}</dd></>}
            <dt className="text-gray-500">申請日:</dt><dd>{r.applicationDate}</dd>
          </dl>
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

  const pending = SAMPLE_PENDING.filter((r) => !results[r.prNumber]?.ok);
  const registered = [...SAMPLE_REGISTERED, ...SAMPLE_PENDING.filter((r) => results[r.prNumber]?.ok)];
  const displayed = tab === "pending" ? pending : registered;
  const totalPendingAmount = pending.reduce((s, r) => s + r.totalAmount, 0);

  const toggleExpand = (prNumber: string) => {
    setExpanded((prev) => ({ ...prev, [prNumber]: !prev[prNumber] }));
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
          <span className="text-xs text-gray-400">デモ用 — 実際のAPIは呼びません</span>
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
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => {
                    const result = results[r.prNumber];
                    const isReg = registering[r.prNumber];
                    const isRegisteredTab = tab === "registered" && !result;
                    const isExpanded = expanded[r.prNumber];
                    return (
                      <><tr key={r.prNumber} className={`border-b hover:bg-gray-50 cursor-pointer ${result?.ok ? "bg-green-50" : result && !result.ok ? "bg-red-50" : ""}`}
                        onClick={() => toggleExpand(r.prNumber)}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{isExpanded ? "\u25BC" : "\u25B6"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.prNumber}</a>
                        </td>
                        <td className="px-3 py-2.5 max-w-[180px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{"\u00A5"}{r.totalAmount.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs">{r.debitAccount}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <div>{r.creditAccount}</div>
                          {r.creditSubAccount && <div className="text-gray-400">{r.creditSubAccount}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${r.taxCategory.includes("課仕") ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {r.taxCategory}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{r.department}</td>
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
                      {isExpanded && <tr key={`${r.prNumber}-detail`}><td colSpan={9}><JournalDetail r={r} /></td></tr>}
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
            <li>行をクリックすると仕訳プレビュー（借方/貸方・消費税額・摘要・タグ）が展開されます</li>
            <li><strong>借方</strong>: 費用科目（品目から自動推定）/ <strong>貸方</strong>: カード払い{"\u2192"}未払金/MFカード:未請求、請求書払い{"\u2192"}買掛金</li>
            <li><strong>税区分</strong>: 科目マスタCSVのFS税区分に準拠（販管費{"\u2192"}共-課仕 10%、研究開発費{"\u2192"}課仕 10%）</li>
            <li><strong>一括登録</strong>: 全件を順に登録。エラーは「再試行」で個別対応</li>
            <li>MF会計Plusにはドラフトとして登録されます。最終承認はMF会計Plus上で行ってください</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

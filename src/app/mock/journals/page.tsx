"use client";

import { useState } from "react";
import Link from "next/link";

// --- 型定義 ---

interface MockRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  department: string;
  debitAccount: string;       // AI推定
  debitConfidence: "high" | "medium" | "low"; // 推定確度
  creditAccount: string;      // システム導出
  creditSubAccount: string;
  taxCategory: string;        // AI推定（科目連動）
  paymentMethod: string;      // 申請者入力
  slackLink: string;
  hubspotDealId: string;      // 申請者入力
  memo: string;               // 自動生成
  // OCR結果
  ocrTaxRate?: number;
  ocrAmount?: number;
  ocrRegistrationNumber?: string;
  ocrRegistrationName?: string;
  ocrAmountMatch?: boolean;
  // 証憑情報
  voucherType: string;
  voucherFileName?: string;
  voucherDriveUrl?: string;
}

// --- 定数 ---

const DEBIT_ACCOUNTS = [
  "消耗品費", "備品消耗品費", "事務用消耗品費", "工具器具備品", "ソフトウェア",
  "外注費", "業務委託費", "広告宣伝費", "旅費交通費", "通信費",
  "地代家賃", "雑費", "研究開発費", "管理諸費", "会議費",
  "接待交際費", "修繕費", "材料費", "材料仕入",
];
const TAX_CATEGORIES = ["共-課仕 10%", "共-課仕 8%", "課仕 10%", "課仕 8%", "非課税", "不課税", "対象外"];
const DEPARTMENTS = ["営業部", "開発部", "管理本部", "製造部", "ロジスティクス"];
const CREDIT_MAP: Record<string, { account: string; sub: string }[]> = {
  "会社カード": [{ account: "未払金", sub: "MFカード:未請求" }, { account: "未払金", sub: "MFカード:請求" }],
  "請求書払い": [{ account: "買掛金", sub: "" }, { account: "未払金", sub: "" }],
};
const ACCOUNT_TAX_MAP: Record<string, string> = {
  消耗品費: "共-課仕 10%", 工具器具備品: "共-課仕 10%", ソフトウェア: "共-課仕 10%",
  外注費: "共-課仕 10%", 通信費: "共-課仕 10%", 研究開発費: "課仕 10%",
  広告宣伝費: "共-課仕 10%", 旅費交通費: "共-課仕 10%", 地代家賃: "共-課仕 10%",
  雑費: "共-課仕 10%", 会議費: "共-課仕 10%", 接待交際費: "共-課仕 10%",
  修繕費: "共-課仕 10%", 材料費: "共-課仕 10%", 材料仕入: "共-課仕 10%",
  備品消耗品費: "共-課仕 10%", 事務用消耗品費: "共-課仕 10%", 業務委託費: "共-課仕 10%", 管理諸費: "共-課仕 10%",
};

function calcTax(amount: number, cat: string): number {
  const rate = cat.includes("10%") ? 10 : cat.includes("8%") ? 8 : 0;
  return rate > 0 ? Math.floor(amount * rate / (100 + rate)) : 0;
}

// --- サンプルデータ ---

const SAMPLE_PENDING: MockRequest[] = [
  { prNumber: "PR-0055", applicationDate: "2026-03-28", itemName: "ノートPC Dell Latitude 5550", totalAmount: 248000, supplierName: "Amazon.co.jp", applicant: "田中太郎", department: "営業部", debitAccount: "工具器具備品", debitConfidence: "high", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0055 Amazon.co.jp", ocrTaxRate: 10, ocrAmount: 248000, ocrAmountMatch: true, ocrRegistrationNumber: "T1234567890123", ocrRegistrationName: "アマゾンジャパン合同会社", voucherType: "領収書", voucherFileName: "PR-0055_Amazon_領収書.pdf", voucherDriveUrl: "#" },
  { prNumber: "PR-0053", applicationDate: "2026-03-27", itemName: "Adobe Creative Cloud 年間ライセンス", totalAmount: 86400, supplierName: "Adobe Inc.", applicant: "佐藤花子", department: "開発部", debitAccount: "ソフトウェア", debitConfidence: "high", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0053 Adobe Inc.", ocrTaxRate: 10, ocrAmount: 86400, ocrAmountMatch: true, voucherType: "請求書", voucherFileName: "PR-0053_Adobe_請求書.pdf", voucherDriveUrl: "#" },
  { prNumber: "PR-0051", applicationDate: "2026-03-26", itemName: "A4コピー用紙 5000枚 x 10箱", totalAmount: 32000, supplierName: "ASKUL", applicant: "鈴木一郎", department: "管理本部", debitAccount: "消耗品費", debitConfidence: "high", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0051 ASKUL", ocrTaxRate: 10, ocrAmount: 31500, ocrAmountMatch: false, ocrRegistrationNumber: "T9876543210987", ocrRegistrationName: "アスクル株式会社", voucherType: "納品書", voucherFileName: "PR-0051_ASKUL_納品書.pdf", voucherDriveUrl: "#" },
  { prNumber: "PR-0049", applicationDate: "2026-03-25", itemName: "会議用プロジェクター EPSON EB-992F", totalAmount: 145000, supplierName: "ヨドバシカメラ", applicant: "山田部長", department: "営業部", debitAccount: "工具器具備品", debitConfidence: "high", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0049 ヨドバシカメラ", ocrTaxRate: 10, ocrAmount: 145000, ocrAmountMatch: true, voucherType: "領収書", voucherFileName: "PR-0049_ヨドバシ_領収書.pdf", voucherDriveUrl: "#" },
  { prNumber: "PR-0047", applicationDate: "2026-03-24", itemName: "外注デザイン制作費（LP制作）", totalAmount: 330000, supplierName: "デザイン工房ABC", applicant: "伊澤剛志", department: "管理本部", debitAccount: "外注費", debitConfidence: "medium", creditAccount: "買掛金", creditSubAccount: "", taxCategory: "共-課仕 10%", paymentMethod: "請求書払い", slackLink: "#", hubspotDealId: "HS-2026-042", memo: "2026/03 PR-0047 デザイン工房ABC LP制作", ocrTaxRate: 10, ocrAmount: 330000, ocrAmountMatch: true, ocrRegistrationNumber: "", ocrRegistrationName: "", voucherType: "請求書", voucherFileName: "PR-0047_デザイン工房_請求書.pdf", voucherDriveUrl: "#" },
  { prNumber: "PR-0045", applicationDate: "2026-03-22", itemName: "プリンタートナー CT203091 x 4色", totalAmount: 48500, supplierName: "モノタロウ", applicant: "田中太郎", department: "営業部", debitAccount: "消耗品費", debitConfidence: "low", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0045 モノタロウ", ocrTaxRate: 8, ocrAmount: 48500, ocrAmountMatch: true, voucherType: "納品書", voucherFileName: "PR-0045_モノタロウ_納品書.pdf", voucherDriveUrl: "#" },
];

const SAMPLE_REGISTERED: MockRequest[] = [
  { prNumber: "PR-0044", applicationDate: "2026-03-20", itemName: "Slackビジネスプラン 月額", totalAmount: 18700, supplierName: "Slack Technologies", applicant: "伊澤剛志", department: "管理本部", debitAccount: "通信費", debitConfidence: "high", creditAccount: "未払金", creditSubAccount: "MFカード:未請求", taxCategory: "共-課仕 10%", paymentMethod: "会社カード", slackLink: "#", hubspotDealId: "", memo: "2026/03 PR-0044 Slack Technologies", voucherType: "請求書", voucherFileName: "PR-0044_Slack_Invoice.pdf", voucherDriveUrl: "#" },
];

type Tab = "pending" | "registered";

// --- AI推定バッジ ---

function AiBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-blue-50 text-blue-600 border-blue-200",
    medium: "bg-amber-50 text-amber-600 border-amber-200",
    low: "bg-red-50 text-red-600 border-red-200",
  };
  const labels = { high: "AI:高", medium: "AI:中", low: "AI:低" };
  return <span className={`text-[10px] px-1 py-0.5 rounded border ${styles[confidence]}`}>{labels[confidence]}</span>;
}

function SourceTag({ type }: { type: "input" | "ai" | "system" | "ocr" }) {
  const map = {
    input: { label: "申請者入力", style: "bg-gray-100 text-gray-600" },
    ai: { label: "AI推定", style: "bg-blue-50 text-blue-700 border border-blue-200" },
    system: { label: "システム", style: "bg-purple-50 text-purple-600" },
    ocr: { label: "OCR読取", style: "bg-cyan-50 text-cyan-700 border border-cyan-200" },
  };
  const { label, style } = map[type];
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${style}`}>{label}</span>;
}

// --- 仕訳明細コンポーネント ---

function JournalDetail({ r, edits, onEdit }: {
  r: MockRequest;
  edits: Partial<MockRequest>;
  onEdit: (field: keyof MockRequest, value: string) => void;
}) {
  const current = { ...r, ...edits };
  const tax = calcTax(current.totalAmount, current.taxCategory);
  const isCard = current.paymentMethod.includes("カード");
  const creditOptions = CREDIT_MAP[isCard ? "会社カード" : "請求書払い"] || CREDIT_MAP["請求書払い"];
  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="bg-gray-50 px-4 py-4 border-t text-xs">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左: 証憑プレビュー（大）+ OCR結果 */}
        <div className="flex flex-col">
          <div className="font-medium text-gray-700 mb-2 flex items-center justify-between">
            <span>証憑プレビュー</span>
            <div className="flex gap-2">
              {r.slackLink && <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100" onClick={(e) => e.stopPropagation()}>Slackスレッド</a>}
              {r.voucherDriveUrl && <a href={r.voucherDriveUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100" onClick={(e) => e.stopPropagation()}>Google Driveで開く</a>}
            </div>
          </div>
          {/* ドキュメントビューア */}
          <div className="bg-white border rounded flex-1 min-h-[360px] flex flex-col">
            <div className="flex-1 bg-gray-100 rounded-t flex items-center justify-center relative">
              {/* 実運用ではiframe/img でDriveファイルをプレビュー */}
              <div className="text-center text-gray-400 p-8">
                <div className="text-5xl mb-3">{r.voucherType === "領収書" ? "\uD83E\uDDFE" : r.voucherType === "請求書" ? "\uD83D\uDCC4" : "\uD83D\uDCE6"}</div>
                <div className="text-sm font-medium text-gray-500 mb-1">{r.voucherFileName}</div>
                <div className="text-xs text-gray-400">種別: {r.voucherType}</div>
                <div className="text-[10px] text-gray-300 mt-2">（実運用時はGoogle Driveのドキュメントがここに表示されます）</div>
              </div>
            </div>
            {/* OCR読取結果バー */}
            <div className="p-3 border-t bg-white rounded-b">
              <div className="font-medium text-gray-600 mb-1.5 flex items-center gap-1">OCR読取結果 <SourceTag type="ocr" /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {r.ocrTaxRate != null && (
                  <div className="bg-gray-50 rounded p-1.5">
                    <div className="text-gray-400 text-[10px]">税率</div>
                    <div className="font-medium">{r.ocrTaxRate}%{r.ocrTaxRate === 8 ? " (軽減)" : ""}</div>
                  </div>
                )}
                {r.ocrAmount != null && (
                  <div className={`rounded p-1.5 ${r.ocrAmountMatch ? "bg-green-50" : "bg-red-50"}`}>
                    <div className="text-gray-400 text-[10px]">読取金額</div>
                    <div className={`font-medium ${r.ocrAmountMatch ? "text-green-700" : "text-red-600"}`}>
                      {"\u00A5"}{r.ocrAmount.toLocaleString()} {r.ocrAmountMatch ? "\u2713" : "\u2717"}
                    </div>
                  </div>
                )}
                {r.ocrRegistrationNumber ? (
                  <div className="bg-green-50 rounded p-1.5 col-span-2">
                    <div className="text-gray-400 text-[10px]">適格請求書</div>
                    <div className="font-medium text-green-700 truncate">{r.ocrRegistrationNumber}</div>
                    <div className="text-[10px] text-green-600 truncate">{r.ocrRegistrationName}</div>
                  </div>
                ) : r.voucherType === "請求書" ? (
                  <div className="bg-amber-50 rounded p-1.5 col-span-2">
                    <div className="text-gray-400 text-[10px]">適格請求書</div>
                    <div className="font-medium text-amber-600">番号未検出</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* 右: 仕訳プレビュー + 編集フォーム */}
        <div className="flex flex-col gap-3">

        {/* 右: 編集フォーム */}
          {/* 仕訳プレビュー */}
          <div>
            <div className="font-medium text-gray-700 mb-2">仕訳プレビュー</div>
            <table className="w-full border text-xs">
              <thead><tr className="bg-gray-100"><th className="px-2 py-1.5 text-left">区分</th><th className="px-2 py-1.5 text-left">勘定科目</th><th className="px-2 py-1.5 text-left">補助</th><th className="px-2 py-1.5 text-right">金額</th><th className="px-2 py-1.5 text-right">消費税</th></tr></thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-2 py-1.5 text-blue-700 font-medium">借方</td>
                  <td className="px-2 py-1.5">{current.debitAccount} <AiBadge confidence={r.debitConfidence} /></td>
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
            {/* ソース凡例 */}
            <div className="flex gap-3 mt-1.5 text-[10px] text-gray-400">
              <span><SourceTag type="input" /> 申請データ</span>
              <span><SourceTag type="ai" /> 要確認</span>
              <span><SourceTag type="system" /> 自動</span>
            </div>
          </div>

          {/* 編集フォーム */}
        <div className="space-y-2">
          <div className="font-medium text-gray-700 mb-2">仕訳内容の編集 <span className="text-gray-400 font-normal text-[10px]">（AI推定項目は要確認）</span></div>

          <label className="block">
            <span className="text-gray-500 text-xs flex items-center gap-1">借方科目 <SourceTag type="ai" /></span>
            <select value={current.debitAccount}
              onChange={(e) => {
                onEdit("debitAccount", e.target.value);
                const newTax = ACCOUNT_TAX_MAP[e.target.value];
                if (newTax) onEdit("taxCategory" as keyof MockRequest, newTax);
              }}
              className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
              {DEBIT_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-gray-500 text-xs flex items-center gap-1">貸方科目 <SourceTag type="system" /></span>
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

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-gray-500 text-xs flex items-center gap-1">税区分 <SourceTag type="ai" /></span>
              <select value={current.taxCategory} onChange={(e) => onEdit("taxCategory", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500 text-xs flex items-center gap-1">部門 <SourceTag type="input" /></span>
              <select value={current.department} onChange={(e) => onEdit("department", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-gray-500 text-xs flex items-center gap-1">プロジェクトコード <SourceTag type="input" /></span>
            <input type="text" value={current.hubspotDealId} onChange={(e) => onEdit("hubspotDealId", e.target.value)}
              placeholder="例: HS-2026-042" className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          <label className="block">
            <span className="text-gray-500 text-xs flex items-center gap-1">摘要 <SourceTag type="system" /></span>
            <input type="text" value={current.memo} onChange={(e) => onEdit("memo", e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
          </label>

          {hasEdits && <p className="text-amber-600 text-xs mt-1">* 変更あり — 仕訳登録時に反映されます</p>}
        </div>
        </div>
      </div>
    </div>
  );
}

// --- メインコンポーネント ---

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

  const toggleExpand = (pr: string) => setExpanded((p) => ({ ...p, [pr]: !p[pr] }));
  const handleEdit = (pr: string, field: keyof MockRequest, value: string) =>
    setEdits((p) => ({ ...p, [pr]: { ...p[pr], [field]: value } }));

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

  // 要確認件数（AI確度が中低 or OCR金額不一致 or 適格番号なし請求書）
  const needsReview = pending.filter((r) =>
    r.debitConfidence !== "high" || !r.ocrAmountMatch || (!r.ocrRegistrationNumber && r.voucherType === "請求書")
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">{"\u2190"} 戻る</Link>
            <h1 className="text-lg font-bold">仕訳管理</h1>
            <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-500 rounded">MOCK</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <SourceTag type="input" /><SourceTag type="ai" /><SourceTag type="system" /><SourceTag type="ocr" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* サマリーカード */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{pending.length}</div>
            <div className="text-xs text-gray-500">仕訳待ち</div>
          </div>
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{needsReview.length}</div>
            <div className="text-xs text-gray-500">要確認</div>
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

        {/* 要確認バナー */}
        {needsReview.length > 0 && tab === "pending" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
            <strong>要確認 {needsReview.length}件</strong>: AI推定確度が低い・OCR金額不一致・適格請求書番号なしの案件があります。行を展開して内容を確認してください。
          </div>
        )}

        {/* タブ + 一括登録 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-1">
            <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "pending" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              仕訳待ち（{pending.length}）
            </button>
            <button onClick={() => setTab("registered")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "registered" ? "bg-green-100 text-green-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
              登録済み（{registered.length}）
            </button>
          </div>
          {tab === "pending" && pending.length > 0 && (
            <button onClick={registerAll} disabled={bulkRegistering}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed ml-auto">
              {bulkRegistering ? "登録中..." : `全${pending.length}件を一括登録`}
            </button>
          )}
        </div>

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
                    <th className="px-3 py-2.5 font-medium text-gray-600">品目 <SourceTag type="input" /></th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-right">金額</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">借方 <SourceTag type="ai" /></th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">貸方 <SourceTag type="system" /></th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">税区分</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">部門</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">証憑</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => {
                    const result = results[r.prNumber];
                    const isReg = registering[r.prNumber];
                    const isExpanded = expanded[r.prNumber];
                    const e = edits[r.prNumber] || {};
                    const current = { ...r, ...e };
                    const edited = Object.keys(e).length > 0;
                    const isRegisteredTab = tab === "registered" && !result;
                    const hasWarning = r.debitConfidence !== "high" || !r.ocrAmountMatch || (!r.ocrRegistrationNumber && r.voucherType === "請求書");
                    return (
                      <><tr key={r.prNumber}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${result?.ok ? "bg-green-50" : result && !result.ok ? "bg-red-50" : edited ? "bg-amber-50/50" : hasWarning ? "bg-yellow-50/30" : ""}`}
                        onClick={() => toggleExpand(r.prNumber)}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{isExpanded ? "\u25BC" : hasWarning ? "\u26A0\uFE0F" : "\u25B6"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">
                          <a href={r.slackLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.prNumber}</a>
                        </td>
                        <td className="px-3 py-2.5 max-w-[150px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {"\u00A5"}{r.totalAmount.toLocaleString()}
                          {r.ocrAmountMatch === false && <span className="ml-1 text-red-500 text-[10px]">✗OCR</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {current.debitAccount} <AiBadge confidence={r.debitConfidence} />
                        </td>
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
                        <td className="px-3 py-2.5 text-xs">
                          <span className="text-gray-500">{r.voucherType}</span>
                          {r.ocrRegistrationNumber && <span className="ml-1 text-green-600 text-[10px]">適格</span>}
                          {!r.ocrRegistrationNumber && r.voucherType === "請求書" && <span className="ml-1 text-amber-500 text-[10px]">番号なし</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {result?.ok ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">{result.message}</span>
                          ) : result && !result.ok ? (
                            <div className="flex items-center gap-1 justify-center">
                              <span className="text-xs text-red-600 max-w-[100px] truncate">{result.message}</span>
                              <button onClick={() => registerJournal(r.prNumber)} className="text-xs text-red-600 underline shrink-0">再試行</button>
                            </div>
                          ) : isRegisteredTab ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">MF仕訳ID: {50000 + parseInt(r.prNumber.replace(/\D/g, ""))}</span>
                          ) : (
                            <button onClick={() => registerJournal(r.prNumber)} disabled={isReg}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">
                              {isReg ? "登録中..." : "仕訳登録"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.prNumber}-detail`}>
                          <td colSpan={10}>
                            <JournalDetail r={r} edits={edits[r.prNumber] || {}} onEdit={(field, value) => handleEdit(r.prNumber, field, value)} />
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

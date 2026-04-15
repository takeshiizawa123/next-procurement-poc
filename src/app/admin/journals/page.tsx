"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch, apiFetchSWR, swrInvalidate } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";
import AmazonMatchingTab from "./AmazonMatchingTab";
import ContractJournalTab from "./ContractJournalTab";

const CREDIT_MAP: Record<string, { account: string; sub: string }[]> = {
  "MFカード": [{ account: "未払金", sub: "MFカード:未請求" }, { account: "未払金", sub: "MFカード:請求" }],
  "請求書払い": [{ account: "買掛金", sub: "" }, { account: "未払金", sub: "" }],
  "請求書払い（前払い）": [{ account: "前払金", sub: "" }, { account: "買掛金", sub: "" }],
};

// --- MF会計マスタデータ型 ---

interface MfMasters {
  accounts: { code: string | null; name: string; taxId?: number; categories?: string[] }[];
  taxes: { code: string | null; name: string; abbreviation?: string; taxRate?: number }[];
  departments: { code: string | null; name: string }[];
  subAccounts: { id: number; accountId: number; name: string }[];
  projects: { code: string | null; name: string }[];
  counterparties: { code: string | null; name: string; invoiceRegistrationNumber?: string | null }[];
}

/** マスタから勘定科目のデフォルト税区分を解決 */
function resolveAccountTax(accountName: string, masters: MfMasters | null): string {
  const DEFAULT = "共-課仕 10%";
  if (!masters) return DEFAULT;
  const account = masters.accounts.find((a) => a.name === accountName);
  if (!account?.taxId) return DEFAULT;
  const tax = masters.taxes.find((t) => Number(t.code) === account.taxId || t.name.includes(String(account.taxId)));
  // 「不明」「対象外」等の非課税系はデフォルトにフォールバック
  if (!tax?.name || tax.name === "不明" || tax.name === "対象外") return DEFAULT;
  return tax.name;
}

/** マスタから支払方法に応じた貸方の補助科目候補を構築 */
function buildCreditOptions(paymentMethod: string, masters: MfMasters | null): { account: string; sub: string }[] {
  // マスタから補助科目を使えるが、支払方法→貸方のマッピングはビジネスロジック
  const base = CREDIT_MAP[paymentMethod] || CREDIT_MAP["請求書払い"];
  if (!masters) return base;

  // マスタの補助科目で「未払金」系を動的に補完
  if (paymentMethod.includes("カード")) {
    const unpaidAcct = masters.accounts.find((a) => a.name === "未払金");
    if (unpaidAcct) {
      const subs = masters.subAccounts
        .filter((s) => s.accountId === Number(unpaidAcct.code) || s.name.includes("カード"))
        .map((s) => ({ account: "未払金", sub: s.name }));
      if (subs.length > 0) return subs;
    }
  }
  return base;
}

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

/** select の value が options に存在することを保証する。存在しなければ最近似 or fallback or 先頭を返す */
function snapToOption(value: string, options: string[] | null, fallback?: string): string {
  if (!options || options.length === 0) return value;
  if (options.includes(value)) return value;
  if (value) {
    const prefix = options.find((o) => o.startsWith(value) || value.startsWith(o));
    if (prefix) return prefix;
    const subs = options.filter((o) => o.includes(value) || value.includes(o));
    if (subs.length > 0) return subs.sort((a, b) => a.length - b.length)[0];
  }
  if (fallback && options.includes(fallback)) return fallback;
  return options[0];
}

/** 貸方科目+補助の組合せが creditOptions に存在することを保証する */
function snapToCreditOption(
  account: string, sub: string, creditOptions: { account: string; sub: string }[]
): { account: string; sub: string } {
  if (creditOptions.length === 0) return { account, sub };
  if (creditOptions.some((o) => o.account === account && o.sub === sub)) return { account, sub };
  const byAccount = creditOptions.find((o) => o.account === account);
  if (byAccount) return byAccount;
  return creditOptions[0];
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
  inspectionDate?: string;
  isEstimate?: boolean;
  isPostReport?: boolean;
  registrationNumber?: string;
  isQualifiedInvoice?: string;
}

interface OcrData {
  voucherAmount?: number;
  amountMatch?: string;
  registrationNumber?: string;
  taxCategory?: string;
  driveFileId?: string;
  verifiedSupplierName?: string;  // 国税API確定の正式法人名
  voucherDate?: string;           // 証憑発行日（YYYY-MM-DD）
  voucherItems?: string;          // 証憑品名（カンマ区切り）
  mfVendorName?: string;          // MF取引先マスタ照合済み名称
  itemCategory?: string;          // 品目カテゴリ（物品/サービス/ソフトウェア...）
  itemNature?: string;            // 品目性質（消耗品/耐久財/無形資産/役務）
  aiSuggestion?: string;          // AI科目提案JSON
  katanaPo?: string;
  budgetNumber?: string;
}

interface JournalEdits {
  debitAccount: string;
  creditAccount: string;
  creditSubAccount: string;
  counterpartyCode: string;
  taxCategory: string;
  department: string;
  hubspotDealId: string;
  memo: string;
}

type Tab = "pending" | "registered" | "amazon" | "contracts";

// --- 仕訳明細コンポーネント ---

function JournalDetail({ r, edits, onEdit, masters, onSave, isSaving, saved, onRegister, isRegistering, result, onEstimation }: {
  r: PurchaseRequest;
  edits: Partial<JournalEdits>;
  onEdit: (field: keyof JournalEdits, value: string) => void;
  masters: MfMasters | null;
  onSave: () => void;
  isSaving: boolean;
  saved: boolean;
  onRegister: () => void;
  isRegistering: boolean;
  result?: { ok: boolean; message: string } | null;
  onEstimation?: (est: { account: string; confidence: string; taxType?: string }) => void;
}) {
  const accountNames = masters ? masters.accounts.map((a) => a.name) : null;
  const taxNames = masters ? masters.taxes.map((t) => t.name) : null;
  const deptNames = masters ? masters.departments.map((d) => d.name) : null;

  // OCRデータ・推定根拠を非同期取得（resolvedDebitで参照するため先に宣言）
  const [ocr, setOcr] = useState<OcrData | null>(null);
  const [estimation, setEstimation] = useState<{ account: string; confidence: string; reason: string; taxType?: string } | null>(null);
  const [isReEstimating, setIsReEstimating] = useState(false);
  const fetchedRef = useRef(false);

  const rawDebit = r.accountTitle?.split("（")[0]?.trim() || "";
  const creditOptions = buildCreditOptions(r.paymentMethod, masters);
  const projectOptions = masters?.projects.map((p) => p.code || p.name) || null;

  // 全フィールドを snapToOption で MF マスタ選択肢に正規化
  const debitAccount = snapToOption(
    edits.debitAccount ?? rawDebit, accountNames, "消耗品費",
  );
  const rawTaxCat = edits.taxCategory ?? resolveAccountTax(debitAccount, masters);
  const taxCat = snapToOption(rawTaxCat, taxNames);
  const dept = snapToOption(edits.department ?? r.department, deptNames);
  const defaultCredit = resolveCreditDefault(r.paymentMethod);
  const snappedCredit = snapToCreditOption(
    edits.creditAccount ?? defaultCredit.account,
    edits.creditSubAccount ?? defaultCredit.sub,
    creditOptions,
  );
  const creditAccount = snappedCredit.account;
  const creditSubAccount = snappedCredit.sub;
  const hubspot = snapToOption(
    edits.hubspotDealId ?? (r.hubspotInfo || ""),
    projectOptions ? ["", ...projectOptions] : null,
  );
  const baseDate = r.inspectionDate || r.applicationDate || new Date().toISOString().slice(0, 10);
  const parsedDate = new Date(baseDate);
  const ym = !isNaN(parsedDate.getTime())
    ? `${parsedDate.getFullYear()}/${String(parsedDate.getMonth() + 1).padStart(2, "0")}`
    : baseDate.slice(0, 7).replace("-", "/");
  const hasEdits = Object.keys(edits).length > 0;
  // Step 1: OCRデータ取得
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    apiFetch(`/api/purchase/${encodeURIComponent(r.prNumber)}/status`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: Record<string, string> }) => {
        if (json.success && json.data) {
          setOcr({
            voucherAmount: json.data["証憑金額"] ? Number(json.data["証憑金額"]) : undefined,
            amountMatch: json.data["金額照合"] || undefined,
            registrationNumber: json.data["適格番号"] || undefined,
            taxCategory: json.data["税区分"] || undefined,
            driveFileId: json.data["DriveファイルID"] || undefined,
            verifiedSupplierName: json.data["MF取引先"] || undefined,
            voucherDate: json.data["証憑発行日"] || undefined,
            voucherItems: json.data["証憑品名"] || undefined,
            mfVendorName: json.data["MF取引先"] || undefined,
            itemCategory: json.data["品目カテゴリ"] || undefined,
            itemNature: json.data["品目性質"] || undefined,
            aiSuggestion: json.data["AI科目提案"] || undefined,
            katanaPo: json.data["KATANA PO番号"] || undefined,
            budgetNumber: json.data["実行予算番号"] || undefined,
          });
        }
      })
      .catch(() => {});
  }, [r.prNumber]);

  // Step 2: OCR到着後にAI推定（証憑データ優先で呼ぶ）
  const estimationFetchedRef = useRef(false);
  useEffect(() => {
    if (estimationFetchedRef.current) return;
    if (ocr === null) return; // OCR未到着 — 待つ
    estimationFetchedRef.current = true;
    const params = new URLSearchParams({
      itemName: r.itemName || "",
      supplierName: r.supplierName || "",
      totalAmount: String(r.totalAmount || 0),
      department: r.department || "",
    });
    // 証憑データがあれば追加（API側で優先利用）
    if (ocr.verifiedSupplierName) params.set("verifiedSupplierName", ocr.verifiedSupplierName);
    if (ocr.voucherAmount) params.set("voucherAmount", String(ocr.voucherAmount));
    if (ocr.taxCategory) params.set("ocrTaxCategory", ocr.taxCategory);
    if (ocr.voucherItems) params.set("voucherItems", ocr.voucherItems);
    apiFetch(`/api/purchase/estimate-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prNumber: r.prNumber }),
    })
      .then((res) => res.json())
      .then((json: { account?: string; confidence?: string; reason?: string; taxType?: string }) => {
        if (json.account) {
          const est = json as { account: string; confidence: string; reason: string; taxType?: string };
          setEstimation(est);
          onEstimation?.(est);
        }
      })
      .catch(() => {});
  }, [ocr, r.prNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // masters ロード時にスナップ結果を edits に反映（未編集フィールドのみ）
  // rawDebit が空の場合は借方・税区分を書かない（AI推定待ち）
  const mastersLoadedRef = useRef(false);
  useEffect(() => {
    if (!masters || mastersLoadedRef.current) return;
    mastersLoadedRef.current = true;
    if (rawDebit && !edits.debitAccount) onEdit("debitAccount", debitAccount);
    if (rawDebit && !edits.taxCategory) onEdit("taxCategory", taxCat);
    if (!edits.department) onEdit("department", dept);
    if (!edits.creditAccount) {
      onEdit("creditAccount", creditAccount);
      onEdit("creditSubAccount", creditSubAccount);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masters]);

  // AI推定到着時: GAS科目が空の場合にMFマスタ内の推定結果を edits に反映
  const estimationAppliedRef = useRef(false);
  useEffect(() => {
    if (!estimation || !accountNames || estimationAppliedRef.current) return;
    if (rawDebit) return; // GASに科目があればAI推定は上書きしない
    estimationAppliedRef.current = true;
    const acct = snapToOption(estimation.account, accountNames);
    onEdit("debitAccount", acct);
    if (estimation.taxType && taxNames) {
      onEdit("taxCategory", snapToOption(estimation.taxType, taxNames));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimation, accountNames]);

  // 手動再推定
  const handleReEstimate = useCallback(async () => {
    setIsReEstimating(true);
    try {
      const res = await apiFetch(`/api/purchase/estimate-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: r.prNumber }),
      });
      const json = await res.json() as { account?: string; confidence?: string; reason?: string; taxType?: string };
      if (json.account && accountNames) {
        const acct = snapToOption(json.account, accountNames);
        onEdit("debitAccount", acct);
        if (json.taxType && taxNames) {
          onEdit("taxCategory", snapToOption(json.taxType, taxNames));
        }
        setEstimation(json as { account: string; confidence: string; reason: string; taxType?: string });
      }
    } catch (e) {
      console.error("[re-estimate] Error:", e);
    } finally {
      setIsReEstimating(false);
    }
  }, [r.prNumber, accountNames, taxNames, onEdit]);

  const amountMatchOk = ocr?.amountMatch?.includes("一致") || ocr?.amountMatch?.includes("承認済");
  const amountMatchNg = ocr?.amountMatch && !amountMatchOk;

  // 仕訳金額: 証憑金額（税込）優先、フォールバック発注データ
  const journalAmount = ocr?.voucherAmount || r.totalAmount;
  const amountSource = ocr?.voucherAmount ? "証憑" : "発注";
  const tax = calcTax(journalAmount, taxCat);
  // 取引先: T番号一致 → 国税API名一致 → 発注データ名部分一致
  const journalSupplierName = ocr?.verifiedSupplierName || r.supplierName;
  const regNum = ocr?.registrationNumber?.replace(/（.*）$/, "").trim(); // 「T...（検証失敗）」除外
  const matchedCounterparty = masters?.counterparties.find((c) => {
    // 1. T番号一致（最優先）
    if (regNum && regNum.startsWith("T") && c.invoiceRegistrationNumber) {
      if (c.invoiceRegistrationNumber === regNum) return true;
    }
    return false;
  }) || masters?.counterparties.find((c) => {
    // 2. 名前一致
    const q = journalSupplierName.trim();
    if (!q) return false;
    return c.name === q || c.name.includes(q) || q.includes(c.name);
  });
  const journalSupplierCode = matchedCounterparty?.code || matchedCounterparty?.name || "";
  // 摘要: 年月 PR番号 品名 [KATANA PO / 予算番号]
  const journalItemName = ocr?.voucherItems || r.itemName;
  const remarkParts = [ym, r.prNumber, journalItemName];
  if (ocr?.katanaPo) remarkParts.push(ocr.katanaPo);
  if (ocr?.budgetNumber) remarkParts.push(ocr.budgetNumber);
  const defaultMemo = edits.memo ?? remarkParts.join(" ");

  return (
    <div className="bg-gray-50 px-4 py-4 border-t text-xs">
      {/* 発注データ vs 証憑データの比較パネル */}
      {ocr && (ocr.voucherAmount || ocr.verifiedSupplierName || ocr.voucherDate || ocr.voucherItems) && (
        <div className="mb-3 border rounded bg-white p-3">
          <div className="font-medium text-gray-700 mb-2">発注データ / 証憑データ比較</div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-1 text-left text-gray-500 w-24">項目</th>
                <th className="px-2 py-1 text-left text-gray-400">発注（参考）</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700">証憑（正）</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="px-2 py-1 text-gray-500">金額</td>
                <td className="px-2 py-1 text-gray-400">¥{r.totalAmount.toLocaleString()}</td>
                <td className={`px-2 py-1 font-medium ${ocr.voucherAmount && ocr.voucherAmount !== r.totalAmount ? "text-amber-600" : "text-gray-900"}`}>
                  {ocr.voucherAmount ? `¥${ocr.voucherAmount.toLocaleString()}` : "-"}
                  {ocr.amountMatch && <span className={`ml-1 text-[10px] ${amountMatchOk ? "text-green-600" : "text-red-500"}`}>({ocr.amountMatch})</span>}
                </td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1 text-gray-500">取引先</td>
                <td className="px-2 py-1 text-gray-400">{r.supplierName}</td>
                <td className={`px-2 py-1 font-medium ${ocr.verifiedSupplierName ? "text-gray-900" : "text-gray-300"}`}>
                  {ocr.verifiedSupplierName || "-"}
                  {ocr.registrationNumber && !ocr.registrationNumber.includes("検証失敗") && ocr.registrationNumber !== "番号なし" && (
                    <span className="ml-1 text-[10px] text-green-600">({ocr.registrationNumber})</span>
                  )}
                </td>
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1 text-gray-500">税区分</td>
                <td className="px-2 py-1 text-gray-400">{taxCat}</td>
                <td className="px-2 py-1 font-medium">{ocr.taxCategory || "-"}</td>
              </tr>
              {ocr.voucherDate && (
                <tr className="border-t">
                  <td className="px-2 py-1 text-gray-500">発行日</td>
                  <td className="px-2 py-1 text-gray-400">{r.applicationDate}</td>
                  <td className="px-2 py-1 font-medium">{ocr.voucherDate}</td>
                </tr>
              )}
              {ocr.voucherItems && (
                <tr className="border-t">
                  <td className="px-2 py-1 text-gray-500">品名</td>
                  <td className="px-2 py-1 text-gray-400 truncate max-w-[120px]" title={r.itemName}>{r.itemName}</td>
                  <td className="px-2 py-1 font-medium truncate max-w-[200px]" title={ocr.voucherItems}>{ocr.voucherItems}</td>
                </tr>
              )}
              {(ocr.itemCategory || ocr.itemNature) && (
                <tr className="border-t">
                  <td className="px-2 py-1 text-gray-500">AI分類</td>
                  <td className="px-2 py-1 text-gray-400" colSpan={2}>
                    {ocr.itemCategory && <span className="inline-block bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 mr-1">{ocr.itemCategory}</span>}
                    {ocr.itemNature && <span className="inline-block bg-purple-50 text-purple-700 rounded px-1.5 py-0.5">{ocr.itemNature}</span>}
                  </td>
                </tr>
              )}
              {ocr.aiSuggestion && (() => {
                try {
                  const suggestions = JSON.parse(ocr.aiSuggestion) as { account: string; confidence: string; reason: string }[];
                  return (
                    <tr className="border-t">
                      <td className="px-2 py-1 text-gray-500">AI推定</td>
                      <td className="px-2 py-1 text-gray-400" colSpan={2}>
                        {suggestions.map((s, i) => (
                          <span key={i} className={`inline-block rounded px-1.5 py-0.5 mr-1 mb-0.5 ${s.confidence === "high" ? "bg-green-50 text-green-700" : s.confidence === "medium" ? "bg-yellow-50 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                            {s.account} <span className="text-[9px]">({s.reason})</span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                } catch { return null; }
              })()}
              {(ocr.katanaPo || ocr.budgetNumber) && (
                <tr className="border-t">
                  <td className="px-2 py-1 text-gray-500">番号</td>
                  <td className="px-2 py-1 text-gray-400" colSpan={2}>
                    {ocr.katanaPo && <span className="mr-2">KATANA: {ocr.katanaPo}</span>}
                    {ocr.budgetNumber && <span>予算: {ocr.budgetNumber}</span>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左: 証憑プレビュー + OCR結果 */}
        <div className="flex flex-col">
          <div className="font-medium text-gray-700 mb-2 flex items-center justify-between">
            <span>証憑プレビュー</span>
            <div className="flex gap-2">
              {r.slackLink && (
                <a href={r.slackLink} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                  onClick={(e) => e.stopPropagation()}>
                  Slackスレッド
                </a>
              )}
              {ocr?.driveFileId && (
                <a href={`https://drive.google.com/file/d/${ocr.driveFileId}/view`} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
                  onClick={(e) => e.stopPropagation()}>
                  Google Driveで開く
                </a>
              )}
            </div>
          </div>

          {/* ドキュメントビューア */}
          <div className="bg-white border rounded flex-1 min-h-[300px] flex flex-col">
            <div className="flex-1 bg-gray-100 rounded-t flex items-center justify-center relative overflow-hidden">
              {ocr?.driveFileId ? (
                <iframe
                  src={`https://drive.google.com/file/d/${ocr.driveFileId}/preview`}
                  className="w-full h-full min-h-[280px] rounded-t"
                  allow="autoplay"
                  title="証憑プレビュー"
                />
              ) : (
                <div className="text-center text-gray-400 p-8">
                  <div className="text-5xl mb-3">
                    {r.voucherType === "領収書" ? "\uD83E\uDDFE" : r.voucherType === "請求書" ? "\uD83D\uDCC4" : "\uD83D\uDCE6"}
                  </div>
                  <div className="text-sm font-medium text-gray-500 mb-1">{r.voucherType || "証憑"}</div>
                  <div className="text-[10px] text-gray-300 mt-2">Slackスレッドで��憑ファイルを確認できます</div>
                </div>
              )}
            </div>

            {/* OCR読取結果バー */}
            <div className="p-3 border-t bg-white rounded-b">
              <div className="font-medium text-gray-600 mb-1.5">OCR読取結果</div>
              {ocr ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ocr.taxCategory && (
                    <div className="bg-gray-50 rounded p-1.5">
                      <div className="text-gray-400 text-[10px]">税区分</div>
                      <div className="font-medium">{ocr.taxCategory}</div>
                    </div>
                  )}
                  {ocr.voucherAmount != null && (
                    <div className={`rounded p-1.5 ${amountMatchOk ? "bg-green-50" : amountMatchNg ? "bg-red-50" : "bg-gray-50"}`}>
                      <div className="text-gray-400 text-[10px]">証憑金額</div>
                      <div className={`font-medium ${amountMatchOk ? "text-green-700" : amountMatchNg ? "text-red-600" : ""}`}>
                        ¥{ocr.voucherAmount.toLocaleString()}
                      </div>
                    </div>
                  )}
                  {ocr.amountMatch && (
                    <div className={`rounded p-1.5 ${amountMatchOk ? "bg-green-50" : "bg-red-50"}`}>
                      <div className="text-gray-400 text-[10px]">金額照合</div>
                      <div className={`font-medium text-xs ${amountMatchOk ? "text-green-700" : "text-red-600"}`}>
                        {ocr.amountMatch}
                      </div>
                    </div>
                  )}
                  {ocr.registrationNumber ? (
                    <div className={`rounded p-1.5 ${ocr.registrationNumber.includes("検証���敗") || ocr.registrationNumber === "番号なし" ? "bg-amber-50" : "bg-green-50"}`}>
                      <div className="text-gray-400 text-[10px]">適格請求書</div>
                      <div className={`font-medium text-xs truncate ${ocr.registrationNumber.includes("検証失敗") || ocr.registrationNumber === "番号なし" ? "text-amber-600" : "text-green-700"}`}>
                        {ocr.registrationNumber}
                      </div>
                    </div>
                  ) : r.voucherType === "請求書" ? (
                    <div className="bg-amber-50 rounded p-1.5">
                      <div className="text-gray-400 text-[10px]">適格請求書</div>
                      <div className="font-medium text-amber-600 text-xs">番号未検出</div>
                    </div>
                  ) : null}
                  {r.isQualifiedInvoice === "非適格" && (
                    <div className="bg-red-50 rounded p-1.5">
                      <div className="text-gray-400 text-[10px]">経過措置</div>
                      <div className="font-medium text-red-600 text-xs">80%控除（〜2026/9）</div>
                    </div>
                  )}
                  {estimation && (
                    <div className="bg-blue-50 rounded p-1.5">
                      <div className="text-gray-400 text-[10px]">AI推定根拠</div>
                      <div className="font-medium text-blue-700 text-xs">{estimation.account}</div>
                      <div className="text-[10px] text-blue-500">{estimation.reason}</div>
                      {estimation.taxType && (
                        <div className="text-[10px] text-blue-400 mt-0.5">税区分: {estimation.taxType}</div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        信頼度: <span className={estimation.confidence === "high" ? "text-green-600" : estimation.confidence === "medium" ? "text-amber-600" : "text-red-500"}>{estimation.confidence}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-gray-400 text-xs">読み込み中...</div>
              )}
            </div>
          </div>
        </div>

        {/* 右: 仕訳プレビュー + 編集フォーム */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium text-gray-700 mb-2">仕訳プレビュー</div>
            <div className="overflow-x-auto">
            <table className="w-full border text-xs">
              <thead><tr className="bg-gray-100"><th className="px-2 py-1.5 text-left">区分</th><th className="px-2 py-1.5 text-left">勘定科目</th><th className="px-2 py-1.5 text-left">補助</th><th className="px-2 py-1.5 text-right">金額</th><th className="px-2 py-1.5 text-right">消費税</th></tr></thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-2 py-1.5 text-blue-700 font-medium">借方</td>
                  <td className="px-2 py-1.5">{debitAccount}</td>
                  <td className="px-2 py-1.5 text-gray-400">-</td>
                  <td className="px-2 py-1.5 text-right">
                    ¥{journalAmount.toLocaleString()}
                    {amountSource === "証憑" && <span className="ml-1 text-[10px] text-green-600">(証憑)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-500">¥{tax.toLocaleString()}</td>
                </tr>
                <tr className="border-t">
                  <td className="px-2 py-1.5 text-red-700 font-medium">貸方</td>
                  <td className="px-2 py-1.5">{creditAccount}</td>
                  <td className="px-2 py-1.5 text-gray-500">{creditSubAccount || "-"}</td>
                  <td className="px-2 py-1.5 text-right">¥{journalAmount.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">-</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-gray-700">仕訳内容の編集</div>

            {!masters && (
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700 mb-2">
                MF会計マスタ未読込 — 先にMF会計認証を完了してください
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-gray-500 text-xs">借方科目</span>
                <div className="flex gap-1 items-center mt-0.5">
                  {accountNames ? (
                    <select value={debitAccount}
                      onChange={(e) => {
                        onEdit("debitAccount", e.target.value);
                        const newTax = resolveAccountTax(e.target.value, masters);
                        onEdit("taxCategory", newTax);
                      }}
                      aria-label="借方科目"
                      className="flex-1 px-2 py-1.5 border rounded text-xs bg-white">
                      {accountNames.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={edits.debitAccount ?? rawDebit} onChange={(e) => onEdit("debitAccount", e.target.value)}
                      className="flex-1 px-2 py-1.5 border rounded text-xs" />
                  )}
                  <button
                    type="button"
                    onClick={handleReEstimate}
                    disabled={isReEstimating}
                    title="AI再推定"
                    className="shrink-0 px-1.5 py-1.5 border rounded text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {isReEstimating ? "..." : "AI"}
                  </button>
                </div>
                {estimation && (
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    <span role="img" aria-label={estimation.confidence === "high" ? "高信頼度" : estimation.confidence === "medium" ? "中信頼度" : "低信頼度"}>{estimation.confidence === "high" ? "🟢" : estimation.confidence === "medium" ? "🟡" : "🔴"}</span> {estimation.reason}
                  </div>
                )}
              </label>
              <label className="block">
                <span className="text-gray-500 text-xs">貸方科目</span>
                <select value={`${creditAccount}|${creditSubAccount}`}
                  onChange={(e) => {
                    const [acc, sub] = e.target.value.split("|");
                    onEdit("creditAccount", acc);
                    onEdit("creditSubAccount", sub || "");
                  }}
                  aria-label="貸方科目"
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
                {taxNames ? (
                  <select value={taxCat} onChange={(e) => onEdit("taxCategory", e.target.value)}
                    aria-label="税区分"
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                    {taxNames.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input type="text" value={edits.taxCategory ?? taxCat} onChange={(e) => onEdit("taxCategory", e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
                )}
              </label>
              <label className="block">
                <span className="text-gray-500 text-xs">部門</span>
                {deptNames ? (
                  <select value={dept} onChange={(e) => onEdit("department", e.target.value)}
                    aria-label="部門"
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                    {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <input type="text" value={edits.department ?? r.department} onChange={(e) => onEdit("department", e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
                )}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-gray-500 text-xs">プロジェクト</span>
                {masters && masters.projects.length > 0 ? (
                  <select value={hubspot} onChange={(e) => onEdit("hubspotDealId", e.target.value)}
                    aria-label="プロジェクト"
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                    <option value="">（なし）</option>
                    {masters.projects.map((p) => (
                      <option key={p.code || p.name} value={p.code || p.name}>
                        {p.code ? `${p.code} ${p.name}` : p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={hubspot} onChange={(e) => onEdit("hubspotDealId", e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
                )}
              </label>
              <label className="block">
                <span className="text-gray-500 text-xs">取引先</span>
                {masters && masters.counterparties.length > 0 ? (
                  <select value={edits.counterpartyCode ?? journalSupplierCode}
                    onChange={(e) => onEdit("counterpartyCode", e.target.value)}
                    aria-label="取引先"
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs bg-white">
                    <option value="">（なし）</option>
                    {masters.counterparties.map((c) => (
                      <option key={c.code || c.name} value={c.code || c.name}>
                        {c.name}{c.invoiceRegistrationNumber ? ` (${c.invoiceRegistrationNumber})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={edits.counterpartyCode ?? journalSupplierName}
                    onChange={(e) => onEdit("counterpartyCode", e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
                )}
              </label>
            </div>

            <label className="block">
              <span className="text-gray-500 text-xs">摘要</span>
              <input type="text" value={defaultMemo} onChange={(e) => onEdit("memo", e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" />
            </label>

            {/* 保存・登録ボタン */}
            <div className="mt-3 pt-3 border-t flex gap-2">
              {/* 編集内容を保存 */}
              <button onClick={onSave} disabled={isSaving || !hasEdits}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg disabled:cursor-not-allowed ${
                  hasEdits
                    ? "bg-gray-700 text-white hover:bg-gray-800 disabled:bg-gray-300"
                    : saved
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-gray-100 text-gray-400 border border-gray-200"
                }`}>
                {isSaving ? "保存中..." : saved && !hasEdits ? "保存済み" : "保存"}
              </button>

              {/* MF会計に仕訳登録 */}
              {result?.ok ? (
                <div className="flex-1 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 text-center">{result.message}</div>
              ) : result && !result.ok ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-xs text-red-600 truncate">{result.message}</span>
                  <button onClick={onRegister} className="text-xs px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 shrink-0">再試行</button>
                </div>
              ) : (
                <button onClick={onRegister} disabled={isRegistering || isSaving || hasEdits}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  title={hasEdits ? "先に保存してください" : ""}>
                  {isRegistering ? "登録中..." : `仕訳登録（¥${journalAmount.toLocaleString()}）`}
                </button>
              )}
            </div>
            {hasEdits && (
              <p className="text-amber-600 text-xs mt-1">* 未保存の変更あり — 先に保存してから仕訳登録</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- メインコンポーネント ---

export default function JournalManagement() {
  const user = useUser();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [registering, setRegistering] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedEdits, setSavedEdits] = useState<Record<string, boolean>>({});
  const [bulkRegistering, setBulkRegistering] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Partial<JournalEdits>>>({});
  const [masters, setMasters] = useState<MfMasters | null>(null);
  const [mastersError, setMastersError] = useState("");
  const [estimations, setEstimations] = useState<Record<string, { account: string; confidence: string; taxType?: string }>>({});
  const [mfAuth, setMfAuth] = useState<{
    authenticated: boolean;
    cookieDaysRemaining: number | null;
    cookieExpiresAt: string | null;
  } | null>(null);
  const [mfAuthLoaded, setMfAuthLoaded] = useState(false);

  // MF認証ステータス取得
  const fetchAuthStatus = useCallback(() => {
    apiFetch("/api/mf/auth/status")
      .then((r) => r.json())
      .then((d: { authenticated: boolean; cookieDaysRemaining: number | null; cookieExpiresAt: string | null }) => {
        setMfAuth(d);
      })
      .catch(() => setMfAuth({ authenticated: false, cookieDaysRemaining: null, cookieExpiresAt: null }))
      .finally(() => setMfAuthLoaded(true));
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch("/api/purchase/recent?limit=100")
      .then((r) => r.json())
      .then((d: { requests?: PurchaseRequest[] }) => setRequests(d.requests || []))
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  // ページ読み込み時: 認証 + マスタ + 申請データを並列取得
  useEffect(() => {
    // URLパラメータでmf_auth=okなら認証完了→パラメータ消す
    if (typeof window !== "undefined" && window.location.search.includes("mf_auth=ok")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // SWRキャッシュで即時表示 → バックグラウンド更新
    // 認証ステータス（キャッシュ不要 — 軽量）
    apiFetch("/api/mf/auth/status").then((r) => r.json())
      .then((d) => setMfAuth(d || { authenticated: false, cookieDaysRemaining: null, cookieExpiresAt: null }))
      .catch(() => setMfAuth({ authenticated: false, cookieDaysRemaining: null, cookieExpiresAt: null }))
      .finally(() => setMfAuthLoaded(true));

    // マスタ + 申請データを SWR で並列取得
    type MastersData = { ok?: boolean; accounts?: MfMasters["accounts"]; taxes?: MfMasters["taxes"]; departments?: MfMasters["departments"]; subAccounts?: MfMasters["subAccounts"]; projects?: MfMasters["projects"]; counterparties?: MfMasters["counterparties"]; error?: string };
    type ReqData = { requests?: PurchaseRequest[] };

    const mastersReady = apiFetchSWR<MastersData>(
      "/api/mf/masters", "journals:masters",
      (masData) => {
        if (masData?.ok && masData.accounts) {
          setMasters({
            accounts: masData.accounts || [],
            taxes: masData.taxes || [],
            departments: masData.departments || [],
            subAccounts: masData.subAccounts || [],
            projects: masData.projects || [],
            counterparties: masData.counterparties || [],
          });
        } else {
          setMastersError(masData?.error || "マスタ取得失敗");
        }
      },
    );

    const dataReady = apiFetchSWR<ReqData>(
      "/api/purchase/recent?limit=100", "journals:requests",
      (reqData) => {
        if (reqData?.requests) {
          setRequests(reqData.requests);
        } else {
          setError("データの取得に失敗しました");
        }
      },
    );

    Promise.all([mastersReady, dataReady]).then(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = requests.filter((r) =>
    r.voucherStatus === "添付済" &&
    r.inspectionStatus === "検収済" &&
    r.approvalStatus === "承認済" &&
    !results[r.prNumber]?.ok
  );

  const registered = requests.filter((r) =>
    (results[r.prNumber]?.ok || r.journalId) &&
    r.approvalStatus !== "却下" &&
    r.approvalStatus !== "取消"
  );

  const displayed = tab === "pending" ? pending : registered;
  const totalPendingAmount = pending.reduce((s, r) => s + r.totalAmount, 0);

  const toggleExpand = (pr: string) => setExpanded((p) => ({ ...p, [pr]: !p[pr] }));
  const handleEdit = (pr: string, field: keyof JournalEdits, value: string) => {
    setSavedEdits((p) => ({ ...p, [pr]: false }));
    setEdits((p) => ({ ...p, [pr]: { ...p[pr], [field]: value } }));
  };

  const saveEdits = async (prNumber: string) => {
    const e = edits[prNumber];
    if (!e || Object.keys(e).length === 0) return;
    setSaving((prev) => ({ ...prev, [prNumber]: true }));
    try {
      const updates: Record<string, string> = {};
      if (e.debitAccount) updates["勘定科目"] = e.debitAccount;
      if (e.taxCategory) updates["税区分"] = e.taxCategory;
      if (e.department) updates["部門"] = e.department;
      if (e.counterpartyCode) updates["MF取引先"] = e.counterpartyCode;
      if (e.memo) updates["MF摘要"] = e.memo;
      if (e.hubspotDealId !== undefined) updates["HubSpot案件番号"] = e.hubspotDealId;

      await apiFetch(`/api/purchase/${encodeURIComponent(prNumber)}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      // 科目変更があれば修正履歴を記録（学習ループ用）
      if (e.debitAccount) {
        const r = requests.find((req) => req.prNumber === prNumber);
        const est = estimations[prNumber];
        const originalAccount = r?.accountTitle?.split("（")[0]?.trim() || "";
        const estimatedAccount = est?.account || originalAccount || "";
        if (estimatedAccount && e.debitAccount !== estimatedAccount) {
          apiFetch("/api/admin/account-correction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              poNumber: prNumber,
              itemName: r?.itemName || "",
              supplierName: r?.supplierName || "",
              department: r?.department || "",
              totalAmount: r?.totalAmount || 0,
              estimatedAccount,
              estimatedTaxType: est?.taxType || "",
              estimatedConfidence: est?.confidence || "",
              correctedAccount: e.debitAccount,
              correctedTaxType: e.taxCategory || "",
              correctedBy: user.name || "admin",
            }),
          }).catch(() => {}); // 修正記録の失敗は保存処理に影響させない
        }
      }

      setSavedEdits((prev) => ({ ...prev, [prNumber]: true }));
      setEdits((prev) => ({ ...prev, [prNumber]: {} }));
    } catch {
      // 保存失敗はeditsを維持
    } finally {
      setSaving((prev) => ({ ...prev, [prNumber]: false }));
    }
  };

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
        swrInvalidate("journals:requests");
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

  // 管理本部以外はアクセス不可
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-800 text-sm">&larr; ダッシュボード</a>
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
        {/* MF会計Plus認証ステータス — mastersErrorまたはauth/statusから判定 */}
        {(() => {
          const needsAuth = mastersError?.includes("未認証") || (mfAuthLoaded && (!mfAuth || !mfAuth.authenticated));
          const nearExpiry = mfAuth?.authenticated && mfAuth.cookieDaysRemaining != null && mfAuth.cookieDaysRemaining <= 7;
          const isOk = mfAuth?.authenticated && !nearExpiry;

          if (needsAuth) return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-red-800">MF会計Plus: 未認証</span>
                <span className="text-xs text-red-600 ml-2">仕訳登録・マスタ取得にはMF会計Plusの認証が必要です</span>
              </div>
              <a href="/api/mf/auth?force=true"
                className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 whitespace-nowrap">
                MF会計に認証
              </a>
            </div>
          );
          if (nearExpiry) return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-amber-800">MF会計Plus: 認証期限が近づいています</span>
                <span className="text-xs text-amber-600 ml-2">
                  残り{mfAuth.cookieDaysRemaining}日（{mfAuth.cookieExpiresAt ? new Date(mfAuth.cookieExpiresAt).toLocaleDateString("ja-JP") : ""}まで）
                </span>
              </div>
              <a href="/api/mf/auth?force=true"
                className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700">
                再認証
              </a>
            </div>
          );
          if (isOk) return (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-green-600">
                MF会計Plus認証済
                {mfAuth.cookieDaysRemaining != null && `（残り${mfAuth.cookieDaysRemaining}日）`}
              </span>
              <a href="/api/mf/auth?force=true" className="text-[10px] text-gray-400 hover:text-gray-600 underline">再認証</a>
            </div>
          );
          return null;
        })()}

        {mastersError && !mastersError.includes("未認証") && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
            MF会計マスタ: {mastersError}（フォールバック値を使用中）
          </div>
        )}
        {masters && !mastersError && (
          <div className="text-xs text-green-600 mb-2">
            MF会計マスタ読込済（科目{masters.accounts.length} / 税区分{masters.taxes.length} / 部門{masters.departments.length} / PJ{masters.projects.length} / 取引先{masters.counterparties.length}）
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
          <button onClick={() => setTab("amazon")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "amazon" ? "bg-blue-100 text-blue-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            Amazon照合
          </button>
          <button onClick={() => setTab("contracts")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "contracts" ? "bg-purple-100 text-purple-800" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            契約仕訳
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

        {tab === "contracts" ? (
          <ContractJournalTab masters={masters} />
        ) : tab === "amazon" ? (
          <AmazonMatchingTab requests={requests} />
        ) : loading ? (
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
                    <th className="px-3 py-2.5 font-medium text-gray-600">購買番号</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 w-16">区分</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">品目</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-right">発注金額</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">借方</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">貸方</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">税区分</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">部門</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">PJ</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-center">適格</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => {
                    const result = results[r.prNumber];
                    const isReg = registering[r.prNumber];
                    const isExpanded = expanded[r.prNumber];
                    const e = edits[r.prNumber] || {};
                    const acctNames = masters ? masters.accounts.map((a) => a.name) : null;
                    const txNames = masters ? masters.taxes.map((t) => t.name) : null;
                    const dpNames = masters ? masters.departments.map((d) => d.name) : null;
                    const rawDebitRow = r.accountTitle?.split("（")[0]?.trim() || "";
                    const debit = snapToOption(e.debitAccount ?? rawDebitRow, acctNames, "消耗品費");
                    const creditOpts = buildCreditOptions(r.paymentMethod, masters);
                    const credit = resolveCreditDefault(r.paymentMethod);
                    const snapped = snapToCreditOption(e.creditAccount ?? credit.account, e.creditSubAccount ?? credit.sub, creditOpts);
                    const creditAcc = snapped.account;
                    const creditSub = snapped.sub;
                    const taxCat = snapToOption(e.taxCategory ?? resolveAccountTax(debit, masters), txNames);
                    const dept = snapToOption(e.department ?? r.department, dpNames);
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
                        <td className="px-3 py-2.5 text-xs">
                          <div className="flex gap-0.5">
                            {r.isEstimate && <span className="px-1 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px]" title="概算（金額未確定）">概算</span>}
                            {r.isPostReport && <span className="px-1 py-0.5 bg-red-100 text-red-700 rounded text-[10px]" title="事後報告（緊急購入）">事後</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.itemName}>{r.itemName}</td>
                        <td className="px-3 py-2.5 text-right font-mono">¥{r.totalAmount.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs">{!rawDebitRow && !e.debitAccount ? <span className="text-gray-400">AI推定中...</span> : debit}</td>
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
                        <td className="px-3 py-2.5 text-center text-xs">
                          {r.isQualifiedInvoice === "適格" ? (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded" title={r.registrationNumber || ""}>適格</span>
                          ) : r.isQualifiedInvoice === "非適格" ? (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">非適格
                              <span className="block text-[9px] text-red-500">80%控除</span>
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {result?.ok ? (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">{result.message}</span>
                          ) : result && !result.ok ? (
                            <span className="text-xs text-red-600 max-w-[120px] truncate" title={result.message}>{result.message}</span>
                          ) : tab === "pending" ? (
                            <span className="text-xs text-gray-400">展開して登録</span>
                          ) : (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                              {r.journalId ? `MF仕訳ID: ${r.journalId}` : "登録済み"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.prNumber}-detail`}>
                          <td colSpan={12}>
                            <JournalDetail r={r} edits={e} onEdit={(field, value) => handleEdit(r.prNumber, field, value)} masters={masters}
                              onSave={() => saveEdits(r.prNumber)} isSaving={saving[r.prNumber] || false} saved={savedEdits[r.prNumber] || false}
                              onRegister={() => registerJournal(r.prNumber)} isRegistering={isReg} result={result}
                              onEstimation={(est) => setEstimations((prev) => ({ ...prev, [r.prNumber]: est }))} />
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

"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

const CATEGORIES = ["派遣", "外注", "SaaS", "顧問", "賃貸", "保守", "清掃", "その他"] as const;
const BILLING_TYPES = ["固定", "従量", "カード自動"] as const;
const RENEWAL_TYPES = ["自動更新", "都度更新", "期間満了"] as const;
const PAYMENT_METHODS = ["", "振込", "口座引落", "MFビジネスカード", "クレジットカード", "その他"] as const;

interface FormData {
  category: string;
  billing_type: string;
  vendor_name: string;
  monthly_amount: string;
  annual_amount: string;
  budget_limit: string;
  contract_start_date: string;
  contract_end_date: string;
  renewal_type: string;
  account_title: string;
  department: string;
  payment_method: string;
  payment_day: string;
  notes: string;
  auto_approve_fixed: boolean;
}

const initialForm: FormData = {
  category: "SaaS",
  billing_type: "固定",
  vendor_name: "",
  monthly_amount: "",
  annual_amount: "",
  budget_limit: "",
  contract_start_date: "",
  contract_end_date: "",
  renewal_type: "自動更新",
  account_title: "",
  department: "",
  payment_method: "",
  payment_day: "",
  notes: "",
  auto_approve_fixed: false,
};

export default function NewContractPage() {
  const user = useUser();
  const [form, setForm] = useState<FormData>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("prefill") !== "1") return;

    const category = params.get("category");
    const billingType = params.get("billingType");
    const supplierName = params.get("supplierName");
    const accountTitle = params.get("accountTitle");
    const monthlyAmount = params.get("monthlyAmount");
    const department = params.get("department");

    setForm((prev) => ({
      ...prev,
      category: category && CATEGORIES.includes(category as typeof CATEGORIES[number]) ? category : prev.category,
      billing_type: billingType && BILLING_TYPES.includes(billingType as typeof BILLING_TYPES[number]) ? billingType : prev.billing_type,
      vendor_name: supplierName || prev.vendor_name,
      account_title: accountTitle || prev.account_title,
      monthly_amount: monthlyAmount || prev.monthly_amount,
      department: department || prev.department,
    }));
    setPrefilled(true);
  }, []);

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

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function showMonthly() {
    return form.billing_type === "固定" || form.billing_type === "従量";
  }

  function showAnnual() {
    return form.billing_type === "固定";
  }

  function showBudgetLimit() {
    return form.billing_type === "従量" || form.billing_type === "カード自動";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!form.vendor_name.trim()) { setError("取引先名は必須です"); return; }
    if (!form.contract_start_date) { setError("契約開始日は必須です"); return; }
    if (!form.account_title.trim()) { setError("勘定科目は必須です"); return; }
    if (!form.department.trim()) { setError("部門は必須です"); return; }

    setSubmitting(true);
    try {
      const body = {
        category: form.category,
        billingType: form.billing_type,
        supplierName: form.vendor_name.trim(),
        monthlyAmount: form.monthly_amount ? Number(form.monthly_amount) : null,
        annualAmount: form.annual_amount ? Number(form.annual_amount) : null,
        budgetAmount: form.budget_limit ? Number(form.budget_limit) : null,
        contractStartDate: form.contract_start_date,
        contractEndDate: form.contract_end_date || null,
        renewalType: form.renewal_type,
        accountTitle: form.account_title.trim(),
        department: form.department.trim(),
        paymentMethod: form.payment_method || null,
        paymentDay: form.payment_day ? Number(form.payment_day) : null,
        notes: form.notes.trim(),
        autoApprove: form.auto_approve_fixed,
      };

      const res = await apiFetch("/api/admin/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "登録に失敗しました");
      }

      const data = await res.json();
      window.location.href = `/admin/contracts/${data.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300";
  const labelClass = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/contracts" className="text-sm text-gray-400 hover:text-gray-600">&larr; 一覧に戻る</a>
        <h1 className="text-xl font-bold">新規契約登録</h1>
      </div>

      {prefilled && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 text-sm text-blue-800">
          💡 候補リストから値を自動入力しました。内容を確認して「登録する」を押してください。
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">基本情報</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>カテゴリ</label>
              <select
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
                className={inputClass}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className={labelClass}>請求タイプ</label>
              <select
                value={form.billing_type}
                onChange={(e) => updateField("billing_type", e.target.value)}
                className={inputClass}
              >
                {BILLING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>取引先名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.vendor_name}
                onChange={(e) => updateField("vendor_name", e.target.value)}
                className={inputClass}
                placeholder="例: 株式会社サンプル"
                required
              />
            </div>
          </div>
        </div>

        {/* Amount */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">金額</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {showMonthly() && (
              <div>
                <label className={labelClass}>月額</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-gray-400">&yen;</span>
                  <input
                    type="number"
                    value={form.monthly_amount}
                    onChange={(e) => updateField("monthly_amount", e.target.value)}
                    className={`${inputClass} pl-7`}
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>
            )}

            {showAnnual() && (
              <div>
                <label className={labelClass}>年額</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-gray-400">&yen;</span>
                  <input
                    type="number"
                    value={form.annual_amount}
                    onChange={(e) => updateField("annual_amount", e.target.value)}
                    className={`${inputClass} pl-7`}
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>
            )}

            {showBudgetLimit() && (
              <div>
                <label className={labelClass}>予算上限</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-gray-400">&yen;</span>
                  <input
                    type="number"
                    value={form.budget_limit}
                    onChange={(e) => updateField("budget_limit", e.target.value)}
                    className={`${inputClass} pl-7`}
                    placeholder="0"
                    min="0"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contract period */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">契約期間</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>契約開始日 <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={form.contract_start_date}
                onChange={(e) => updateField("contract_start_date", e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>契約終了日</label>
              <input
                type="date"
                value={form.contract_end_date}
                onChange={(e) => updateField("contract_end_date", e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>更新タイプ</label>
              <select
                value={form.renewal_type}
                onChange={(e) => updateField("renewal_type", e.target.value)}
                className={inputClass}
              >
                {RENEWAL_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Accounting */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">会計情報</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>勘定科目 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.account_title}
                onChange={(e) => updateField("account_title", e.target.value)}
                className={inputClass}
                placeholder="例: 業務委託費"
                required
              />
            </div>

            <div>
              <label className={labelClass}>部門 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.department}
                onChange={(e) => updateField("department", e.target.value)}
                className={inputClass}
                placeholder="例: 開発部"
                required
              />
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">支払情報</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>支払方法</label>
              <select
                value={form.payment_method}
                onChange={(e) => updateField("payment_method", e.target.value)}
                className={inputClass}
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>{p || "未設定"}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>支払日（毎月）</label>
              <select
                value={form.payment_day}
                onChange={(e) => updateField("payment_day", e.target.value)}
                className={inputClass}
              >
                <option value="">未設定</option>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>毎月{d}日</option>
                ))}
                <option value="31">月末</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notes & options */}
        <div className="bg-white border rounded-xl p-4 sm:p-6">
          <h2 className="font-bold text-gray-800 mb-4">その他</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>備考</label>
              <textarea
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                className={`${inputClass} h-24 resize-y`}
                placeholder="契約に関する補足事項"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_approve_fixed}
                onChange={(e) => updateField("auto_approve_fixed", e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">定額一致時に自動承認</span>
            </label>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <a
            href="/admin/contracts"
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            キャンセル
          </a>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "登録中..." : "登録する"}
          </button>
        </div>
      </form>
    </div>
  );
}

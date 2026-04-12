"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

/**
 * 立替精算ページ /expense/new
 *
 * 購入済（立替）専用の簡易フォーム。
 * - 申請区分は「購入済」固定
 * - 支払方法は「立替」デフォルト
 * - 承認・発注・検収ステップはスキップ → 即「証憑待ち」
 * - 証憑（レシート/領収書）の添付を強調
 *
 * 送信先: POST /api/purchase/submit (request_type=購入済)
 */

interface FormValues {
  itemName: string;
  amount: string;
  quantity: string;
  supplierName: string;
  paymentMethod: string;
  url: string;
  purpose: string;
  notes: string;
}

const INITIAL: FormValues = {
  itemName: "",
  amount: "",
  quantity: "1",
  supplierName: "",
  paymentMethod: "立替",
  url: "",
  purpose: "",
  notes: "",
};

const PAYMENT_OPTIONS = [
  { value: "立替", label: "立替（個人支払い → 給与精算）" },
  { value: "会社カード", label: "会社カード（MFバーチャルカード）" },
  { value: "請求書払い", label: "請求書払い" },
];

function formatYen(n: number): string {
  return `\u00a5${n.toLocaleString()}`;
}

export default function ExpenseNewPage() {
  const user = useUser();
  const router = useRouter();

  const [values, setValues] = useState<FormValues>(INITIAL);
  const [step, setStep] = useState(1); // 1: 入力, 2: 確認, 3: 完了
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; poNumber?: string } | null>(null);

  const set = useCallback(<K extends keyof FormValues>(key: K, val: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const amount = parseInt(values.amount.replace(/[,，]/g, ""), 10) || 0;
  const quantity = parseInt(values.quantity || "1", 10) || 1;
  const totalAmount = amount * quantity;

  // --- バリデーション ---
  const errors: string[] = [];
  if (step >= 2) {
    if (!values.itemName.trim()) errors.push("品目名を入力してください");
    if (amount <= 0) errors.push("金額を入力してください");
    if (!values.supplierName.trim()) errors.push("購入先を入力してください");
  }

  const canProceed = values.itemName.trim() && amount > 0 && values.supplierName.trim();

  // --- 送信 ---
  const handleSubmit = useCallback(async () => {
    if (!user?.slackId || submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("user_id", user.slackId);
      fd.set("applicant_name", user.name || "");
      fd.set("department", user.departmentName || "");
      fd.set("request_type", "購入済");
      fd.set("item_name", values.itemName.trim());
      fd.set("amount", String(amount));
      fd.set("quantity", String(quantity));
      fd.set("supplier_name", values.supplierName.trim());
      fd.set("payment_method", values.paymentMethod);
      fd.set("url", values.url.trim());
      fd.set("asset_usage", values.purpose.trim());
      fd.set("notes", values.notes.trim());

      const res = await apiFetch("/api/purchase/submit", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: "立替精算を申請しました", poNumber: data.poNumber });
        setStep(3);
      } else {
        setResult({ ok: false, message: data.error || "送信に失敗しました" });
      }
    } catch (err) {
      setResult({ ok: false, message: `通信エラー: ${err}` });
    } finally {
      setSubmitting(false);
    }
  }, [user, values, amount, quantity, submitting]);

  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <div className="max-w-xl mx-auto px-4">
        {/* ヘッダー */}
        <h1 className="text-xl font-bold text-gray-900 mb-1">立替精算</h1>
        <p className="text-sm text-gray-500 mb-5">
          個人で立替払いした経費の精算申請です。承認・発注ステップはスキップされます。
        </p>

        {/* 注意事項 */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
          <p className="text-sm font-medium text-amber-800">
            立替精算の流れ
          </p>
          <ol className="text-xs text-amber-700 mt-2 space-y-1 list-decimal list-inside">
            <li>このフォームで申請（証憑の準備をお願いします）</li>
            <li>Slackスレッドに <strong>レシート/領収書</strong> を添付</li>
            <li>管理本部がMF経費で処理 → 給与精算</li>
          </ol>
          <p className="text-xs text-amber-600 mt-2">
            ※ 原則は事前に /purchase → MFカードで購入してください。立替は緊急時の例外措置です。
          </p>
        </div>

        {/* ステップインジケーター */}
        <div className="flex items-center mb-6 gap-2">
          {[
            { n: 1, label: "入力" },
            { n: 2, label: "確認" },
            { n: 3, label: "完了" },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === n
                    ? "bg-blue-600 text-white"
                    : step > n
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-400"
                }`}
              >
                {step > n ? "\u2713" : n}
              </div>
              <span className={`text-xs ${step === n ? "text-blue-700 font-semibold" : "text-gray-400"}`}>
                {label}
              </span>
              {n < 3 && <div className="w-8 h-px bg-gray-300" />}
            </div>
          ))}
        </div>

        {/* Step 1: 入力 */}
        {step === 1 && (
          <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
            {/* 品目名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                品目名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={values.itemName}
                onChange={(e) => set("itemName", e.target.value)}
                placeholder="例: タクシー代（客先訪問）"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 金額 + 数量 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  金額（税込） <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={values.amount}
                  onChange={(e) => set("amount", e.target.value.replace(/[^\d,，]/g, ""))}
                  placeholder="3,500"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">数量</label>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={values.quantity}
                  onChange={(e) => set("quantity", e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            {totalAmount > 0 && quantity > 1 && (
              <p className="text-xs text-gray-500">
                合計: {formatYen(totalAmount)}
              </p>
            )}

            {/* 購入先 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                購入先 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={values.supplierName}
                onChange={(e) => set("supplierName", e.target.value)}
                placeholder="例: コンビニ、タクシー、薬局"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 支払方法 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">支払方法</label>
              <select
                value={values.paymentMethod}
                onChange={(e) => set("paymentMethod", e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                個人で支払った場合は「立替」を選択してください
              </p>
            </div>

            {/* URL（任意） */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">購入先URL</label>
              <input
                type="url"
                value={values.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 購入理由 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                購入理由{amount >= 100000 ? <span className="text-red-500"> *</span> : ""}
              </label>
              <textarea
                value={values.purpose}
                onChange={(e) => set("purpose", e.target.value)}
                rows={2}
                placeholder="なぜ立替が必要だったか（緊急対応、出先での急な購入等）"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {amount >= 100000 && (
                <p className="text-xs text-red-500 mt-1">10万円以上のため必須です</p>
              )}
            </div>

            {/* 備考 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
              <textarea
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={2}
                placeholder="補足事項があれば入力"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 次へ */}
            <button
              type="button"
              disabled={!canProceed}
              onClick={() => setStep(2)}
              className="w-full py-2.5 rounded-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
            >
              確認画面へ
            </button>
          </section>
        )}

        {/* Step 2: 確認 */}
        {step === 2 && (
          <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">申請内容の確認</h2>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                この申請は <strong>「購入済（立替精算）」</strong> として処理されます。
                承認・発注・検収ステップはスキップされ、即座に「証憑待ち」状態になります。
              </p>
            </div>

            <dl className="divide-y divide-gray-100">
              {[
                ["品目名", values.itemName],
                ["金額", formatYen(totalAmount) + (quantity > 1 ? ` (${formatYen(amount)} x ${quantity})` : "")],
                ["購入先", values.supplierName],
                ["支払方法", values.paymentMethod],
                ...(values.url ? [["URL", values.url]] : []),
                ...(values.purpose ? [["購入理由", values.purpose]] : []),
                ...(values.notes ? [["備考", values.notes]] : []),
                ["申請者", user?.name || "---"],
                ["部門", user?.departmentName || "---"],
              ].map(([label, value]) => (
                <div key={label as string} className="py-2 flex gap-3">
                  <dt className="w-24 text-xs text-gray-500 shrink-0">{label}</dt>
                  <dd className="text-sm text-gray-900 break-all">{value}</dd>
                </div>
              ))}
            </dl>

            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                {errors.map((e) => (
                  <p key={e} className="text-xs text-red-600">{e}</p>
                ))}
              </div>
            )}

            {result && !result.ok && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs text-red-600">{result.message}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-2.5 rounded-md text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={errors.length > 0 || submitting}
                onClick={handleSubmit}
                className="flex-1 py-2.5 rounded-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                {submitting ? "送信中..." : "申請する"}
              </button>
            </div>
          </section>
        )}

        {/* Step 3: 完了 */}
        {step === 3 && result?.ok && (
          <section className="bg-white rounded-lg border border-green-200 p-5 text-center space-y-4">
            <div className="text-4xl">&#x2705;</div>
            <h2 className="text-lg font-bold text-green-700">立替精算を申請しました</h2>
            {result.poNumber && (
              <p className="text-sm text-gray-600">
                申請番号: <strong className="font-mono">{result.poNumber}</strong>
              </p>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
              <p className="text-sm font-medium text-amber-800">次にやること</p>
              <ol className="text-xs text-amber-700 mt-2 space-y-1 list-decimal list-inside">
                <li>Slackの <strong>#purchase-request</strong> で該当スレッドを開く</li>
                <li>レシート/領収書の画像をスレッドにドラッグ&ドロップ</li>
                <li>Botが自動で証憑を検知・OCR照合します</li>
              </ol>
              <p className="text-xs text-amber-600 mt-2">
                証憑が添付されるまで経理処理は保留されます。早めの添付をお願いします。
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
              <p className="text-sm font-medium text-blue-800">MF経費での精算手順</p>
              <ol className="text-xs text-blue-700 mt-2 space-y-1 list-decimal list-inside">
                <li>MF経費にログイン</li>
                <li>経費申請を作成・提出</li>
                <li>管理本部がMF経費で承認 → 給与精算</li>
              </ol>
              <p className="text-xs text-blue-600 mt-2">
                ※ MF経費のカード明細から経費登録しないでください（二重計上防止）
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push("/purchase/my")}
                className="flex-1 py-2.5 rounded-md text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
              >
                マイページ
              </button>
              <button
                type="button"
                onClick={() => {
                  setValues(INITIAL);
                  setResult(null);
                  setStep(1);
                }}
                className="flex-1 py-2.5 rounded-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition"
              >
                続けて申請
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

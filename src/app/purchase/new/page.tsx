"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";

type FormState = {
  ok: boolean;
  message: string;
  poNumber?: string;
} | null;

async function submitPurchase(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const res = await fetch("/api/purchase/submit", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, message: data.error || "送信に失敗しました" };
    }
    return { ok: true, message: "申請が完了しました", poNumber: data.poNumber };
  } catch {
    return { ok: false, message: "通信エラーが発生しました" };
  }
}

function PurchaseFormInner() {
  const params = useSearchParams();
  const userId = params.get("user_id") || "";
  const channelId = params.get("channel_id") || "";

  const [state, action, pending] = useActionState(submitPurchase, null);

  if (!userId) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-bold">エラー</p>
          <p>Slackの /purchase コマンドからアクセスしてください。</p>
        </div>
      </div>
    );
  }

  if (state?.ok) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-lg font-bold text-green-800">{state.message}</p>
          {state.poNumber && (
            <p className="text-green-700 mt-2">PO番号: {state.poNumber}</p>
          )}
          <p className="text-sm text-green-600 mt-4">
            Slackチャンネルに申請メッセージが投稿されました。
          </p>
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">購買申請</h1>

      {state?.ok === false && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-800">
          {state.message}
        </div>
      )}

      <form action={action} className="space-y-5">
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="channel_id" value={channelId} />

        {/* 申請区分 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            申請区分 <span className="text-red-500">*</span>
          </legend>
          <select
            name="request_type"
            required
            className="w-full border rounded-lg px-3 py-2 bg-white"
          >
            <option value="">選択してください</option>
            <option value="購入前">購入前</option>
            <option value="購入済">購入済</option>
          </select>
        </fieldset>

        {/* 品目名 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            品目名 <span className="text-red-500">*</span>
          </legend>
          <input
            type="text"
            name="item_name"
            required
            placeholder="例: ノートPC、モニター等"
            className="w-full border rounded-lg px-3 py-2"
          />
        </fieldset>

        {/* 金額・数量 */}
        <div className="grid grid-cols-2 gap-4">
          <fieldset>
            <legend className="block text-sm font-medium mb-1">
              金額（税込・円） <span className="text-red-500">*</span>
            </legend>
            <input
              type="number"
              name="amount"
              required
              min="1"
              placeholder="165000"
              className="w-full border rounded-lg px-3 py-2"
            />
          </fieldset>
          <fieldset>
            <legend className="block text-sm font-medium mb-1">
              数量 <span className="text-red-500">*</span>
            </legend>
            <input
              type="number"
              name="quantity"
              required
              min="1"
              defaultValue="1"
              className="w-full border rounded-lg px-3 py-2"
            />
          </fieldset>
        </div>

        {/* 支払方法 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            支払方法 <span className="text-red-500">*</span>
          </legend>
          <select
            name="payment_method"
            required
            className="w-full border rounded-lg px-3 py-2 bg-white"
          >
            <option value="">選択してください</option>
            <option value="会社カード">会社カード</option>
            <option value="請求書払い">請求書払い</option>
            <option value="立替">立替</option>
          </select>
        </fieldset>

        {/* 購入先名 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            購入先名 <span className="text-red-500">*</span>
          </legend>
          <input
            type="text"
            name="supplier_name"
            required
            placeholder="例: Amazon、モノタロウ、ASKUL等"
            className="w-full border rounded-lg px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            Amazonマーケットプレイスの場合は出品者名を記入してください
          </p>
        </fieldset>

        {/* 購入先URL */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">購入先URL</legend>
          <input
            type="url"
            name="url"
            placeholder="https://www.amazon.co.jp/..."
            className="w-full border rounded-lg px-3 py-2"
          />
        </fieldset>

        {/* 購入品の用途 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            購入品の用途
          </legend>
          <select
            name="asset_usage"
            className="w-full border rounded-lg px-3 py-2 bg-white"
          >
            <option value="">10万円以上の場合に選択</option>
            <option value="顧客案件">
              顧客案件に使用する（納品・組込等）
            </option>
            <option value="社内使用">社内で使用する</option>
            <option value="予備品">予備品として保管する</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            単価10万円以上の場合のみ回答してください
          </p>
        </fieldset>

        {/* KATANA PO番号 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            KATANA PO番号
          </legend>
          <input
            type="text"
            name="katana_po"
            placeholder="例: PO-12345"
            className="w-full border rounded-lg px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            製品部品の場合に入力
          </p>
        </fieldset>

        {/* HubSpot案件番号 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            HubSpot案件番号
          </legend>
          <input
            type="text"
            name="hubspot_deal_id"
            placeholder="例: 12345678"
            className="w-full border rounded-lg px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            案件利用でプロジェクトコードを持っている場合は必ず入力
          </p>
        </fieldset>

        {/* 実行予算番号 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            実行予算番号
          </legend>
          <input
            type="text"
            name="budget_number"
            placeholder="あれば入力"
            className="w-full border rounded-lg px-3 py-2"
          />
        </fieldset>

        {/* 購入理由 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">購入理由</legend>
          <textarea
            name="notes"
            rows={3}
            placeholder="購入の目的・理由を記入"
            className="w-full border rounded-lg px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            単価10万円以上、または案件外の購入は必ず記入してください
          </p>
        </fieldset>

        {/* 証憑案内 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          📎 証憑（納品書・領収書等）は申請後にSlackスレッドへ添付してください。購入済の場合は必須です。
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {pending ? "送信中..." : "申請する"}
        </button>
      </form>
    </div>
  );
}

export default function PurchaseNewPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto p-6 text-center text-gray-500">
          読み込み中...
        </div>
      }
    >
      <PurchaseFormInner />
    </Suspense>
  );
}

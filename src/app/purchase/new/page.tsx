"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useState, useCallback, useRef } from "react";

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

// --- ファイルアップロードUI ---

interface FileItem {
  file: File;
  preview: string | null;
}

function FileUpload({ required }: { required: boolean }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    const items: FileItem[] = Array.from(newFiles).map((file) => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  return (
    <div>
      {/* hidden file inputs for form submission */}
      {files.map((item, i) => {
        const dt = new DataTransfer();
        dt.items.add(item.file);
        return (
          <input
            key={`input-${i}`}
            type="file"
            name="vouchers"
            style={{ display: "none" }}
            ref={(el) => {
              if (el) el.files = dt.files;
            }}
          />
        );
      })}

      {/* drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
      >
        <p className="text-gray-500">
          📎 ファイルをドラッグ&ドロップ、またはクリックして選択
        </p>
        <p className="text-xs text-gray-400 mt-1">
          画像・PDF・Excel対応（複数可）
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* validation for required */}
      {required && files.length === 0 && (
        <input type="text" required value="" readOnly className="hidden" tabIndex={-1} />
      )}

      {/* file list */}
      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((item, i) => (
            <li
              key={i}
              className="flex items-center gap-3 bg-gray-50 rounded-lg p-2"
            >
              {item.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.preview}
                  alt=""
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <span className="w-12 h-12 flex items-center justify-center bg-gray-200 rounded text-lg">
                  {item.file.name.endsWith(".pdf") ? "📄" : "📊"}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{item.file.name}</p>
                <p className="text-xs text-gray-400">
                  {(item.file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="text-red-400 hover:text-red-600 px-2"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- メインフォーム ---

function PurchaseFormInner() {
  const params = useSearchParams();
  const userId = params.get("user_id") || "";
  const channelId = params.get("channel_id") || "";

  const [state, action, pending] = useActionState(submitPurchase, null);

  // 条件分岐用 state
  const [requestType, setRequestType] = useState("");
  const [amount, setAmount] = useState(0);
  const [quantity, setQuantity] = useState(1);

  const isPurchased = requestType === "購入済";
  const totalAmount = amount * quantity;
  const isHighValue = totalAmount >= 100000;

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
          <div className="flex gap-4">
            {["購入前", "購入済"].map((v) => (
              <label
                key={v}
                className={`flex-1 text-center py-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  requestType === v
                    ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="request_type"
                  value={v}
                  required
                  className="sr-only"
                  onChange={(e) => setRequestType(e.target.value)}
                />
                {v === "購入前" ? "🛒 購入前" : "📦 購入済"}
              </label>
            ))}
          </div>
          {isPurchased && (
            <p className="text-sm text-amber-600 mt-2">
              ⚡ 購入済のため承認・発注ステップはスキップされます。証憑の添付が必須です。
            </p>
          )}
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

        {/* 金額・数量・合計 */}
        <div>
          <div className="grid grid-cols-2 gap-4">
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                単価（税込・円） <span className="text-red-500">*</span>
              </legend>
              <input
                type="number"
                name="amount"
                required
                min="1"
                placeholder="165000"
                className="w-full border rounded-lg px-3 py-2"
                onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
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
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              />
            </fieldset>
          </div>
          {/* 合計額リアルタイム表示 */}
          {totalAmount > 0 && (
            <div className={`mt-2 text-right text-lg font-bold ${isHighValue ? "text-red-600" : "text-gray-700"}`}>
              合計: ¥{totalAmount.toLocaleString()}
              {isHighValue && (
                <span className="text-sm font-normal text-red-500 ml-2">
                  （10万円以上: 用途・理由の入力が必要です）
                </span>
              )}
            </div>
          )}
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

        {/* 購入品の用途 — 10万以上で必須化 */}
        {(isHighValue || !requestType) && (
          <fieldset>
            <legend className="block text-sm font-medium mb-1">
              購入品の用途
              {isHighValue && <span className="text-red-500"> *</span>}
            </legend>
            <select
              name="asset_usage"
              required={isHighValue}
              className="w-full border rounded-lg px-3 py-2 bg-white"
            >
              <option value="">選択してください</option>
              <option value="顧客案件">
                顧客案件に使用する（納品・組込等）
              </option>
              <option value="社内使用">社内で使用する</option>
              <option value="予備品">予備品として保管する</option>
            </select>
          </fieldset>
        )}

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
          <p className="text-xs text-gray-500 mt-1">製品部品の場合に入力</p>
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

        {/* 購入理由 — 10万以上で必須化 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            購入理由
            {isHighValue && <span className="text-red-500"> *</span>}
          </legend>
          <textarea
            name="notes"
            rows={3}
            required={isHighValue}
            placeholder="購入の目的・理由を記入"
            className="w-full border rounded-lg px-3 py-2"
          />
          {isHighValue ? (
            <p className="text-xs text-red-500 mt-1">
              10万円以上のため必須です
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              単価10万円以上、または案件外の購入は必ず記入してください
            </p>
          )}
        </fieldset>

        {/* 証憑アップロード — 購入済の場合は必須 */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1">
            証憑（納品書・領収書等）
            {isPurchased && <span className="text-red-500"> *</span>}
          </legend>
          {isPurchased && (
            <p className="text-sm text-red-500 mb-2">
              購入済のため証憑の添付が必須です
            </p>
          )}
          <FileUpload required={isPurchased} />
          {!isPurchased && (
            <p className="text-xs text-gray-500 mt-2">
              購入前の場合は後からSlackスレッドに添付することもできます
            </p>
          )}
        </fieldset>

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

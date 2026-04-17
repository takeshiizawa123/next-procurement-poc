"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

const CATEGORIES = ["派遣", "外注", "SaaS", "顧問", "賃貸", "保守", "清掃", "その他"] as const;
const BILLING_TYPES = ["固定", "従量", "カード自動"] as const;
const RENEWAL_TYPES = ["自動更新", "都度更新", "期間満了"] as const;

type QueueStatus = "待機" | "OCR抽出中" | "レビュー待ち" | "登録中" | "登録済" | "スキップ" | "失敗" | "重複";

interface ExtractedFields {
  supplierName: string;
  category: string;
  billingType: string;
  monthlyAmount: number | null;
  annualAmount: number | null;
  contractStartDate: string;
  contractEndDate: string | null;
  renewalType: string;
  accountTitle: string;
  confidence: number;
  notes: string;
}

interface QueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  extracted?: ExtractedFields;
  error?: string;
  contractNumber?: string;
  notionUrl?: string;
  department: string;
}

export default function BatchUploadContractsPage() {
  const user = useUser();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [defaultDepartment, setDefaultDepartment] = useState("管理本部");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold mb-2">アクセス権限がありません</p>
          <p className="text-sm text-red-600">このページは管理本部のみ閲覧できます。</p>
        </div>
      </div>
    );
  }

  function addFiles(files: File[]) {
    const validFiles = files.filter((f) => {
      const okType = ["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(f.type);
      const okSize = f.size <= 20 * 1024 * 1024;
      return okType && okSize;
    });

    const newItems: QueueItem[] = validFiles.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      status: "待機",
      department: defaultDepartment,
    }));

    setQueue((prev) => [...prev, ...newItems]);
    // 自動的に最初のファイルの処理を開始
    if (newItems.length > 0 && !currentId) {
      setTimeout(() => processNext(newItems[0].id), 100);
    }
  }

  async function processNext(itemId: string) {
    setCurrentId(itemId);
    updateItem(itemId, { status: "OCR抽出中" });

    const item = queue.find((q) => q.id === itemId);
    if (!item) {
      // setQueueの非同期問題: 新しいItemは state に入ってない可能性
      // → state更新後に処理するため、まずフレッシュなitemを取得
      const fresh = await new Promise<QueueItem | undefined>((resolve) => {
        setQueue((prev) => {
          resolve(prev.find((q) => q.id === itemId));
          return prev;
        });
      });
      if (!fresh) return;
      return processItemFile(fresh);
    }
    return processItemFile(item);
  }

  async function processItemFile(item: QueueItem) {
    try {
      const formData = new FormData();
      formData.append("file", item.file);

      const res = await apiFetch("/api/admin/contracts/ocr-parse", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `OCR失敗 (${res.status})`);
      }

      const data = await res.json();
      updateItem(item.id, {
        status: "レビュー待ち",
        extracted: data.extracted,
      });
    } catch (e) {
      updateItem(item.id, {
        status: "失敗",
        error: e instanceof Error ? e.message : "OCRエラー",
      });
    }
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function updateExtracted(id: string, patch: Partial<ExtractedFields>) {
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id && q.extracted
          ? { ...q, extracted: { ...q.extracted, ...patch } }
          : q,
      ),
    );
  }

  async function registerItem(id: string) {
    const item = queue.find((q) => q.id === id);
    if (!item || !item.extracted) return;

    updateItem(id, { status: "登録中" });

    try {
      const formData = new FormData();
      formData.append("file", item.file);
      formData.append("category", item.extracted.category);
      formData.append("billingType", item.extracted.billingType);
      formData.append("supplierName", item.extracted.supplierName);
      if (item.extracted.monthlyAmount != null) {
        formData.append("monthlyAmount", String(item.extracted.monthlyAmount));
      }
      if (item.extracted.annualAmount != null) {
        formData.append("annualAmount", String(item.extracted.annualAmount));
      }
      formData.append("contractStartDate", item.extracted.contractStartDate);
      if (item.extracted.contractEndDate) {
        formData.append("contractEndDate", item.extracted.contractEndDate);
      }
      formData.append("renewalType", item.extracted.renewalType);
      formData.append("accountTitle", item.extracted.accountTitle);
      formData.append("department", item.department);
      formData.append("notes", item.extracted.notes);

      const res = await apiFetch("/api/admin/contracts", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") {
        updateItem(id, {
          status: "重複",
          error: data.message,
          contractNumber: data.existing?.contractNumber,
        });
      } else if (res.ok && data.ok) {
        updateItem(id, {
          status: "登録済",
          contractNumber: data.contract?.contractNumber,
          notionUrl: data.contract?.contractFileUrl,
        });
      } else {
        throw new Error(data.error || `登録失敗 (${res.status})`);
      }
    } catch (e) {
      updateItem(id, {
        status: "失敗",
        error: e instanceof Error ? e.message : "登録エラー",
      });
    }

    // 次のレビュー待ちに自動遷移
    advanceToNext(id);
  }

  function skipItem(id: string) {
    updateItem(id, { status: "スキップ" });
    advanceToNext(id);
  }

  function advanceToNext(currentItemId: string) {
    setQueue((prev) => {
      const currentIdx = prev.findIndex((q) => q.id === currentItemId);
      // 次の「待機」または「レビュー待ち」を探す
      const nextWaiting = prev.find(
        (q, i) => i > currentIdx && q.status === "待機",
      );
      const nextReview = prev.find(
        (q, i) => i > currentIdx && q.status === "レビュー待ち",
      );

      if (nextWaiting) {
        setTimeout(() => processNext(nextWaiting.id), 100);
      } else if (nextReview) {
        setCurrentId(nextReview.id);
      } else {
        setCurrentId(null);
      }

      return prev;
    });
  }

  const currentItem = queue.find((q) => q.id === currentId);

  const completedCount = queue.filter((q) => q.status === "登録済").length;
  const skippedCount = queue.filter((q) => q.status === "スキップ").length;
  const failedCount = queue.filter((q) => q.status === "失敗" || q.status === "重複").length;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/contracts" className="text-sm text-gray-400 hover:text-gray-600">
          ← 契約一覧
        </a>
        <h1 className="text-xl font-bold">契約書 一括取り込み</h1>
      </div>

      {/* アップロードゾーン */}
      <div className="bg-white border-2 border-dashed rounded-xl p-6 mb-6 text-center">
        <p className="text-sm text-gray-600 mb-3">
          PDFまたは画像ファイルを選択（複数可）。OCRで自動解析→レビュー→Notion保管へ。
        </p>

        <div className="mb-3">
          <label className="text-xs text-gray-600 mr-2">既定の部門:</label>
          <input
            type="text"
            value={defaultDepartment}
            onChange={(e) => setDefaultDepartment(e.target.value)}
            className="border rounded-lg px-2 py-1 text-sm w-40"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(Array.from(e.target.files));
              e.target.value = "";
            }
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          📎 PDFを選択
        </button>
      </div>

      {/* サマリー */}
      {queue.length > 0 && (
        <div className="flex gap-3 mb-4 text-sm">
          <span className="px-2 py-1 bg-gray-100 rounded">合計: {queue.length}件</span>
          {completedCount > 0 && (
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
              登録済: {completedCount}
            </span>
          )}
          {skippedCount > 0 && (
            <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded">
              スキップ: {skippedCount}
            </span>
          )}
          {failedCount > 0 && (
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
              失敗/重複: {failedCount}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* キュー（左） */}
        <div className="lg:col-span-2 bg-white border rounded-xl p-4">
          <h2 className="font-bold mb-3 text-sm">キュー</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-gray-400">まだファイルがありません</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((q) => (
                <li
                  key={q.id}
                  className={`text-sm p-2 rounded-lg border cursor-pointer ${
                    q.id === currentId ? "border-blue-500 bg-blue-50" : "border-gray-200"
                  }`}
                  onClick={() => q.status === "レビュー待ち" && setCurrentId(q.id)}
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={q.status} />
                    <span className="flex-1 truncate">{q.file.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                    <span>{q.status}</span>
                    {q.contractNumber && (
                      <span className="text-green-600">{q.contractNumber}</span>
                    )}
                    {q.notionUrl && (
                      <a
                        href={q.notionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Notion↗
                      </a>
                    )}
                  </div>
                  {q.error && (
                    <div className="text-xs text-red-600 mt-1 truncate">{q.error}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* レビューパネル（右） */}
        <div className="lg:col-span-3 bg-white border rounded-xl p-4">
          <h2 className="font-bold mb-3 text-sm">レビュー</h2>
          {currentItem && currentItem.extracted ? (
            <ReviewForm
              item={currentItem}
              onChange={(patch) => updateExtracted(currentItem.id, patch)}
              onDepartmentChange={(v) => updateItem(currentItem.id, { department: v })}
              onRegister={() => registerItem(currentItem.id)}
              onSkip={() => skipItem(currentItem.id)}
              disabled={currentItem.status === "登録中"}
            />
          ) : currentItem && currentItem.status === "OCR抽出中" ? (
            <div className="text-sm text-gray-500 text-center py-8">
              🔄 OCR抽出中... {currentItem.file.name}
            </div>
          ) : (
            <div className="text-sm text-gray-400 text-center py-8">
              キューからファイルを選択するか、新しいPDFをアップロードしてください
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: QueueStatus }) {
  const icons: Record<QueueStatus, string> = {
    "待機": "⏸",
    "OCR抽出中": "🔄",
    "レビュー待ち": "📝",
    "登録中": "⚙️",
    "登録済": "✅",
    "スキップ": "⏭",
    "失敗": "❌",
    "重複": "⚠️",
  };
  return <span>{icons[status]}</span>;
}

function ReviewForm({
  item,
  onChange,
  onDepartmentChange,
  onRegister,
  onSkip,
  disabled,
}: {
  item: QueueItem;
  onChange: (patch: Partial<ExtractedFields>) => void;
  onDepartmentChange: (v: string) => void;
  onRegister: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  const e = item.extracted!;
  const confidenceColor =
    e.confidence >= 0.8 ? "text-green-600" : e.confidence >= 0.5 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 border-b pb-2 mb-2">
        📄 {item.file.name} ({(item.file.size / 1024).toFixed(0)}KB)
        <span className={`ml-2 ${confidenceColor}`}>
          信頼度: {(e.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">取引先名 *</label>
          <input
            type="text"
            value={e.supplierName}
            onChange={(ev) => onChange({ supplierName: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">部門 *</label>
          <input
            type="text"
            value={item.department}
            onChange={(ev) => onDepartmentChange(ev.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">カテゴリ *</label>
          <select
            value={e.category}
            onChange={(ev) => onChange({ category: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">請求タイプ *</label>
          <select
            value={e.billingType}
            onChange={(ev) => onChange({ billingType: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            {BILLING_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">月額（円、税込）</label>
          <input
            type="number"
            value={e.monthlyAmount ?? ""}
            onChange={(ev) =>
              onChange({
                monthlyAmount: ev.target.value ? Number(ev.target.value) : null,
              })
            }
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">年額（円、税込）</label>
          <input
            type="number"
            value={e.annualAmount ?? ""}
            onChange={(ev) =>
              onChange({
                annualAmount: ev.target.value ? Number(ev.target.value) : null,
              })
            }
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">契約開始日 *</label>
          <input
            type="date"
            value={e.contractStartDate}
            onChange={(ev) => onChange({ contractStartDate: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">契約終了日</label>
          <input
            type="date"
            value={e.contractEndDate || ""}
            onChange={(ev) => onChange({ contractEndDate: ev.target.value || null })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">更新タイプ</label>
          <select
            value={e.renewalType}
            onChange={(ev) => onChange({ renewalType: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            {RENEWAL_TYPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">勘定科目 *</label>
          <input
            type="text"
            value={e.accountTitle}
            onChange={(ev) => onChange({ accountTitle: ev.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">備考（特記事項）</label>
        <textarea
          value={e.notes}
          onChange={(ev) => onChange({ notes: ev.target.value })}
          rows={3}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-2 border-t">
        <button
          onClick={onRegister}
          disabled={disabled || !e.supplierName || !e.contractStartDate}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {disabled ? "登録中..." : "✓ このまま登録"}
        </button>
        <button
          onClick={onSkip}
          disabled={disabled}
          className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          スキップ
        </button>
      </div>
    </div>
  );
}

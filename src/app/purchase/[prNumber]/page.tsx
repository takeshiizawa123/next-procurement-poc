"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/** ISO日付やGAS日付文字列を YYYY-MM-DD に変換 */
function formatDate(val: string): string {
  if (!val || val === "undefined" || val === "null") return "";
  // ISO形式 or Date文字列 → YYYY-MM-DD
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return val;
}

interface PurchaseDetail {
  購買番号: string;
  申請日: string;
  申請者: string;
  品目名: string;
  "合計額（税抜）": string;
  "単価（税抜）": string;
  数量: string;
  購入先: string;
  購入先URL: string;
  部門: string;
  支払方法: string;
  購入目的: string;
  承認者: string;
  発注承認ステータス: string;
  発注ステータス: string;
  検収ステータス: string;
  検収日: string;
  検収コメント: string;
  証憑対応: string;
  証憑金額: string;
  金額照合: string;
  適格番号: string;
  税区分: string;
  Slackリンク: string;
  スレッドTS: string;
  PO番号: string;
  種別: string;
  備考: string;
  [key: string]: string | undefined;
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      {label}
    </span>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "承認済": return "bg-green-100 text-green-800";
    case "承認待ち": return "bg-yellow-100 text-yellow-800";
    case "差戻し": return "bg-red-100 text-red-800";
    case "発注済": return "bg-blue-100 text-blue-800";
    case "未発注": return "bg-gray-100 text-gray-600";
    case "検収済": return "bg-green-100 text-green-800";
    case "未検収": return "bg-gray-100 text-gray-600";
    case "添付済": return "bg-green-100 text-green-800";
    case "要取得": return "bg-amber-100 text-amber-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

function StepIndicator({ steps }: { steps: Array<{ label: string; status: string; active: boolean; done: boolean }> }) {
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
              step.done ? "bg-green-500 text-white border-green-500" :
              step.active ? "bg-blue-500 text-white border-blue-500" :
              "bg-gray-100 text-gray-400 border-gray-300"
            }`}>
              {step.done ? "✓" : i + 1}
            </div>
            <div className={`text-xs mt-1 font-medium ${step.done ? "text-green-700" : step.active ? "text-blue-700" : "text-gray-400"}`}>
              {step.label}
            </div>
            <div className={`text-xs ${step.done ? "text-green-600" : step.active ? "text-blue-600" : "text-gray-400"}`}>
              {step.status || "-"}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-full mx-1 ${step.done ? "bg-green-400" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function PurchaseDetailPage() {
  const { prNumber } = useParams<{ prNumber: string }>();
  const router = useRouter();
  const [data, setData] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const fetchDetail = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const res = await apiFetch(`/api/purchase/${encodeURIComponent(prNumber)}/status`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data as PurchaseDetail;
        if (d["検収日"]) d["検収日"] = formatDate(d["検収日"]);
        if (d["申請日"]) d["申請日"] = formatDate(d["申請日"]);
        setData(d);
      } else if (!background) {
        setError(json.error || "データが見つかりません");
      }
    } catch {
      if (!background) setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [prNumber]);

  useEffect(() => {
    // sessionStorageからキャッシュデータを即時表示
    try {
      const cached = sessionStorage.getItem("purchaseRequests_v2");
      if (cached) {
        const requests = JSON.parse(cached) as Array<Record<string, unknown>>;
        const match = requests.find((r) => r.prNumber === prNumber);
        if (match) {
          // キャッシュデータをPurchaseDetail形式にマッピング
          setData({
            "購買番号": String(match.prNumber || ""),
            "申請日": formatDate(String(match.applicationDate || "")),
            "申請者": String(match.applicant || ""),
            "品目名": String(match.itemName || ""),
            "合計額（税抜）": String(match.totalAmount || ""),
            "単価（税抜）": String(match.unitPrice || ""),
            "数量": String(match.quantity || "1"),
            "購入先": String(match.supplierName || ""),
            "購入先URL": String(match.supplierUrl || ""),
            "部門": String(match.department || ""),
            "支払方法": String(match.paymentMethod || ""),
            "購入目的": String(match.purpose || ""),
            "承認者": "",
            "発注承認ステータス": String(match.approvalStatus || ""),
            "発注ステータス": String(match.orderStatus || ""),
            "検収ステータス": String(match.inspectionStatus || ""),
            "検収日": formatDate(String(match.inspectionDate || "")),
            "検収コメント": String(match.inspectionComment || ""),
            "証憑対応": String(match.voucherStatus || ""),
            "証憑金額": String(match.voucherAmount || ""),
            "金額照合": String(match.amountMatch || ""),
            "適格番号": String(match.registrationNumber || ""),
            "税区分": String(match.taxCategory || ""),
            "Slackリンク": String(match.slackLink || ""),
            "スレッドTS": "",
            "PO番号": "",
            "種別": String(match.type || ""),
            "備考": "",
          });
          setLoading(false);
          // バックグラウンドで最新データを取得
          fetchDetail(true);
          return;
        }
      }
    } catch {}
    // キャッシュがなければ通常フェッチ
    fetchDetail();
  }, [prNumber, fetchDetail]);

  const handleAction = async (action: string, comment?: string) => {
    setActionLoading(action);
    setActionResult(null);
    try {
      const res = await apiFetch(`/api/purchase/${encodeURIComponent(prNumber)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const json = await res.json();
      if (json.success) {
        setActionResult({ type: "success", message: action === "order_complete" ? "発注完了にしました" : "検収完了にしました" });
        setData(json.data as PurchaseDetail);
      } else {
        setActionResult({ type: "error", message: json.error || "更新に失敗しました" });
      }
    } catch {
      setActionResult({ type: "error", message: "通信エラーが発生しました" });
    } finally {
      setActionLoading("");
    }
  };

  const handleVoucherUpload = async (file: File) => {
    setUploading(true);
    setActionResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("prNumber", prNumber);
      formData.append("slackLink", data?.["Slackリンク"] || "");
      const res = await apiFetch("/api/purchase/upload-voucher", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setActionResult({ type: "success", message: "証憑をアップロードしました" });
        setTimeout(fetchDetail, 2000);
      } else {
        setActionResult({ type: "error", message: "アップロードに失敗しました" });
      }
    } catch {
      setActionResult({ type: "error", message: "通信エラーが発生しました" });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto p-6 text-center text-gray-500 animate-pulse">読み込み中...</div>;
  }
  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error || "データが見つかりません"}
        </div>
        <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600 hover:underline">← 戻る</button>
      </div>
    );
  }

  const approval = data["発注承認ステータス"] || "-";
  const order = data["発注ステータス"] || "-";
  const inspection = data["検収ステータス"] || "-";
  const voucher = data["証憑対応"] || "-";

  const steps = [
    { label: "承認", status: approval, done: approval === "承認済", active: approval === "承認待ち" },
    { label: "発注", status: order, done: order === "発注済", active: approval === "承認済" && order !== "発注済" },
    { label: "検収", status: inspection, done: inspection === "検収済", active: order === "発注済" && inspection !== "検収済" },
    { label: "証憑", status: voucher, done: voucher === "添付済", active: inspection === "検収済" && voucher !== "添付済" },
  ];

  const canOrder = approval === "承認済" && order !== "発注済";
  const canInspect = order === "発注済" && inspection !== "検収済";
  const canUploadVoucher = inspection === "検収済" && voucher !== "添付済";
  const amount = Number(data["合計額（税抜）"] || 0);

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/purchase/my")} className="text-gray-400 hover:text-gray-600 text-lg">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-500">{prNumber}</span>
            {data["種別"] && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{data["種別"]}</span>}
          </div>
          <h1 className="text-xl font-bold">{data["品目名"]}</h1>
        </div>
        {refreshing && <span className="text-xs text-gray-400 animate-pulse">更新中...</span>}
      </div>

      {/* ステータスパイプライン */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <StepIndicator steps={steps} />
      </div>

      {/* アクション結果 */}
      {actionResult && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${
          actionResult.type === "success" ? "bg-green-50 border border-green-200 text-green-800" :
          "bg-red-50 border border-red-200 text-red-800"
        }`}>
          {actionResult.message}
        </div>
      )}

      {/* アクションボタン */}
      {(canOrder || canInspect || canUploadVoucher) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <h2 className="font-bold text-blue-800 mb-3">次のアクション</h2>
          {canOrder && (
            <button
              onClick={() => handleAction("order_complete")}
              disabled={!!actionLoading}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading === "order_complete" ? "処理中..." : "発注完了にする"}
            </button>
          )}
          {canInspect && (
            <button
              onClick={() => handleAction("inspection_complete")}
              disabled={!!actionLoading}
              className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {actionLoading === "inspection_complete" ? "処理中..." : "検収完了にする"}
            </button>
          )}
          {canUploadVoucher && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleVoucherUpload(e.target.files[0]); }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50"
              >
                {uploading ? "アップロード中..." : "証憑をアップロード（PDF・画像）"}
              </button>
            </>
          )}
        </div>
      )}

      {/* 申請詳細 */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="font-bold text-gray-800 mb-3">申請内容</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">金額（税抜）</dt>
          <dd className="font-medium">¥{amount.toLocaleString()}</dd>
          <dt className="text-gray-500">単価</dt>
          <dd>¥{Number(data["単価（税抜）"] || 0).toLocaleString()} × {data["数量"] || 1}</dd>
          <dt className="text-gray-500">購入先</dt>
          <dd>{data["購入先URL"] ? <a href={data["購入先URL"]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{data["購入先"]}</a> : data["購入先"]}</dd>
          <dt className="text-gray-500">部門</dt>
          <dd>{data["部門"] || "-"}</dd>
          <dt className="text-gray-500">支払方法</dt>
          <dd>{data["支払方法"] || "-"}</dd>
          <dt className="text-gray-500">承認者</dt>
          <dd>{data["承認者"] || "-"}</dd>
          <dt className="text-gray-500">申請日</dt>
          <dd>{data["申請日"]}</dd>
          <dt className="text-gray-500">申請者</dt>
          <dd>{data["申請者"]}</dd>
          {data["購入目的"] && (<><dt className="text-gray-500">目的</dt><dd>{data["購入目的"]}</dd></>)}
          {data["PO番号"] && (<><dt className="text-gray-500">PO番号</dt><dd className="font-mono">{data["PO番号"]}</dd></>)}
        </dl>
      </div>

      {/* 証憑・検収情報 — 常に表示（レイアウトシフト防止） */}
      <div className="bg-white border rounded-xl p-5 mb-4">
        <h2 className="font-bold text-gray-800 mb-3">証憑・検収</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">証憑</dt>
          <dd><StatusBadge label={voucher} color={statusColor(voucher)} /></dd>
          <dt className="text-gray-500">証憑金額</dt>
          <dd className="font-medium">{data["証憑金額"] ? `¥${Number(data["証憑金額"]).toLocaleString()}` : "-"}</dd>
          <dt className="text-gray-500">金額照合</dt>
          <dd>{data["金額照合"] ? <StatusBadge label={data["金額照合"]} color={data["金額照合"] === "一致" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"} /> : "-"}</dd>
          <dt className="text-gray-500">適格請求書番号</dt>
          <dd className="font-mono text-xs">{data["適格番号"] || "-"}</dd>
          <dt className="text-gray-500">税区分</dt>
          <dd>{data["税区分"] || "-"}</dd>
          <dt className="text-gray-500">検収日</dt>
          <dd>{data["検収日"] ? formatDate(data["検収日"]) : "-"}</dd>
          {data["検収コメント"] && (<><dt className="text-gray-500">コメント</dt><dd>{data["検収コメント"]}</dd></>)}
        </dl>
      </div>

      {/* リンク */}
      <div className="flex gap-3 mt-4">
        {data["Slackリンク"] && (
          <a href={data["Slackリンク"]} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-center py-2 bg-white border rounded-lg text-sm text-blue-600 hover:bg-blue-50">
            Slackスレッドを開く
          </a>
        )}
        <button onClick={() => router.push("/purchase/my")}
          className="flex-1 text-center py-2 bg-white border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          一覧に戻る
        </button>
      </div>
    </div>
  );
}

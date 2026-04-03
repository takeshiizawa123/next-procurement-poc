"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

interface PurchaseRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  supplierName: string;
  applicant: string;
  approvalStatus: string;
  orderStatus: string;
  inspectionStatus: string;
  voucherStatus: string;
  slackLink: string;
  type: string;
  department: string;
  isEstimate?: boolean;
  isPostReport?: boolean;
  isQualifiedInvoice?: string;
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
    case "管理本部対応": return "bg-blue-100 text-blue-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

function overallStatus(req: PurchaseRequest): { label: string; color: string } {
  if (req.type === "購入報告") {
    if (req.voucherStatus === "添付済") return { label: "完了", color: "bg-green-500 text-white" };
    return { label: "証憑待ち", color: "bg-amber-500 text-white" };
  }
  if (req.approvalStatus === "差戻し") return { label: "差戻し", color: "bg-red-500 text-white" };
  if (req.approvalStatus === "承認待ち") return { label: "承認待ち", color: "bg-yellow-500 text-white" };
  if (req.orderStatus === "未発注") return { label: "発注待ち", color: "bg-blue-500 text-white" };
  if (req.inspectionStatus === "未検収") return { label: "検収待ち", color: "bg-indigo-500 text-white" };
  if (req.voucherStatus !== "添付済") return { label: "証憑待ち", color: "bg-amber-500 text-white" };
  return { label: "完了", color: "bg-green-500 text-white" };
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

/** 証憑アップロードボタン（マイページ用） */
function VoucherUploadButton({ prNumber, slackLink }: { prNumber: string; slackLink: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setFailed(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("prNumber", prNumber);
      formData.append("slackLink", slackLink);
      const res = await apiFetch("/api/purchase/upload-voucher", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setUploaded(true);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  }, [prNumber, slackLink]);

  if (uploaded) {
    return <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">提出済</span>;
  }
  if (failed) {
    return (
      <button onClick={() => inputRef.current?.click()}
        className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
        失敗 — 再試行
        <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
      </button>
    );
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
      >
        {uploading ? "..." : "証憑UP"}
      </button>
    </>
  );
}

function MyPageInner() {
  const params = useSearchParams();
  const userId = params.get("user_id") || "";

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const fetchRequests = (background = false) => {
    if (!background) setLoading(true);
    setLoadError(false);
    apiFetch("/api/purchase/recent?limit=30")
      .then((r) => r.json())
      .then((d: { requests?: PurchaseRequest[] }) => {
        setRequests(d.requests || []);
        try { sessionStorage.setItem("purchaseRequests_v2", JSON.stringify(d.requests || [])); } catch {}
      })
      .catch(() => { if (!background) { setRequests([]); setLoadError(true); } })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // キャッシュがあれば即表示 → バックグラウンド更新
    try {
      const cached = sessionStorage.getItem("purchaseRequests_v2");
      if (cached) {
        setRequests(JSON.parse(cached) as PurchaseRequest[]);
        setLoading(false);
        fetchRequests(true);
        return;
      }
    } catch {}
    fetchRequests();
  }, []);

  const filtered = requests.filter((req) => {
    if (filter === "all") return true;
    const status = overallStatus(req);
    if (filter === "completed") return status.label === "完了";
    return status.label !== "完了";
  });

  const stats = {
    total: requests.length,
    active: requests.filter((r) => overallStatus(r).label !== "完了").length,
    completed: requests.filter((r) => overallStatus(r).label === "完了").length,
    totalAmount: requests.reduce((sum, r) => sum + (r.totalAmount || 0), 0),
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">マイ申請</h1>
        <a
          href={`/purchase/new${userId ? `?user_id=${userId}` : ""}`}
          className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 新規申請
        </a>
      </div>

      {/* データ読み込みエラー */}
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-800">申請一覧の読み込みに失敗しました。ネットワーク接続を確認してください。</span>
          <button onClick={() => fetchRequests()} className="text-sm text-red-600 hover:text-red-800 underline ml-2 shrink-0">再読み込み</button>
        </div>
      )}

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
          <div className="text-xs text-gray-500">全申請</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
          <div className="text-xs text-gray-500">進行中</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-xs text-gray-500">完了</div>
        </div>
        <div className="bg-white border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-800">
            ¥{stats.totalAmount.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">合計金額</div>
        </div>
      </div>

      {/* 未対応事項ダッシュボード */}
      {(() => {
        const actions = requests.map((r) => {
          const s = overallStatus(r);
          if (s.label === "完了" || s.label === "差戻し") return null;
          let icon = ""; let action = ""; let urgency: "high" | "medium" | "low" = "low";
          if (r.approvalStatus === "承認待ち") {
            icon = "⏳"; action = "部門長の承認を待っています"; urgency = "low";
          } else if (r.orderStatus === "未発注") {
            icon = "🛒"; action = "購入後に [発注完了] を押してください"; urgency = "high";
          } else if (r.inspectionStatus === "未検収") {
            icon = "📦"; action = "届いたら [検収完了] を押してください"; urgency = "medium";
          } else if (r.voucherStatus === "要取得") {
            icon = "📎"; action = "証憑（納品書・領収書）を提出してください"; urgency = "high";
          }
          if (!action) return null;
          return { ...r, icon, action, urgency, statusLabel: s.label };
        }).filter(Boolean) as Array<PurchaseRequest & { icon: string; action: string; urgency: string; statusLabel: string }>;

        if (actions.length === 0) return null;
        // urgency high first
        actions.sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return (order[a.urgency as keyof typeof order] || 2) - (order[b.urgency as keyof typeof order] || 2);
        });

        return (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h2 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
              <span className="text-lg">!</span> あなたの未対応事項（{actions.length}件）
            </h2>
            <div className="space-y-2">
              {actions.map((a) => (
                <div key={a.prNumber} className={`flex items-start gap-3 p-3 rounded-lg ${
                  a.urgency === "high" ? "bg-red-50 border border-red-200" :
                  a.urgency === "medium" ? "bg-amber-50 border border-amber-100" :
                  "bg-white border border-gray-100"
                }`}>
                  <span className="text-xl flex-shrink-0">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">{a.prNumber}</span>
                      <span className="font-medium text-sm truncate">{a.itemName}</span>
                      <span className="text-xs text-gray-400">¥{a.totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-gray-700 mt-0.5">{a.action}</div>
                  </div>
                  <div className="flex-shrink-0 flex gap-1">
                    {a.voucherStatus === "要取得" && (
                      <VoucherUploadButton prNumber={a.prNumber} slackLink={a.slackLink} />
                    )}
                    {a.slackLink && (
                      <a href={a.slackLink} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                        Slack
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* フィルター */}
      <div className="flex gap-2 mb-4">
        {(["all", "active", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" ? "すべて" : f === "active" ? "進行中" : "完了"}
          </button>
        ))}
      </div>

      {/* 申請一覧 */}
      {loading ? (
        <div className="text-center text-gray-500 py-10 animate-pulse">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          {filter === "all" ? "申請がありません" : `${filter === "active" ? "進行中" : "完了済み"}の申請がありません`}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => {
            const overall = overallStatus(req);
            return (
              <a key={req.prNumber} href={`/purchase/${encodeURIComponent(req.prNumber)}`} className="block bg-white border rounded-lg p-4 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-500">{req.prNumber}</span>
                      <StatusBadge label={overall.label} className={overall.color} />
                      {req.type === "購入報告" && (
                        <StatusBadge label="購入済" className="bg-purple-100 text-purple-700" />
                      )}
                      {req.isEstimate && (
                        <StatusBadge label="概算" className="bg-purple-100 text-purple-700" />
                      )}
                      {req.isPostReport && (
                        <StatusBadge label="事後報告" className="bg-red-100 text-red-700" />
                      )}
                    </div>
                    <h3 className="font-medium mt-1">{req.itemName}</h3>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">¥{req.totalAmount.toLocaleString()}</div>
                    <div className="text-xs text-gray-400">{req.applicationDate}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  {req.supplierName && <span>{req.supplierName}</span>}
                  {req.department && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>{req.department}</span>
                    </>
                  )}
                </div>

                {/* ステータス詳細 */}
                {req.type !== "購入報告" && (
                  <div className="flex items-center gap-1 text-xs">
                    <StatusBadge label={`承認: ${req.approvalStatus || "-"}`} className={statusColor(req.approvalStatus)} />
                    <span className="text-gray-300">→</span>
                    <StatusBadge label={`発注: ${req.orderStatus || "-"}`} className={statusColor(req.orderStatus)} />
                    <span className="text-gray-300">→</span>
                    <StatusBadge label={`検収: ${req.inspectionStatus || "-"}`} className={statusColor(req.inspectionStatus)} />
                    <span className="text-gray-300">→</span>
                    <StatusBadge label={`証憑: ${req.voucherStatus || "-"}`} className={statusColor(req.voucherStatus)} />
                  </div>
                )}

                {/* Slackリンク */}
                {req.slackLink && (
                  <span
                    onClick={(e) => { e.preventDefault(); window.open(req.slackLink, "_blank"); }}
                    className="inline-block mt-2 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Slackスレッドを開く
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MyPurchasePage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto p-6 text-center text-gray-500">読み込み中...</div>}>
      <MyPageInner />
    </Suspense>
  );
}

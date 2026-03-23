"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect } from "react";

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
  if (req.voucherStatus === "要取得") return { label: "証憑待ち", color: "bg-amber-500 text-white" };
  return { label: "完了", color: "bg-green-500 text-white" };
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function MyPageInner() {
  const params = useSearchParams();
  const userId = params.get("user_id") || "";

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  useEffect(() => {
    setLoading(true);
    fetch("/api/purchase/recent?limit=30")
      .then((r) => r.json())
      .then((d: { requests?: PurchaseRequest[] }) => {
        setRequests(d.requests || []);
      })
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
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
              <div key={req.prNumber} className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-500">{req.prNumber}</span>
                      <StatusBadge label={overall.label} className={overall.color} />
                      {req.type === "購入報告" && (
                        <StatusBadge label="購入済" className="bg-purple-100 text-purple-700" />
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
                  <a
                    href={req.slackLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Slackスレッドを開く
                  </a>
                )}
              </div>
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

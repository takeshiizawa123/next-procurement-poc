"use client";

import { useState } from "react";
import Link from "next/link";

const myRequests = [
  {
    id: "PO-2025-0350",
    item: "会議用モニター",
    amount: 45000,
    date: "2025/03/19",
    status: "承認済",
    statusColor: "bg-green-100 text-green-800",
    nextAction: "管理本部が発注手配中",
    icon: "🛒",
  },
  {
    id: "PO-2025-0342",
    item: "ノートPC",
    amount: 150000,
    date: "2025/03/15",
    status: "証憑待ち",
    statusColor: "bg-orange-100 text-orange-800",
    nextAction: "納品書を添付してください",
    icon: "📎",
    urgent: true,
    daysWaiting: 5,
  },
  {
    id: "PO-2025-0338",
    item: "マウス 10個",
    amount: 35000,
    date: "2025/03/12",
    status: "証憑待ち",
    statusColor: "bg-orange-100 text-orange-800",
    nextAction: "納品書を添付してください",
    icon: "📎",
    urgent: true,
    daysWaiting: 3,
  },
  {
    id: "PO-2025-0335",
    item: "ディスプレイアーム 2個",
    amount: 16000,
    date: "2025/03/10",
    status: "発注済",
    statusColor: "bg-blue-100 text-blue-800",
    nextAction: "届いたら検収ボタンを押してください",
    icon: "📦",
  },
  {
    id: "PO-2025-0320",
    item: "ヘッドセット",
    amount: 8500,
    date: "2025/03/05",
    status: "計上済",
    statusColor: "bg-gray-100 text-gray-600",
    nextAction: "完了（仕訳計上済み）",
    icon: "✅",
  },
  {
    id: "PO-2025-0310",
    item: "USBハブ 5個",
    amount: 12500,
    date: "2025/03/01",
    status: "支払済",
    statusColor: "bg-gray-100 text-gray-500",
    nextAction: "",
    icon: "✅",
  },
];

export default function MyPage() {
  const [selectedRequest, setSelectedRequest] = useState<string | null>(
    "PO-2025-0342"
  );
  const [uploadState, setUploadState] = useState<
    "idle" | "dragging" | "uploaded"
  >("idle");

  const urgentCount = myRequests.filter((r) => r.urgent).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
              ← 戻る
            </Link>
            <h1 className="text-xl font-bold text-gray-900">マイページ</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-sm font-bold">
              T
            </div>
            <span className="text-sm text-gray-700">田中太郎（営業部）</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* アラート */}
        {urgentCount > 0 && (
          <div className="mb-6 bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-bold text-orange-800">
                証憑未提出の案件が {urgentCount} 件あります
              </p>
              <p className="text-sm text-orange-600 mt-1">
                証憑が提出されるまで経理処理が進みません。スレッドに納品書を添付するか、下のアップロードエリアから提出できます。
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 申請一覧 */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-bold text-gray-900 mb-3">
              申請一覧
            </h2>
            <div className="space-y-2">
              {myRequests.map((req) => (
                <button
                  key={req.id}
                  onClick={() => setSelectedRequest(req.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    selectedRequest === req.id
                      ? "border-blue-500 bg-blue-50/50 shadow-sm"
                      : req.urgent
                      ? "border-orange-200 bg-white hover:border-orange-300"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <span className="text-xl mt-0.5">{req.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-blue-600 font-medium">
                            {req.id}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${req.statusColor}`}
                          >
                            {req.status}
                          </span>
                          {req.urgent && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                              {req.daysWaiting}日経過
                            </span>
                          )}
                        </div>
                        <p className="text-gray-900 font-medium mt-1">
                          {req.item}
                        </p>
                        {req.nextAction && (
                          <p className="text-xs text-gray-500 mt-1">
                            {req.nextAction}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <div className="text-gray-900 font-medium">
                        ¥{req.amount.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {req.date}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 詳細・証憑アップロード */}
          <div className="lg:col-span-1">
            {selectedRequest && (
              <div className="sticky top-6">
                <RequestDetail
                  request={myRequests.find((r) => r.id === selectedRequest)!}
                  uploadState={uploadState}
                  onUploadStateChange={setUploadState}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function RequestDetail({
  request,
  uploadState,
  onUploadStateChange,
}: {
  request: (typeof myRequests)[number];
  uploadState: "idle" | "dragging" | "uploaded";
  onUploadStateChange: (state: "idle" | "dragging" | "uploaded") => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <span className="font-mono text-blue-600 font-bold">
            {request.id}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${request.statusColor}`}
          >
            {request.status}
          </span>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mt-2">
          {request.item}
        </h3>
      </div>

      {/* 詳細情報 */}
      <div className="p-4 space-y-3 text-sm border-b border-gray-100">
        <DetailRow label="金額" value={`¥${request.amount.toLocaleString()}`} />
        <DetailRow label="申請日" value={request.date} />
        <DetailRow label="部門" value="営業部" />
        <DetailRow label="購入目的" value="業務利用" />
      </div>

      {/* ステータス履歴 */}
      <div className="p-4 border-b border-gray-100">
        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">
          履歴
        </h4>
        <div className="space-y-2">
          <TimelineItem
            time="3/19 10:30"
            text="申請"
            done
          />
          <TimelineItem
            time="3/19 10:35"
            text="承認（山田部長）"
            done
          />
          <TimelineItem
            time="3/19 11:00"
            text="発注完了（鈴木@管理本部）"
            done
          />
          <TimelineItem
            time="3/21 14:00"
            text="検収完了（田中）"
            done
          />
          {request.urgent ? (
            <TimelineItem
              time=""
              text="証憑添付待ち..."
              current
            />
          ) : (
            <TimelineItem
              time="3/22 09:30"
              text="証憑確認OK"
              done
            />
          )}
        </div>
      </div>

      {/* 証憑アップロード */}
      {request.urgent && (
        <div className="p-4">
          <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">
            証憑アップロード
          </h4>

          {uploadState === "uploaded" ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <span className="text-2xl">✅</span>
              <p className="text-sm font-medium text-green-800 mt-2">
                証憑をアップロードしました
              </p>
              <p className="text-xs text-green-600 mt-1">
                OCR解析中...結果はSlackスレッドに通知されます
              </p>
              <button
                onClick={() => onUploadStateChange("idle")}
                className="mt-3 text-xs text-green-600 underline"
              >
                リセット（デモ用）
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                onUploadStateChange("dragging");
              }}
              onDragLeave={() => onUploadStateChange("idle")}
              onDrop={(e) => {
                e.preventDefault();
                onUploadStateChange("uploaded");
              }}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                uploadState === "dragging"
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
              onClick={() => onUploadStateChange("uploaded")}
            >
              <span className="text-3xl">📄</span>
              <p className="text-sm text-gray-600 mt-2">
                ここにファイルをドロップ
              </p>
              <p className="text-xs text-gray-400 mt-1">
                またはクリックして選択
              </p>
              <p className="text-xs text-gray-400 mt-2">
                PDF, JPG, PNG（10MB以下）
              </p>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3">
            💡 Slackのスレッドに直接添付しても同じです
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

function TimelineItem({
  time,
  text,
  done,
  current,
}: {
  time: string;
  text: string;
  done?: boolean;
  current?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-2.5 h-2.5 rounded-full mt-1 ${
            done
              ? "bg-green-500"
              : current
              ? "bg-orange-400 animate-pulse"
              : "bg-gray-300"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-900">{text}</span>
        {time && (
          <span className="text-xs text-gray-400 ml-2">{time}</span>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface DashboardData {
  date: string;
  thisMonth: string;
  kpi: {
    approvalStats: { total: number; approved: number; rejected: number; pending: number };
    journalStats: { posted: number; awaiting: number };
    voucherOverdue: { lt3: number; d3to7: number; d7to14: number; gt14: number };
    contractStats: {
      total: number;
      expiringSoon: number;
      invoicesAwaiting: number;
      invoicesApproved: number;
      invoicesJournaled: number;
    };
    aiLearning: { correctionsLast30Days: number };
  };
  alerts: {
    dlqUnresolved: number;
    voucherOver14Days: number;
    contractsExpiringSoon: Array<{
      contractNumber: string;
      supplierName: string;
      endDate: string;
      daysLeft: number;
    }>;
  };
  recentActivity: {
    auditLogs: Array<{
      id: number;
      tableName: string;
      recordId: string;
      action: string;
      changedBy: string | null;
      fieldName: string | null;
      newValue: string | null;
      createdAt: string;
    }>;
  };
}

export default function DashboardPage() {
  const user = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard");
        if (!res.ok) throw new Error("Failed");
        setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold">管理本部のみアクセス可能</p>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return <div className="p-8 text-center text-gray-400">読み込み中...</div>;
  }

  const { kpi, alerts, recentActivity } = data;
  const approvalRate = kpi.approvalStats.total > 0
    ? Math.round((kpi.approvalStats.approved / kpi.approvalStats.total) * 100)
    : 0;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">ダッシュボード</h1>
        <span className="text-sm text-gray-500">{data.thisMonth} / {data.date}</span>
      </div>

      {/* アラート集約 */}
      {(alerts.dlqUnresolved > 0 || alerts.voucherOver14Days > 0 || alerts.contractsExpiringSoon.length > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <h2 className="font-bold text-red-800 mb-2">🚨 要対応アラート</h2>
          <ul className="text-sm text-red-700 space-y-1">
            {alerts.dlqUnresolved > 0 && (
              <li>• <a href="/admin/dlq" className="underline hover:no-underline">未解決DLQ: {alerts.dlqUnresolved}件</a></li>
            )}
            {alerts.voucherOver14Days > 0 && (
              <li>• 証憑未提出14日超: {alerts.voucherOver14Days}件（作業凍結候補）</li>
            )}
            {alerts.contractsExpiringSoon.length > 0 && (
              <li>• 契約期限30日以内: {alerts.contractsExpiringSoon.length}件</li>
            )}
          </ul>
        </div>
      )}

      {/* KPIカード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          title="当月申請"
          value={kpi.approvalStats.total}
          subtitle={`承認率 ${approvalRate}%`}
        />
        <KpiCard
          title="承認待ち"
          value={kpi.approvalStats.pending}
          highlight={kpi.approvalStats.pending > 5 ? "yellow" : undefined}
        />
        <KpiCard
          title="仕訳完了"
          value={kpi.journalStats.posted}
          subtitle={`証憑待ち ${kpi.journalStats.awaiting}件`}
        />
        <KpiCard
          title="有効契約"
          value={kpi.contractStats.total}
          subtitle={`期限30日以内 ${kpi.contractStats.expiringSoon}件`}
        />
      </div>

      {/* AI学習状況 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-blue-800">🧠 仕訳AIの学習状況</h3>
            <p className="text-xs text-blue-700 mt-1">
              過去30日で <strong>{kpi.aiLearning.correctionsLast30Days}件</strong> の勘定科目修正がRAGに反映されています。
              次回の推定に活用されます。
            </p>
          </div>
          <a
            href="/api/admin/account-correction/stats?days=30"
            className="text-xs text-blue-700 underline hover:no-underline shrink-0"
          >
            詳細
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* 証憑未提出 期間分布 */}
        <div className="bg-white border rounded-xl p-4">
          <h3 className="font-bold text-sm mb-3">証憑未提出（期間別）</h3>
          <div className="space-y-2 text-sm">
            <RowBar label="〜3日" value={kpi.voucherOverdue.lt3} color="green" />
            <RowBar label="3-7日" value={kpi.voucherOverdue.d3to7} color="yellow" />
            <RowBar label="7-14日" value={kpi.voucherOverdue.d7to14} color="orange" />
            <RowBar label="14日超" value={kpi.voucherOverdue.gt14} color="red" />
          </div>
        </div>

        {/* 契約請求書ステータス */}
        <div className="bg-white border rounded-xl p-4">
          <h3 className="font-bold text-sm mb-3">契約請求書 ({data.thisMonth})</h3>
          <div className="space-y-2 text-sm">
            <RowBar label="未受領" value={kpi.contractStats.invoicesAwaiting} color="gray" />
            <RowBar label="承認済" value={kpi.contractStats.invoicesApproved} color="blue" />
            <RowBar label="仕訳済" value={kpi.contractStats.invoicesJournaled} color="green" />
          </div>
        </div>
      </div>

      {/* 期限迫る契約 */}
      {alerts.contractsExpiringSoon.length > 0 && (
        <div className="bg-white border rounded-xl p-4 mb-6">
          <h3 className="font-bold text-sm mb-3">期限迫る契約</h3>
          <ul className="text-sm divide-y">
            {alerts.contractsExpiringSoon.map((c) => (
              <li key={c.contractNumber} className="py-2 flex items-center justify-between">
                <div>
                  <span className="font-medium">{c.supplierName}</span>
                  <span className="text-xs text-gray-500 ml-2">{c.contractNumber}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{c.endDate}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    c.daysLeft <= 7 ? "bg-red-100 text-red-700"
                      : c.daysLeft <= 14 ? "bg-orange-100 text-orange-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}>
                    あと{c.daysLeft}日
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 監査ログ（直近10件） */}
      <div className="bg-white border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">最近の変更（監査ログ）</h3>
          <a href="/api/admin/audit-log" className="text-xs text-blue-600 hover:underline">全件</a>
        </div>
        {recentActivity.auditLogs.length === 0 ? (
          <p className="text-sm text-gray-400">記録なし</p>
        ) : (
          <ul className="text-xs divide-y">
            {recentActivity.auditLogs.map((a) => (
              <li key={a.id} className="py-2">
                <span className="text-gray-500">{new Date(a.createdAt).toLocaleString("ja-JP")}</span>
                {" — "}
                <span className="font-mono">{a.recordId}</span>
                {" "}
                <span className="text-gray-700">
                  {a.fieldName ? `${a.fieldName}="${a.newValue}"` : a.action}
                </span>
                {a.changedBy && <span className="text-gray-500"> by {a.changedBy}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  highlight,
}: {
  title: string;
  value: number;
  subtitle?: string;
  highlight?: "yellow" | "red";
}) {
  const borderColor = highlight === "red" ? "border-red-300" : highlight === "yellow" ? "border-yellow-300" : "border-gray-200";
  return (
    <div className={`bg-white border ${borderColor} rounded-xl p-4`}>
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function RowBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "yellow" | "orange" | "red" | "gray" | "blue";
}) {
  const colorMap = {
    green: "bg-green-200",
    yellow: "bg-yellow-200",
    orange: "bg-orange-200",
    red: "bg-red-200",
    gray: "bg-gray-200",
    blue: "bg-blue-200",
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 w-16 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded h-5 relative">
        <div
          className={`h-5 rounded ${colorMap[color]}`}
          style={{ width: value > 0 ? `${Math.min(value * 10, 100)}%` : "0%" }}
        />
        <span className="absolute right-2 top-0 text-xs leading-5 font-medium text-gray-700">
          {value}件
        </span>
      </div>
    </div>
  );
}

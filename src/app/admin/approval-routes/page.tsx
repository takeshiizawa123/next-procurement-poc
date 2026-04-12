"use client";

import { useState, useEffect } from "react";
import { apiFetch, apiFetchSWR } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface Department {
  departmentName: string;
  departmentCode: string;
  approverSlackId: string;
  approverName: string;
  members: { name: string; slackId: string }[];
}

interface EmployeeOption {
  name: string;
  slackId: string;
  departmentName: string;
}

export default function ApprovalRoutesPage() {
  const user = useUser();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ dept: string; type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    apiFetchSWR<{ departments?: Department[]; allEmployees?: EmployeeOption[] }>(
      "/api/admin/approval-routes",
      "approval-routes",
      (d) => {
        setDepartments(d.departments || []);
        setAllEmployees(d.allEmployees || []);
        setLoading(false);
      },
    ).catch(() => setLoading(false));
  }, []);

  // 管理本部以外はアクセス不可
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

  const handleChange = async (deptName: string, approverSlackId: string) => {
    setSaving((p) => ({ ...p, [deptName]: true }));
    setResult(null);
    try {
      const res = await apiFetch("/api/admin/approval-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentName: deptName, approverSlackId }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ dept: deptName, type: "success", message: `${data.updated}名の承認者を更新しました` });
        // UIを更新
        const approver = allEmployees.find((e) => e.slackId === approverSlackId);
        setDepartments((prev) =>
          prev.map((d) =>
            d.departmentName === deptName
              ? { ...d, approverSlackId, approverName: approver?.name || "" }
              : d
          )
        );
      } else {
        setResult({ dept: deptName, type: "error", message: data.error || "更新に失敗しました" });
      }
    } catch {
      setResult({ dept: deptName, type: "error", message: "通信エラーが発生しました" });
    } finally {
      setSaving((p) => ({ ...p, [deptName]: false }));
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-6 text-center text-gray-500 animate-pulse">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold mb-2">承認ルート設定</h1>
      <p className="text-sm text-gray-500 mb-6">部門ごとの承認権者を設定します。購買申請時にこの設定に基づいて承認依頼が送られます。</p>

      <div className="space-y-4">
        {departments.map((dept) => (
          <div key={dept.departmentName} className="bg-white border rounded-xl p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-bold text-gray-800">{dept.departmentName}</h2>
                <p className="text-xs text-gray-400">{dept.members.length}名</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label className="text-xs text-gray-500">承認者:</label>
                <select
                  value={dept.approverSlackId}
                  onChange={(e) => handleChange(dept.departmentName, e.target.value)}
                  disabled={!!saving[dept.departmentName]}
                  className="border rounded-lg px-3 py-2 text-sm min-w-[200px] disabled:opacity-50"
                >
                  <option value="">（未設定 → デフォルト承認者）</option>
                  {allEmployees
                    .filter((e) => e.slackId)
                    .map((e) => (
                      <option key={e.slackId} value={e.slackId}>
                        {e.name}（{e.departmentName}）
                      </option>
                    ))}
                </select>
                {saving[dept.departmentName] && (
                  <span className="text-xs text-gray-400 animate-pulse">保存中...</span>
                )}
              </div>
            </div>

            {/* メンバー一覧 */}
            <div className="mt-2 flex flex-wrap gap-1">
              {dept.members.map((m) => (
                <span key={m.name} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {m.name}
                </span>
              ))}
            </div>

            {/* 結果表示 */}
            {result?.dept === dept.departmentName && (
              <div className={`mt-2 text-xs px-3 py-1.5 rounded ${
                result.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}>
                {result.message}
              </div>
            )}
          </div>
        ))}
      </div>

      {departments.length === 0 && (
        <div className="text-center text-gray-400 py-8">部門データがありません</div>
      )}
    </div>
  );
}

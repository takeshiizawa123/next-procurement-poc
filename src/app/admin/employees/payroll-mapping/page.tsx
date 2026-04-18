"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

const EMPLOYMENT_TYPES = ["", "正社員", "役員", "契約社員", "アルバイト"] as const;

interface Employee {
  id: number;
  name: string;
  slackId: string;
  email: string | null;
  departmentName: string;
  payrollCode: string | null;
  employmentType: string | null;
}

export default function PayrollMappingPage() {
  const user = useUser();
  const [emps, setEmps] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { payrollCode?: string; employmentType?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [csvPreview, setCsvPreview] = useState<Array<{ code: string; name: string }> | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/employees");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setEmps(data.employees || []);
      setEdits({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  function updateEdit(slackId: string, patch: { payrollCode?: string; employmentType?: string }) {
    setEdits((prev) => ({ ...prev, [slackId]: { ...prev[slackId], ...patch } }));
  }

  async function save() {
    const updates = Object.entries(edits)
      .filter(([, v]) => v.payrollCode !== undefined || v.employmentType !== undefined)
      .map(([slackId, v]) => ({ slackId, ...v }));
    if (updates.length === 0) {
      setMessage({ type: "error", text: "変更がありません" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: "success", text: `✅ ${data.updated}件を更新しました` });
        fetchEmployees();
      } else {
        setMessage({ type: "error", text: data.error || "更新失敗" });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || "");
      // CSV: code,name の形式（ヘッダー1行目）
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const rows = lines.slice(1).map((line) => {
        // タブ or カンマ区切り
        const parts = line.includes("\t") ? line.split("\t") : line.split(",");
        return { code: (parts[0] || "").trim(), name: (parts[1] || "").trim() };
      }).filter((r) => r.code && r.name);
      setCsvPreview(rows);
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }

  function applyCsvMapping() {
    if (!csvPreview) return;
    const newEdits: typeof edits = { ...edits };
    let matched = 0;
    for (const row of csvPreview) {
      // 氏名で従業員を検索（部分一致も許容）
      const target = emps.find((e) =>
        e.name === row.name ||
        e.name.replace(/\s/g, "") === row.name.replace(/\s/g, ""),
      );
      if (target) {
        newEdits[target.slackId] = { ...newEdits[target.slackId], payrollCode: row.code };
        matched++;
      }
    }
    setEdits(newEdits);
    setCsvPreview(null);
    setMessage({
      type: matched === csvPreview.length ? "success" : "error",
      text: `${matched}/${csvPreview.length}件をマッチしました。確認後「保存」してください。`,
    });
  }

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-bold">管理本部のみアクセス可能</p>
        </div>
      </div>
    );
  }

  const hasChanges = Object.keys(edits).length > 0;
  const unmappedCount = emps.filter((e) => !e.payrollCode).length;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <a href="/admin/expense/payroll" className="text-sm text-gray-400 hover:text-gray-600">← 給与連携</a>
        <h1 className="text-xl font-bold">従業員マスタ — 社員コードマッピング</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
        💡 MF給与の<strong>6桁社員コード</strong>（例: 000001）と雇用区分を従業員マスタに登録します。<br />
        給与関連一覧表からCSV（コード,氏名）をインポートすると、氏名マッチングで自動入力できます。
      </div>

      {message && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${
          message.type === "success" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"
        }`}>
          {message.text}
        </div>
      )}

      {/* CSV インポート */}
      <div className="bg-white border rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm">
            📎 給与関連一覧表からCSV/TSVインポート:
          </label>
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleCsvImport}
            className="text-sm"
          />
          <span className="text-xs text-gray-500">
            形式: 1行目ヘッダー / コード,氏名 （タブ区切りも可）
          </span>
        </div>
        {csvPreview && (
          <div className="mt-3">
            <div className="text-sm mb-2">
              {csvPreview.length}件のマッピング候補:
            </div>
            <div className="text-xs bg-gray-50 p-2 rounded max-h-32 overflow-y-auto font-mono">
              {csvPreview.slice(0, 10).map((r, i) => (
                <div key={i}>{r.code} — {r.name}</div>
              ))}
              {csvPreview.length > 10 && <div>...他 {csvPreview.length - 10}件</div>}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={applyCsvMapping}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                氏名マッチで適用
              </button>
              <button
                onClick={() => setCsvPreview(null)}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>

      {/* サマリー */}
      <div className="flex gap-3 mb-4 text-sm">
        <span className="px-3 py-1 bg-gray-100 rounded">総員: {emps.length}人</span>
        <span className={`px-3 py-1 rounded ${unmappedCount > 0 ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-700"}`}>
          未マッピング: {unmappedCount}人
        </span>
        {hasChanges && (
          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded">
            変更: {Object.keys(edits).length}件
          </span>
        )}
      </div>

      {/* 保存ボタン */}
      {hasChanges && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : `💾 ${Object.keys(edits).length}件を保存`}
          </button>
          <button
            onClick={() => setEdits({})}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            変更を破棄
          </button>
        </div>
      )}

      {/* 従業員一覧 */}
      {loading ? (
        <div className="text-center text-gray-400 py-8">読み込み中...</div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">氏名</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">部門</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SlackID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">社員コード</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">雇用区分</th>
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => {
                const edit = edits[e.slackId] || {};
                const currentCode = edit.payrollCode ?? e.payrollCode ?? "";
                const currentType = edit.employmentType ?? e.employmentType ?? "";
                const hasEdit = edit.payrollCode !== undefined || edit.employmentType !== undefined;
                return (
                  <tr key={e.id} className={`border-b ${hasEdit ? "bg-yellow-50" : ""}`}>
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{e.departmentName}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{e.slackId}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={currentCode}
                        onChange={(ev) => updateEdit(e.slackId, { payrollCode: ev.target.value })}
                        placeholder="000001"
                        className="border rounded px-2 py-1 text-sm w-28 font-mono"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={currentType}
                        onChange={(ev) => updateEdit(e.slackId, { employmentType: ev.target.value })}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {EMPLOYMENT_TYPES.map((t) => (
                          <option key={t} value={t}>{t || "（未設定）"}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

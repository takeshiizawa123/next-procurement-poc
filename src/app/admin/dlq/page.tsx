"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface DlqTask {
  id: number;
  taskId: string;
  taskType: string;
  errorMessage: string;
  retryCount: number;
  payload: Record<string, unknown> | null;
  resolvedAt: string | null;
  createdAt: string;
}

export default function DlqPage() {
  const user = useUser();
  const [tasks, setTasks] = useState<DlqTask[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/dlq?resolved=${showResolved}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setTasks(data.tasks || []);
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function markResolved(id: number) {
    const res = await apiFetch(`/api/admin/dlq/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    if (res.ok) fetchTasks();
  }

  async function deleteTask(id: number) {
    if (!confirm("このタスクを完全に削除しますか？")) return;
    const res = await apiFetch(`/api/admin/dlq/${id}`, { method: "DELETE" });
    if (res.ok) fetchTasks();
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

  const unresolvedCount = tasks.filter((t) => !t.resolvedAt).length;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">失敗タスク管理 (DLQ)</h1>
          {unresolvedCount > 0 && (
            <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">
              未解決: {unresolvedCount}
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          解決済みも表示
        </label>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-800">
        ⚠️ DLQはリトライ上限に達した外部API呼出し失敗を記録します。原因調査後、解決済みマークまたは削除してください。
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-8">読み込み中...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center text-green-600 py-8">
          ✅ {showResolved ? "記録がありません" : "未解決の失敗タスクなし"}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`border rounded-lg p-3 ${
                task.resolvedAt ? "bg-gray-50 opacity-60" : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded font-mono">
                      {task.taskType}
                    </span>
                    <span className="text-sm font-medium truncate">{task.taskId}</span>
                    <span className="text-xs text-gray-500">
                      リトライ {task.retryCount}回
                    </span>
                    {task.resolvedAt && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                        解決済
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-red-600 font-mono truncate">
                    {task.errorMessage.slice(0, 200)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(task.createdAt).toLocaleString("ja-JP")}
                  </div>
                  {expanded === task.id && task.payload && (
                    <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                      {JSON.stringify(task.payload, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() =>
                      setExpanded(expanded === task.id ? null : task.id)
                    }
                    className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                  >
                    {expanded === task.id ? "閉じる" : "詳細"}
                  </button>
                  {!task.resolvedAt && (
                    <button
                      onClick={() => markResolved(task.id)}
                      className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded hover:bg-green-50"
                    >
                      解決済
                    </button>
                  )}
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

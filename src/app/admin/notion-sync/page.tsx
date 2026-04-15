"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

type SyncAction = "sync-all" | "sync-flows" | "sync-prompts" | "sync-contracts";

export default function NotionSyncPage() {
  const user = useUser();
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ configured: boolean; pageIds: Record<string, boolean>; ready: boolean } | null>(null);

  // 初回: 接続状態を確認
  useState(() => {
    apiFetch("/api/admin/notion-sync")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setStatus(d); })
      .catch(() => {});
  });

  const runSync = async (action: SyncAction) => {
    setLoading(action);
    setError("");
    setResults(null);
    try {
      const res = await apiFetch("/api/admin/notion-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok) {
        setResults(data.results);
      } else {
        setError(data.error || "同期に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setLoading(null);
    }
  };

  if (user.loaded && !user.isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700">管理本部メンバーのみアクセスできます</p>
        </div>
      </div>
    );
  }

  const actions: { key: SyncAction; label: string; description: string; color: string }[] = [
    { key: "sync-all", label: "全て同期", description: "フロー図・プロンプト・契約マスタを一括でNotionに同期", color: "bg-blue-600 hover:bg-blue-700" },
    { key: "sync-flows", label: "フロー図のみ", description: "4つの業務フロー図（Mermaid）をNotionページに書き込み", color: "bg-purple-600 hover:bg-purple-700" },
    { key: "sync-prompts", label: "プロンプトのみ", description: "AI科目推定・OCR・Slack AIの3つのプロンプトを記録", color: "bg-green-600 hover:bg-green-700" },
    { key: "sync-contracts", label: "契約マスタのみ", description: "継続契約データをNotion DBに同期（新規追加・既存更新）", color: "bg-amber-600 hover:bg-amber-700" },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Notion同期</h1>
        <p className="text-sm text-gray-500 mt-1">システムの情報をNotionワークスペースに自動同期します</p>
      </div>

      {/* 接続状態 */}
      {status && (
        <div className={`mb-6 p-4 rounded-lg border ${status.ready ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${status.ready ? "bg-green-500" : "bg-amber-500"}`}></span>
            <span className="text-sm font-medium">{status.ready ? "Notion接続済み" : "設定が不完全です"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(status.pageIds).map(([key, configured]) => (
              <div key={key} className="flex items-center gap-1">
                <span className={configured ? "text-green-600" : "text-gray-400"}>{configured ? "●" : "○"}</span>
                <span className={configured ? "text-gray-700" : "text-gray-400"}>{key}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 同期ボタン */}
      <div className="space-y-3">
        {actions.map((a) => (
          <div key={a.key} className="bg-white border rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-800 text-sm">{a.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{a.description}</div>
            </div>
            <button
              onClick={() => runSync(a.key)}
              disabled={loading !== null}
              className={`px-4 py-2 text-white text-sm rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed ${a.color}`}
            >
              {loading === a.key ? "同期中..." : "実行"}
            </button>
          </div>
        ))}
      </div>

      {/* 結果表示 */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
      {results && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="text-sm font-medium text-green-700 mb-2">同期完了</div>
          <pre className="text-xs text-green-800 overflow-auto">{JSON.stringify(results, null, 2)}</pre>
        </div>
      )}

      {/* 説明 */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-2">
        <p><strong>自動同期:</strong> 契約の新規登録時とDLQエラー発生時は自動でNotionに記録されます。</p>
        <p><strong>手動同期:</strong> このページのボタンでいつでも最新データをNotionに反映できます。</p>
        <p><strong>対象Notionページ:</strong> 「購買管理システム」DB内の「業務フロー図」ページに全DBが集約されています。</p>
      </div>
    </div>
  );
}

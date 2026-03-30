"use client";

import { useState } from "react";
import Link from "next/link";

type MyTask = {
  prNumber: string;
  itemName: string;
  totalAmount: number;
  status: string;
  slackLink: string;
};

const SAMPLE_TASKS: Record<string, MyTask[]> = {
  "0件（タスクなし）": [],
  "1件（証憑待ち）": [
    { prNumber: "PR-0042", itemName: "会議用モニター", totalAmount: 45000, status: "証憑待ち", slackLink: "#" },
  ],
  "3件（混合）": [
    { prNumber: "PR-0050", itemName: "サーバー機器", totalAmount: 198000, status: "発注待ち", slackLink: "#" },
    { prNumber: "PR-0048", itemName: "ソフトウェアライセンス", totalAmount: 36000, status: "検収待ち", slackLink: "#" },
    { prNumber: "PR-0042", itemName: "会議用モニター", totalAmount: 45000, status: "証憑待ち", slackLink: "#" },
  ],
  "7件（大量）": [
    { prNumber: "PR-0055", itemName: "ノートPC", totalAmount: 250000, status: "発注待ち", slackLink: "#" },
    { prNumber: "PR-0054", itemName: "外付けSSD", totalAmount: 12000, status: "発注待ち", slackLink: "#" },
    { prNumber: "PR-0050", itemName: "サーバー機器", totalAmount: 198000, status: "検収待ち", slackLink: "#" },
    { prNumber: "PR-0048", itemName: "ソフトウェアライセンス", totalAmount: 36000, status: "検収待ち", slackLink: "#" },
    { prNumber: "PR-0045", itemName: "プリンタートナー", totalAmount: 8500, status: "証憑待ち", slackLink: "#" },
    { prNumber: "PR-0042", itemName: "会議用モニター", totalAmount: 45000, status: "証憑待ち", slackLink: "#" },
    { prNumber: "PR-0039", itemName: "デスクチェア", totalAmount: 65000, status: "差戻し", slackLink: "#" },
  ],
};

function TaskSummaryBanner({ tasks }: { tasks: MyTask[] }) {
  if (tasks.length > 0) {
    const grouped: Record<string, MyTask[]> = { "発注待ち": [], "検収待ち": [], "証憑待ち": [], "差戻し": [] };
    for (const t of tasks) if (t.status in grouped) grouped[t.status].push(t);
    const icons: Record<string, string> = { "発注待ち": "🛒", "検収待ち": "📦", "証憑待ち": "📎", "差戻し": "↩️" };

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-amber-700 font-medium text-sm">未処理のタスクがあります（{tasks.length}件）</span>
        </div>
        <div className="space-y-1">
          {Object.entries(grouped).filter(([, items]) => items.length > 0).map(([status, items]) => (
            <div key={status} className="text-sm text-amber-800">
              <span>{icons[status]} {status}: {items.length}件</span>
              <span className="text-amber-600 ml-2">
                {items.slice(0, 3).map((t) => t.prNumber).join(", ")}
                {items.length > 3 && ` 他${items.length - 3}件`}
              </span>
            </div>
          ))}
        </div>
        <a href="/purchase/my" className="text-xs text-amber-600 hover:text-amber-800 underline mt-1 inline-block">
          マイページで確認
        </a>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
      <span className="text-green-700 text-sm">未処理のタスクはありません</span>
    </div>
  );
}

export default function TaskSummaryMock() {
  const [scenario, setScenario] = useState("3件（混合）");

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
            ← 戻る
          </Link>
          <h1 className="text-xl font-bold">未処理タスクサマリ — モック</h1>
        </div>

        {/* シナリオ切替 */}
        <div className="bg-white border rounded-lg p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">シナリオを選択</label>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SAMPLE_TASKS).map((key) => (
              <button
                key={key}
                onClick={() => setScenario(key)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  scenario === key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* 購買申請フォーム風のプレビュー */}
        <div className="bg-white border rounded-lg p-4 sm:p-6">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">購買申請</h2>

          {/* 下書き復元通知（ダミー） */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between">
            <span className="text-sm text-blue-800">前回の入力内容を復元しました</span>
            <span className="text-sm text-blue-600 underline cursor-pointer">クリア</span>
          </div>

          {/* タスクサマリ */}
          <TaskSummaryBanner tasks={SAMPLE_TASKS[scenario]} />

          {/* ステップインジケーター（ダミー） */}
          <div className="flex items-center justify-between mb-4">
            {["申請区分", "商品情報", "詳細情報", "確認"].map((label, i) => (
              <div key={label} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
                  i === 0 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                }`}>
                  {i + 1}
                </div>
                <span className={`ml-1.5 text-xs hidden sm:inline ${
                  i === 0 ? "text-blue-600 font-medium" : "text-gray-400"
                }`}>
                  {label}
                </span>
                {i < 3 && <div className="flex-1 h-px bg-gray-200 mx-2" />}
              </div>
            ))}
          </div>

          {/* フォーム（ダミー） */}
          <div className="space-y-4 opacity-50 pointer-events-none">
            <div>
              <label className="block text-sm font-medium mb-1">申請区分 <span className="text-red-500">*</span></label>
              <div className="flex gap-3">
                <div className="flex-1 border-2 border-blue-500 rounded-lg p-3 text-center bg-blue-50">
                  <div className="text-lg">🛒</div>
                  <div className="text-sm font-medium">購入前</div>
                </div>
                <div className="flex-1 border-2 border-gray-200 rounded-lg p-3 text-center">
                  <div className="text-lg">📦</div>
                  <div className="text-sm font-medium">購入済</div>
                </div>
              </div>
            </div>
            <button className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm">
              次へ: 商品情報
            </button>
          </div>
        </div>

        {/* タスク詳細テーブル */}
        {SAMPLE_TASKS[scenario].length > 0 && (
          <div className="bg-white border rounded-lg p-4 mt-6">
            <h3 className="font-medium text-sm text-gray-700 mb-3">タスク詳細（参考）</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2">PO番号</th>
                  <th className="pb-2">品目</th>
                  <th className="pb-2 text-right">金額</th>
                  <th className="pb-2">ステータス</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_TASKS[scenario].map((t) => (
                  <tr key={t.prNumber} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{t.prNumber}</td>
                    <td className="py-2">{t.itemName}</td>
                    <td className="py-2 text-right">¥{t.totalAmount.toLocaleString()}</td>
                    <td className="py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        t.status === "発注待ち" ? "bg-blue-100 text-blue-700" :
                        t.status === "検収待ち" ? "bg-indigo-100 text-indigo-700" :
                        t.status === "証憑待ち" ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

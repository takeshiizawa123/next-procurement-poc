"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-2xl mx-auto p-8 text-center">
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-red-700 mb-2">管理画面でエラーが発生しました</h2>
        <p className="text-sm text-red-600 mb-4">{error.message || "予期しないエラーです。"}</p>
        <button onClick={reset} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
          再試行
        </button>
      </div>
    </div>
  );
}

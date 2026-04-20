"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

interface DetailResult {
  ok: boolean;
  filter: { debitKeyword: string; creditKeyword: string };
  summary: { filteredCount: number; totalAmount: number };
  byDebitAccount: Array<{ accountName: string; count: number; total: number }>;
  byCounterparty: Array<{ counterpartyName: string; count: number; total: number; accountCount: number; accountNames: string[] }>;
  repeatedPatterns: Array<{
    accountName: string;
    counterpartyName: string;
    count: number;
    total: number;
    avgAmount: number;
    minAmount: number;
    maxAmount: number;
    isFixed: boolean;
  }>;
  samples: Array<{
    id: number;
    date: string;
    debitAccount: string;
    counterparty: string;
    amount: number;
    memo: string;
  }>;
}

interface AnalysisResult {
  ok: boolean;
  period: { from: string; to: string };
  summary: {
    totalJournals: number;
    regularJournals: number;
    adjustingEntries: number;
    inScopeCount: number;
    outOfScopeCount: number;
    handledCount: number;
    unclassifiedCount: number;
    totalAmount: number;
    inScopeAmount: number;
    outOfScopeAmount: number;
    handledAmount: number;
    unclassifiedAmount: number;
    coverageRate: number;
    coverageRateByAmount: number;
  };
  typeBreakdown: Array<{
    type: string;
    count: number;
    totalAmount: number;
    canHandle: boolean;
    isOutOfScope: boolean;
    flow: string;
  }>;
  notHandledSamples: Array<{
    id: number;
    date: string;
    type: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
    memo: string;
  }>;
}

function currentMonth() {
  const d = new Date();
  // デフォルトは前月（分析対象は通常、締め済みの前月）
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function AnalyzeJournalsPage() {
  const user = useUser();
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTitle, setDetailTitle] = useState<string>("");

  async function loadDetail(type: string) {
    setDetailLoading(true);
    setDetailTitle(type);
    try {
      // typeに応じてフィルタを決定
      let debitKw = "";
      let creditKw = "";
      if (type === "範囲外/未払費用計上(決算)") { creditKw = "未払費用"; }
      else if (type === "範囲外/未払費用支払") { debitKw = "未払費用"; }
      else if (type === "範囲外/支払消込") { debitKw = "未払金"; }
      else if (type === "範囲外/源泉税等納付") { debitKw = "預り金"; }
      else if (type === "範囲外/前払費用") { debitKw = "前払費用"; }
      else if (type.startsWith("範囲外/")) { /* その他は集計不可 */ return; }
      else {
        // 対象内の場合は借方科目名で検索（分類ルールの最初のkeyword推測は難しいので type から推測）
        debitKw = type.split("/")[0]; // ex: "役務" or "通信" or "SaaS"
      }
      const params = new URLSearchParams({ month });
      if (debitKw) params.set("debitKeyword", debitKw);
      if (creditKw) params.set("creditKeyword", creditKw);
      const res = await apiFetch(`/api/admin/analyze-journal-detail?${params}`);
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "詳細取得失敗");
        return;
      }
      setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }

  async function analyze() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await apiFetch(`/api/admin/analyze-journals?month=${month}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "取得失敗");
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setLoading(false);
    }
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

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-bold mb-4">MF会計Plus 仕訳のカバー範囲分析</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
        💡 MF会計Plusから対象月の仕訳を取得し、新システムのどのフローで再現できるかを分類します。
        未対応・未分類の仕訳が、機能ギャップの候補になります。
        <br />
        <strong>注意</strong>: MF認証が切れている場合は先に{" "}
        <a href="/api/mf/auth" className="underline text-blue-600">/api/mf/auth</a>{" "}
        で認証してください。
      </div>

      <div className="bg-white border rounded-xl p-4 mb-4 flex items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">対象月</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "分析中…" : "分析実行"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      {data && (
        <>
          {/* サマリKPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard title="総仕訳数" value={`${data.summary.totalJournals}件`} />
            <KpiCard
              title="通常仕訳"
              value={`${data.summary.regularJournals}件`}
              sub={`決算整理 ${data.summary.adjustingEntries}件除外`}
            />
            <KpiCard
              title="購買管理 対象内"
              value={`${data.summary.inScopeCount}件`}
              sub={`¥${data.summary.inScopeAmount.toLocaleString()}`}
            />
            <KpiCard
              title="範囲外"
              value={`${data.summary.outOfScopeCount}件`}
              sub={`¥${data.summary.outOfScopeAmount.toLocaleString()} (経理直接/財務等)`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <KpiCard
              title="✅ 新システム対応可"
              value={`${data.summary.handledCount}件`}
              sub={`¥${data.summary.handledAmount.toLocaleString()}`}
              color="green"
            />
            <KpiCard
              title="⚠️ 未分類（要ルール追加）"
              value={`${data.summary.unclassifiedCount}件`}
              sub={`¥${data.summary.unclassifiedAmount.toLocaleString()}`}
              color={data.summary.unclassifiedCount > 0 ? "red" : undefined}
            />
          </div>

          <div className="bg-white border rounded-xl p-4 mb-4">
            <h3 className="font-bold text-sm mb-1">購買管理 対象内のカバー率</h3>
            <p className="text-xs text-gray-500 mb-2">範囲外（売掛金入金・支払消込・借入・税務等）を除いた割合</p>
            <div className="space-y-2 text-sm">
              <ProgressBar label="件数ベース" value={data.summary.coverageRate} />
              <ProgressBar label="金額ベース" value={data.summary.coverageRateByAmount} />
            </div>
          </div>

          {/* 種別内訳 */}
          <div className="bg-white border rounded-xl p-4 mb-4">
            <h3 className="font-bold text-sm mb-3">種別内訳（金額降順）</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium">種別</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">件数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">金額</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">対応フロー</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">内訳</th>
                </tr>
              </thead>
              <tbody>
                {data.typeBreakdown.map((t) => (
                  <tr key={t.type} className={`border-b ${t.isOutOfScope ? "bg-gray-50 text-gray-500" : ""}`}>
                    <td className="px-3 py-2">
                      {t.canHandle ? "✅" : t.isOutOfScope ? "⬜" : "⚠️"}{" "}
                      <span className="font-medium">{t.type}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{t.count}</td>
                    <td className="px-3 py-2 text-right">¥{t.totalAmount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{t.flow}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => loadDetail(t.type)}
                        disabled={detailLoading}
                        className="text-xs text-blue-600 hover:underline disabled:text-gray-400"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 詳細内訳パネル */}
          {detailLoading && (
            <div className="bg-white border rounded-xl p-4 mb-4 text-center text-sm text-gray-400">
              詳細取得中…
            </div>
          )}
          {detail && !detailLoading && (
            <div className="bg-white border-2 border-blue-300 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">
                  📊 詳細内訳: {detailTitle}（{detail.summary.filteredCount}件 ¥{detail.summary.totalAmount.toLocaleString()}）
                </h3>
                <button onClick={() => setDetail(null)} className="text-xs text-gray-500 hover:underline">
                  閉じる
                </button>
              </div>

              {/* 借方科目別 */}
              <div className="mb-4">
                <h4 className="text-xs font-bold text-gray-700 mb-1">借方科目別</h4>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-2 py-1 text-left">借方科目</th>
                      <th className="px-2 py-1 text-right">件数</th>
                      <th className="px-2 py-1 text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.byDebitAccount.map((a) => (
                      <tr key={a.accountName} className="border-b">
                        <td className="px-2 py-1">{a.accountName}</td>
                        <td className="px-2 py-1 text-right">{a.count}</td>
                        <td className="px-2 py-1 text-right">¥{a.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 繰り返しパターン（契約化候補） */}
              {detail.repeatedPatterns.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-gray-700 mb-1">
                    🎯 繰り返しパターン（{detail.repeatedPatterns.length}件 — 契約化候補）
                  </h4>
                  <p className="text-xs text-gray-500 mb-1">
                    同じ借方科目×取引先で複数回発生。契約マスタに登録すれば月次見積計上で自動化できる可能性。
                  </p>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left">借方科目</th>
                        <th className="px-2 py-1 text-left">取引先</th>
                        <th className="px-2 py-1 text-right">件数</th>
                        <th className="px-2 py-1 text-right">合計</th>
                        <th className="px-2 py-1 text-right">平均</th>
                        <th className="px-2 py-1 text-center">定額/従量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.repeatedPatterns.map((p, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-2 py-1">{p.accountName}</td>
                          <td className="px-2 py-1">{p.counterpartyName}</td>
                          <td className="px-2 py-1 text-right">{p.count}</td>
                          <td className="px-2 py-1 text-right">¥{p.total.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right">¥{p.avgAmount.toLocaleString()}</td>
                          <td className="px-2 py-1 text-center">
                            {p.isFixed ? <span className="text-blue-600">固定</span> : <span className="text-orange-600">従量</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 取引先別 */}
              <div className="mb-4">
                <h4 className="text-xs font-bold text-gray-700 mb-1">取引先別（上位30）</h4>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-2 py-1 text-left">取引先</th>
                      <th className="px-2 py-1 text-right">件数</th>
                      <th className="px-2 py-1 text-right">金額</th>
                      <th className="px-2 py-1 text-left">使用科目</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.byCounterparty.map((c) => (
                      <tr key={c.counterpartyName} className="border-b">
                        <td className="px-2 py-1">{c.counterpartyName}</td>
                        <td className="px-2 py-1 text-right">{c.count}</td>
                        <td className="px-2 py-1 text-right">¥{c.total.toLocaleString()}</td>
                        <td className="px-2 py-1 text-xs text-gray-600">{c.accountNames.slice(0, 3).join(", ")}{c.accountCount > 3 ? `…+${c.accountCount - 3}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 未対応サンプル */}
          {data.notHandledSamples.length > 0 && (
            <div className="bg-white border rounded-xl p-4">
              <h3 className="font-bold text-sm mb-3">
                ⚠️ 未対応・未分類サンプル（上位 {data.notHandledSamples.length} 件）
              </h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium">日付</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">分類</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">借方</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">貸方</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">金額</th>
                    <th className="px-3 py-2 text-left text-xs font-medium">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notHandledSamples.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-3 py-2 text-xs">{r.date}</td>
                      <td className="px-3 py-2 text-xs">{r.type}</td>
                      <td className="px-3 py-2 text-xs">{r.debitAccount}</td>
                      <td className="px-3 py-2 text-xs">{r.creditAccount}</td>
                      <td className="px-3 py-2 text-right">¥{r.amount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub?: string;
  color?: "green" | "red";
}) {
  const border =
    color === "red" ? "border-red-300" : color === "green" ? "border-green-300" : "border-gray-200";
  return (
    <div className={`bg-white border ${border} rounded-xl p-3`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-green-500" : value >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(1)}%</span>
      </div>
      <div className="bg-gray-100 rounded h-4">
        <div className={`${color} h-4 rounded`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

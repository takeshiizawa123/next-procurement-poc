"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

// --- 型定義 ---

interface ConfidentMatch {
  statementId?: string;
  poNumber: string;
  applicant: string;
  supplier: string;
  predictedAmount: number;
  actualAmount: number;
  diff: number;
  cardLast4: string;
  date: string;
  matchMethod?: "prediction" | "score";
  score?: number;
}

interface CandidateMatch {
  poNumber: string;
  applicant: string;
  supplier: string;
  amount: number;
  date: string;
  cardLast4: string;
  candidates: {
    date: string;
    amount: number;
    merchant: string;
    cardLast4: string;
    method?: string;
    score?: number;
    approved?: boolean;
  }[];
  resolved?: boolean;
}

interface UnmatchedPurchase {
  poNumber: string;
  applicant: string;
  supplier: string;
  amount: number;
  cardLast4: string;
  applicationDate: string;
  predictionId?: string;
  reason?: string;
  resolved?: boolean;
  resolution?: string;
}

interface UnreportedUsage {
  statementId?: string;
  date: string;
  amount: number;
  merchant: string;
  cardLast4: string;
  employee: string;
  reason?: string;
  resolved?: boolean;
  resolution?: string;
}

interface MatchingSummary {
  totalStatements: number;
  totalPredictions: number;
  confidentCount: number;
  candidateCount: number;
  unmatchedCount: number;
  unreportedCount: number;
  matchRate: number;
}

// --- 引落照合データ型 ---

interface UnpaidData {
  usageMonth: string;
  unpaidTotal: number;
  unpaidBreakdown: { label: string; amount: number; count: number }[];
  journalCount: number;
}

// --- 利用明細CSVパーサー ---

interface CardUsageItem {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  cardHolder: string;
  cardLast4: string;
  status: string; // 確定 or 速報
  currency: string;
}

/**
 * MFビジネスカード利用明細CSVをパース
 *
 * カラム: カード利用明細ID,取引日時,確定日時,支払先,...,取引状況,金額,...,カード名義人,カード番号4桁,...
 */
function parseUsageCsv(text: string): CardUsageItem[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const idxId = header.findIndex((h) => h.includes("利用明細ID"));
  const idxDate = header.findIndex((h) => h === "取引日時");
  const idxMerchant = header.findIndex((h) => h === "支払先");
  const idxStatus = header.findIndex((h) => h === "取引状況");
  const idxAmount = header.findIndex((h) => h === "金額");
  const idxCurrency = header.findIndex((h) => h.includes("現地通貨コード"));
  const idxHolder = header.findIndex((h) => h.includes("カード名義人"));
  const idxLast4 = header.findIndex((h) => h.includes("カード番号4桁"));

  if (idxAmount < 0) return []; // 必須カラムがない

  const results: CardUsageItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rawAmount = parseFloat(String(cols[idxAmount] || "0").replace(/,/g, ""));
    if (rawAmount === 0 || isNaN(rawAmount)) continue;

    const dateStr = String(cols[idxDate] || "");
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    const date = m ? `${m[2]}/${m[3]}` : "??/??";

    const status = String(cols[idxStatus] || "");

    results.push({
      id: String(cols[idxId] || ""),
      date,
      merchant: String(cols[idxMerchant] || ""),
      amount: Math.abs(rawAmount),
      cardHolder: String(cols[idxHolder] || ""),
      cardLast4: String(cols[idxLast4] || ""),
      status,
      currency: String(cols[idxCurrency] || "JPY"),
    });
  }
  return results;
}

/** CSV種別を自動判定 */
function detectCsvType(text: string): "usage" | "withdrawal" | "unknown" {
  const firstLine = text.trim().split("\n")[0] || "";
  if (firstLine.includes("カード利用明細ID") && firstLine.includes("支払先")) return "usage";
  if (firstLine.includes("入出金履歴ID") && firstLine.includes("確定金額")) return "withdrawal";
  return "unknown";
}

// --- ヘルパー ---

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function isMerchantSimilar(a: string, b: string): boolean {
  const na = a.toUpperCase().replace(/[\s.\-_]/g, "");
  const nb = b.toUpperCase().replace(/[\s.\-_]/g, "");
  return na.includes(nb) || nb.includes(na) || na.slice(0, 4) === nb.slice(0, 4);
}

function buildDiffTags(
  purchase: { date: string; amount: number; supplier: string },
  cand: { date: string; amount: number; merchant: string },
): string[] {
  const diffs: string[] = [];
  if (cand.date !== purchase.date) diffs.push(`日付が異なる（${purchase.date} → ${cand.date}）`);
  if (cand.amount !== purchase.amount) {
    const d = cand.amount - purchase.amount;
    diffs.push(`金額が${d > 0 ? "+" : ""}${yen(d)}異なる`);
  }
  if (!isMerchantSimilar(purchase.supplier, cand.merchant)) diffs.push(`取引先名が異なる`);
  return diffs;
}

// --- メイン ---

type TabKey = "confirmed" | "needs_review" | "not_found" | "unreported" | "withdrawal";

export default function CardMatchingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">読み込み中...</div>}>
      <CardMatchingContent />
    </Suspense>
  );
}

function CardMatchingContent() {
  const user = useUser();
  const [activeTab, setActiveTab] = useState<TabKey>("needs_review");
  const [confidentMatches, setConfidentMatches] = useState<ConfidentMatch[]>([]);
  const [candidates, setCandidates] = useState<CandidateMatch[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedPurchase[]>([]);
  const [unreported, setUnreported] = useState<UnreportedUsage[]>([]);
  const [matchingSummary, setMatchingSummary] = useState<MatchingSummary | null>(null);

  // CSV入力状態
  const [usageCsvLoaded, setUsageCsvLoaded] = useState(false);
  const [usageItems, setUsageItems] = useState<CardUsageItem[]>([]);
  const [csvInput, setCsvInput] = useState("");
  const [csvDragOver, setCsvDragOver] = useState(false);

  // API呼び出し状態
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // デモモード（?demo=1 でモックデータ表示 — マニュアルスクリーンショット用）
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("demo") !== "1") return;
    setConfidentMatches([
      { poNumber: "PO-202603-0042", applicant: "田中太郎", supplier: "Amazon", predictedAmount: 52800, actualAmount: 52800, diff: 0, cardLast4: "3815", date: "2026-03-15", matchMethod: "prediction", score: 100 },
      { poNumber: "PO-202603-0043", applicant: "田中太郎", supplier: "モノタロウ", predictedAmount: 33000, actualAmount: 33550, diff: 550, cardLast4: "3815", date: "2026-03-18", matchMethod: "prediction", score: 90 },
      { poNumber: "TR-202604-0015", applicant: "田中太郎", supplier: "JR東海", predictedAmount: 27500, actualAmount: 27500, diff: 0, cardLast4: "3815", date: "2026-03-20", matchMethod: "prediction", score: 100 },
      { poNumber: "PO-202603-0044", applicant: "管理本部", supplier: "Askul", predictedAmount: 8800, actualAmount: 8800, diff: 0, cardLast4: "7201", date: "2026-03-22", matchMethod: "score", score: 85 },
      { poNumber: "PO-202603-0045", applicant: "鈴木花子", supplier: "ヨドバシカメラ", predictedAmount: 15800, actualAmount: 15800, diff: 0, cardLast4: "4922", date: "2026-03-14", matchMethod: "prediction", score: 100 },
      { poNumber: "PO-202603-0046", applicant: "佐藤次郎", supplier: "ミスミ", predictedAmount: 42000, actualAmount: 42350, diff: 350, cardLast4: "5533", date: "2026-03-16", matchMethod: "prediction", score: 90 },
      { poNumber: "PO-202603-0047", applicant: "管理本部", supplier: "コクヨ", predictedAmount: 6200, actualAmount: 6200, diff: 0, cardLast4: "7201", date: "2026-03-19", matchMethod: "score", score: 82 },
    ]);
    setCandidates([
      { poNumber: "PO-202603-0048", applicant: "鈴木花子", supplier: "楽天市場", amount: 15400, date: "2026-03-20", cardLast4: "4922", candidates: [{ date: "2026-03-20", amount: 15400, merchant: "RAKUTEN ICHIBA", cardLast4: "4922", method: "予測マッチ", score: 100 }, { date: "2026-03-21", amount: 15400, merchant: "RAKUTEN PAY", cardLast4: "4922", method: "スコアリング", score: 65 }] },
      { poNumber: "PO-202603-0051", applicant: "管理本部", supplier: "ビックカメラ", amount: 89000, date: "2026-03-25", cardLast4: "7201", candidates: [{ date: "2026-03-25", amount: 89100, merchant: "BICCAMERA", cardLast4: "7201", method: "予測マッチ", score: 70 }] },
    ]);
    setUnmatched([
      { poNumber: "PO-202603-0052", applicant: "田中太郎", supplier: "海外EC", amount: 24500, cardLast4: "3815", applicationDate: "2026-03-28" },
    ]);
    setUnreported([
      { date: "2026-03-18", amount: 1200, merchant: "TAXI JAPAN", cardLast4: "3815", employee: "田中太郎" },
      { date: "2026-03-22", amount: 3500, merchant: "レストランABC", cardLast4: "4922", employee: "鈴木花子" },
      { date: "2026-03-25", amount: 980, merchant: "LAWSON", cardLast4: "3815", employee: "田中太郎" },
      { date: "2026-03-26", amount: 5200, merchant: "東急ハンズ", cardLast4: "5533", employee: "佐藤次郎" },
      { date: "2026-03-27", amount: 1800, merchant: "STARBUCKS", cardLast4: "4922", employee: "鈴木花子" },
    ]);
    setUsageCsvLoaded(true);
    setUsageItems([{ id: "demo", date: "03/15", merchant: "Demo", amount: 0, cardHolder: "", cardLast4: "", status: "確定", currency: "JPY" }]);
    setActiveTab("confirmed");
  }, [searchParams]);

  const executeMatching = useCallback(async (items: CardUsageItem[]) => {
    setIsExecuting(true);
    setExecuteError(null);
    try {
      const statements = items
        .filter((i) => i.status === "確定")
        .map((i) => ({
          id: i.id,
          date: i.date,
          merchant: i.merchant,
          amount: i.amount,
          cardHolder: i.cardHolder,
          cardLast4: i.cardLast4,
          status: i.status,
        }));

      const res = await apiFetch("/api/admin/card-matching/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth, statements }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API error ${res.status}`);

      setConfidentMatches(data.confidentMatches || []);
      setCandidates((data.candidateMatches || []).map((c: CandidateMatch) => ({ ...c, resolved: false })));
      setUnmatched((data.unmatchedPurchases || []).map((u: UnmatchedPurchase) => ({ ...u, resolved: false })));
      setUnreported((data.unreportedUsage || []).map((u: UnreportedUsage) => ({ ...u, resolved: false })));
      setMatchingSummary(data.summary || null);

      // 最も対応が必要なタブを自動選択
      if ((data.candidateMatches || []).length > 0) setActiveTab("needs_review");
      else if ((data.unreportedUsage || []).length > 0) setActiveTab("unreported");
      else setActiveTab("confirmed");

      console.log(`[matching] Done: matchRate=${data.summary?.matchRate}%`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setExecuteError(msg);
      console.error("[matching] Error:", msg);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedMonth]);

  function handleCsvLoad(text: string) {
    const type = detectCsvType(text);
    if (type === "usage") {
      const items = parseUsageCsv(text);
      if (items.length > 0) {
        setUsageItems(items);
        setUsageCsvLoaded(true);
        const confirmed = items.filter((i) => i.status === "確定");
        console.log(`[csv] 利用明細 ${items.length}件読込（確定: ${confirmed.length}件、速報: ${items.length - confirmed.length}件）`);
        // 自動でマッチング実行
        executeMatching(items);
      }
    } else if (type === "withdrawal") {
      setActiveTab("withdrawal");
      setCsvInput(text);
    }
  }

  function handleCsvFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setCsvDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvLoad(ev.target?.result as string);
    reader.readAsText(file, "UTF-8");
  }

  function handleCsvFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvLoad(ev.target?.result as string);
    reader.readAsText(file, "UTF-8");
  }

  const pendingCandidates = candidates.filter((c) => !c.resolved).length;
  const pendingUnmatched = unmatched.filter((u) => !u.resolved).length;
  const pendingUnreported = unreported.filter((u) => !u.resolved).length;
  const totalPending = pendingCandidates + pendingUnmatched + pendingUnreported;
  const totalItems = confidentMatches.length + candidates.length + unmatched.length + unreported.length;
  const processed = totalItems - totalPending;
  const pct = totalItems > 0 ? Math.round((processed / totalItems) * 100) : 0;
  const hasResults = totalItems > 0;
  const allDone = hasResults && totalPending === 0;

  function approveCandidate(poIdx: number, candIdx: number) {
    const candidate = candidates[poIdx];
    const selected = candidate?.candidates[candIdx];
    if (!candidate || !selected) return;

    // フロント状態を即時更新
    setCandidates((prev) =>
      prev.map((c, i) =>
        i === poIdx
          ? { ...c, resolved: true, candidates: c.candidates.map((cd, j) => ({ ...cd, approved: j === candIdx })) }
          : c,
      ),
    );

    // バックエンドで予測テーブル更新 + 差額調整仕訳作成
    apiFetch("/api/admin/card-matching/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId: `manual-${candidate.poNumber}`,
        poNumber: candidate.poNumber,
        journalId: 0,
        predictedAmount: candidate.amount,
        actualAmount: selected.amount,
        transactionDate: selected.date,
        supplier: candidate.supplier,
      }),
    }).catch((e) => console.error("[card-matching] Confirm error:", e));
  }
  function resolveUnmatched(idx: number, resolution: string) {
    setUnmatched((prev) => prev.map((u, i) => (i === idx ? { ...u, resolved: true, resolution } : u)));
  }
  function resolveUnreported(idx: number, resolution: string) {
    setUnreported((prev) => prev.map((u, i) => (i === idx ? { ...u, resolved: true, resolution } : u)));
  }

  const tabs: { key: TabKey; label: string; count: number; pending: number }[] = [
    { key: "confirmed", label: "自動照合済み", count: confidentMatches.length, pending: 0 },
    { key: "needs_review", label: "要確認", count: candidates.length, pending: pendingCandidates },
    { key: "not_found", label: "明細なし", count: unmatched.length, pending: pendingUnmatched },
    { key: "unreported", label: "未申請利用", count: unreported.length, pending: pendingUnreported },
    { key: "withdrawal", label: "引落照合", count: 1, pending: 0 },
  ];

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">カード明細照合</h1>
            <p className="text-sm text-gray-500">
              {selectedMonth.replace(/^(\d{4})-0?(\d{1,2})$/, "$1年$2月")}分
              {matchingSummary && ` — マッチ率 ${matchingSummary.matchRate}%`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {(() => {
                const options: { value: string; label: string }[] = [];
                const now = new Date();
                for (let i = 0; i < 6; i++) {
                  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                  options.push({
                    value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                    label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
                  });
                }
                return options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>);
              })()}
            </select>
            <button
              onClick={() => usageItems.length > 0 && executeMatching(usageItems)}
              disabled={!usageCsvLoaded || isExecuting}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExecuting ? "照合中..." : "照合実行"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {/* CSV読込バー */}
        {usageCsvLoaded ? (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-600">&#10003;</span>
                <span className="text-gray-700">
                  利用明細 <strong>{usageItems.length}件</strong>を読込済み
                  （確定: {usageItems.filter((i) => i.status === "確定").length}件
                  {usageItems.some((i) => i.status === "速報") && `、速報: ${usageItems.filter((i) => i.status === "速報").length}件`}）
                </span>
              </div>
              <button
                onClick={() => { setUsageCsvLoaded(false); setUsageItems([]); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                別のCSVを読み込む
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`bg-white rounded-lg border-2 border-dashed px-5 py-4 transition-colors ${
              csvDragOver ? "border-blue-400 bg-blue-50" : "border-gray-300"
            }`}
            onDragOver={(e) => { e.preventDefault(); setCsvDragOver(true); }}
            onDragLeave={() => setCsvDragOver(false)}
            onDrop={handleCsvFileDrop}
          >
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">
                MFビジネスカードのCSVをドロップ、または
                <label className="text-blue-600 hover:text-blue-800 cursor-pointer mx-1 font-medium">
                  ファイルを選択
                  <input type="file" accept=".csv" className="hidden" onChange={handleCsvFileSelect} />
                </label>
              </p>
              <p className="text-xs text-gray-400">
                <strong>利用明細CSV</strong> → カード利用と購買申請を照合 ／
                <strong>入出金履歴CSV</strong> → 引落額と未払金を照合
              </p>
            </div>
          </div>
        )}

        {/* ローディング */}
        {isExecuting && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 text-center">
            <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent mr-2 align-middle" />
            <span className="text-sm text-blue-700">照合を実行中... 予測テーブル・MF仕訳を取得しています（最大30秒）</span>
          </div>
        )}

        {/* エラー */}
        {executeError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3">
            <p className="text-sm text-red-700">照合エラー: {executeError}</p>
            <p className="text-xs text-red-500 mt-1">CSVを確認するか、ネットワーク接続を確認してください</p>
          </div>
        )}

        {/* プログレスバー */}
        {hasResults && !allDone && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-700">
                <span className="font-bold text-lg text-gray-900">{totalPending}件</span>
                <span className="ml-1">の確認が必要です</span>
              </p>
              <p className="text-xs text-gray-400">{processed}/{totalItems}件 処理済み</p>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* 完了バナー */}
        {allDone && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <p className="text-green-800 text-lg font-bold mb-1">{selectedMonth.replace(/^(\d{4})-0?(\d{1,2})$/, "$2月")}分の照合が完了しました</p>
            <p className="text-green-600 text-sm">全{totalItems}件 処理済み</p>
            <button className="mt-4 bg-green-600 text-white text-sm font-medium px-6 py-2 rounded-md hover:bg-green-700">
              Slackに完了通知を送信
            </button>
          </div>
        )}

        {/* タブ + コンテンツ */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`relative px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === t.key
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t.label}
                  {t.pending > 0 ? (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">
                      {t.pending}
                    </span>
                  ) : (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-5">
            {!hasResults && activeTab !== "withdrawal" ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-1">照合結果がありません</p>
                <p className="text-sm">上のエリアからMFビジネスカードのCSVを読み込むと、自動的に照合を実行します</p>
              </div>
            ) : (
              <>
                {activeTab === "confirmed" && <ConfirmedTab items={confidentMatches} />}
                {activeTab === "needs_review" && (
                  <NeedsReviewTab items={candidates} onApprove={approveCandidate} />
                )}
                {activeTab === "not_found" && (
                  <NotFoundTab items={unmatched} onResolve={resolveUnmatched} />
                )}
                {activeTab === "unreported" && (
                  <UnreportedTab items={unreported} onResolve={resolveUnreported} />
                )}
                {activeTab === "withdrawal" && (
                  <WithdrawalTab month={selectedMonth} />
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// --- タブ①: 自動照合済み ---

function ConfirmedTab({ items }: { items: ConfidentMatch[] }) {
  const withDiff = items.filter((i) => i.diff !== 0);
  const noDiff = items.filter((i) => i.diff === 0);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {items.length}件が自動的に照合されました。確認の必要はありません。
        {withDiff.length > 0 && (
          <span className="text-amber-600">（うち{withDiff.length}件は差額があります。MF会計Plusで調整仕訳の確認・作成をお願いします）</span>
        )}
      </p>

      {withDiff.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-amber-700 mb-2">差額があった取引</h3>
          <div className="space-y-1">
            {withDiff.map((item, i) => (
              <div key={i} className="flex items-center gap-4 py-2 px-3 bg-amber-50 rounded-md text-sm">
                <span className="font-mono text-gray-600 w-32">{item.poNumber}</span>
                <span className="text-gray-500 w-12">{item.date}</span>
                <span className="text-gray-700 w-28">{item.supplier}{/amazon|アマゾン/i.test(item.supplier) && <AmazonBadge />}</span>
                <span className="text-gray-500">{item.applicant}</span>
                <span className="ml-auto font-mono text-gray-500">{yen(item.predictedAmount)}</span>
                <span className="text-gray-400">→</span>
                <span className="font-mono text-gray-900">{yen(item.actualAmount)}</span>
                <span className="font-mono text-red-600 font-medium w-16 text-right">+{yen(item.diff)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-medium text-gray-400 mb-2">差額なし（{noDiff.length}件）</h3>
      <div className="space-y-0.5">
        {noDiff.map((item, i) => (
          <div key={i} className="flex items-center gap-4 py-1.5 px-3 text-sm text-gray-400">
            <span className="font-mono w-32">{item.poNumber}</span>
            <span className="w-12">{item.date}</span>
            <span className="w-28">{item.supplier}{/amazon|アマゾン/i.test(item.supplier) && <AmazonBadge />}</span>
            <span>{item.applicant}</span>
            <span className="ml-auto font-mono">{yen(item.actualAmount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- タブ②: 要確認 ---

function NeedsReviewTab({
  items,
  onApprove,
}: {
  items: CandidateMatch[];
  onApprove: (poIdx: number, candIdx: number) => void;
}) {
  const pending = items.filter((i) => !i.resolved);
  const done = items.filter((i) => i.resolved);

  return (
    <div>
      {pending.length > 0 && (
        <p className="text-sm text-gray-500 mb-4">
          自動照合できなかった{pending.length}件です。正しいカード明細を選んでください。
        </p>
      )}
      {pending.length === 0 && (
        <p className="text-sm text-green-600 mb-4">全て対応済みです。</p>
      )}

      <div className="space-y-4">
        {items.map((item, poIdx) => {
          if (item.resolved) {
            const approved = item.candidates.find((c) => c.approved);
            return (
              <div key={poIdx} className="rounded-lg border border-green-200 px-5 py-3 opacity-50">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-green-600">&#10003;</span>
                  <span className="font-mono text-gray-600">{item.poNumber}</span>
                  <span className="text-gray-500">{item.supplier}</span>
                  <span className="text-gray-400">→ {approved?.merchant} に確定</span>
                </div>
              </div>
            );
          }

          return (
            <div key={poIdx} className="rounded-lg border border-amber-200 overflow-hidden">
              {/* 購買情報 */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono font-medium text-gray-900">{item.poNumber}</span>
                  <span className="text-gray-600">{item.date}</span>
                  <span className="font-mono text-gray-900">{yen(item.amount)}</span>
                  <span className="text-gray-700">{item.supplier}</span>
                  <span className="text-gray-400">({item.applicant} / *{item.cardLast4})</span>
                </div>
              </div>

              {/* 候補 */}
              <div className="divide-y divide-gray-100">
                {item.candidates.map((cand, candIdx) => {
                  const diffs = buildDiffTags(
                    { date: item.date, amount: item.amount, supplier: item.supplier },
                    cand,
                  );
                  const amountMatch = cand.amount === item.amount;
                  const dateMatch = cand.date === item.date;
                  const nameMatch = isMerchantSimilar(item.supplier, cand.merchant);
                  const amountDiff = cand.amount - item.amount;

                  return (
                    <div key={candIdx} className="px-5 py-3 hover:bg-blue-50/20">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-gray-400 text-xs w-10">候補{candIdx + 1}</span>
                          <span className={dateMatch ? "text-gray-600" : "font-medium text-red-700"}>{cand.date}</span>
                          <span className={`font-mono ${amountMatch ? "text-gray-600" : "font-medium text-red-700"}`}>
                            {yen(cand.amount)}
                            {!amountMatch && (
                              <span className="text-red-500 text-xs ml-1">({amountDiff > 0 ? "+" : ""}{yen(amountDiff)})</span>
                            )}
                          </span>
                          <span className={nameMatch ? "text-gray-600" : "font-medium text-red-700"}>{cand.merchant}</span>
                          <span className="font-mono text-gray-400">*{cand.cardLast4}</span>
                        </div>
                        <button
                          onClick={() => onApprove(poIdx, candIdx)}
                          className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 shrink-0"
                        >
                          これに確定
                        </button>
                      </div>
                      {diffs.length > 0 && (
                        <div className="ml-10 flex items-center gap-1.5 flex-wrap">
                          {diffs.map((d, i) => (
                            <span key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-2 border-t border-gray-100">
                <button className="text-xs text-gray-400 hover:text-gray-600">どれにも該当しない（手動で照合する）</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- タブ③: 明細なし ---

function NotFoundTab({
  items,
  onResolve,
}: {
  items: UnmatchedPurchase[];
  onResolve: (idx: number, resolution: string) => void;
}) {
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        カード明細に該当する利用が見つからなかった購買です。
      </p>
      <div className="space-y-3">
        {items.map((item, idx) => {
          if (item.resolved) {
            return (
              <div key={idx} className="rounded-lg border border-green-200 px-5 py-3 opacity-50">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-green-600">&#10003;</span>
                  <span className="font-mono text-gray-600">{item.poNumber}</span>
                  <span className="text-gray-400">→ {item.resolution}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={idx} className="rounded-lg border border-gray-200 px-5 py-4">
              <div className="flex items-center gap-3 mb-2 text-sm">
                <span className="font-mono font-medium text-gray-900">{item.poNumber}</span>
                <span className="text-gray-600">{item.supplier}</span>
                <span className="text-gray-400">{item.applicant}</span>
                <span className="font-mono text-gray-900">{yen(item.amount)}</span>
              </div>
              <p className="text-sm text-gray-500 mb-3">
                {item.applicationDate}に申請。月末利用で翌月確定の可能性があります。
              </p>
              <div className="flex gap-2">
                <button onClick={() => onResolve(idx, "翌月に繰越")}
                  className="px-4 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 border border-blue-200">
                  来月もう一度照合する
                </button>
                <button onClick={() => onResolve(idx, "キャンセル確認中")}
                  className="px-4 py-1.5 text-sm font-medium bg-gray-50 text-gray-600 rounded-md hover:bg-gray-100 border border-gray-200">
                  キャンセル済みかもしれない
                </button>
                <button onClick={() => onResolve(idx, "手動照合")}
                  className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600">
                  手動で探す
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- タブ④: 未申請利用 ---

function UnreportedTab({
  items,
  onResolve,
}: {
  items: UnreportedUsage[];
  onResolve: (idx: number, resolution: string) => void;
}) {
  const pending = items.filter((u) => !u.resolved);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        購買申請がないカード利用です。本人に確認するか、経費として処理してください。
      </p>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {items.map((item, idx) => {
          if (item.resolved) {
            return (
              <div key={idx} className="px-5 py-3 flex items-center gap-4 opacity-50 text-sm">
                <span className="text-green-600">&#10003;</span>
                <span className="text-gray-500 w-12">{item.date}</span>
                <span className="text-gray-400 w-20 text-right font-mono">{yen(item.amount)}</span>
                <span className="text-gray-400 flex-1">{item.merchant}</span>
                <span className="text-gray-400">{item.employee}</span>
                <span className="text-xs text-green-600 ml-auto">{item.resolution}</span>
              </div>
            );
          }
          return (
            <div key={idx} className="px-5 py-3 flex items-center gap-4 hover:bg-red-50/30 text-sm">
              <span className="text-red-400 font-bold">!</span>
              <span className="text-gray-600 w-12">{item.date}</span>
              <span className="text-gray-900 w-20 text-right font-mono font-medium">{yen(item.amount)}</span>
              <span className="text-gray-700 flex-1">{item.merchant}</span>
              <span className="text-gray-600 font-medium">{item.employee}</span>
              <div className="flex gap-1.5 ml-auto">
                <button onClick={() => onResolve(idx, "申請依頼済み")}
                  className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700">
                  本人に確認
                </button>
                <button onClick={() => onResolve(idx, "経費処理済み")}
                  className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200">
                  経費で処理
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {pending.length > 1 && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => items.forEach((_, i) => { if (!items[i].resolved) onResolve(i, "申請依頼済み"); })}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            未対応の{pending.length}件にまとめて申請依頼を送信
          </button>
        </div>
      )}
    </div>
  );
}

// --- タブ⑤: 引落照合 ---

interface ParsedWithdrawalItem {
  date: string;
  amount: number;
  description: string;
  card: string;
}

/**
 * MFビジネスカード請求明細（入出金履歴）CSVをパース
 *
 * 想定フォーマット:
 *   入出金履歴ID,カード利用明細ID,取引日時,確定日時,取引内容,確定金額,カード
 *
 * 汎用CSVにもフォールバック対応（日付,摘要,金額 等）
 */
function parseWithdrawalCsv(text: string): ParsedWithdrawalItem[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const results: ParsedWithdrawalItem[] = [];

  // ヘッダー行を検出してカラムインデックスを特定
  const header = lines[0];
  const headerCols = parseCsvLine(header);

  // MFビジネスカード入出金履歴フォーマット検出
  const isMfFormat = headerCols.some((h) => h.includes("確定金額") || h.includes("入出金履歴ID"));

  if (isMfFormat) {
    const idxDate = headerCols.findIndex((h) => h.includes("確定日時"));
    const idxAmount = headerCols.findIndex((h) => h.includes("確定金額"));
    const idxDesc = headerCols.findIndex((h) => h.includes("取引内容"));
    const idxCard = headerCols.findIndex((h) => h.includes("カード"));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const rawAmount = parseFloat(String(cols[idxAmount] || "0").replace(/,/g, ""));
      if (rawAmount === 0 || isNaN(rawAmount)) continue;

      const dateStr = String(cols[idxDate] || cols[2] || "");
      const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      const date = m ? `${m[2]}/${m[3]}` : "??/??";

      const card = String(cols[idxCard] || "");
      const cardLast4Match = card.match(/\.{3,4}(\d{4})/);

      results.push({
        date,
        amount: Math.abs(rawAmount),
        description: String(cols[idxDesc] || ""),
        card: cardLast4Match ? `*${cardLast4Match[1]}` : card.trim(),
      });
    }
  } else {
    // 汎用フォールバック: ヘッダー含む場合はスキップ
    const startIdx = /[日付,date,摘要]/i.test(header) ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      let date = "", amount = 0, desc = "";
      for (const col of cols) {
        const num = Number(String(col).replace(/[,¥\\]/g, ""));
        const dateM = String(col).match(/(\d{1,2})[\/\-](\d{1,2})/);
        if (dateM && !date) {
          date = `${dateM[1].padStart(2, "0")}/${dateM[2].padStart(2, "0")}`;
        } else if (!isNaN(num) && Math.abs(num) > 0 && !amount) {
          amount = Math.abs(num);
        } else if (String(col).length > 1 && isNaN(Number(col)) && !desc) {
          desc = String(col);
        }
      }
      if (amount > 0) results.push({ date: date || "??/??", amount, description: desc || "（摘要なし）", card: "" });
    }
  }

  return results;
}

/** CSV行をパース（ダブルクォート対応） */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function WithdrawalTab({ month }: { month: string }) {
  const [csvText, setCsvText] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedWithdrawalItem[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<{ ok: boolean; journalId?: number; message?: string } | null>(null);

  // API から取得した未払金データ
  const [unpaidData, setUnpaidData] = useState<UnpaidData | null>(null);
  const [isLoadingUnpaid, setIsLoadingUnpaid] = useState(false);
  const [unpaidError, setUnpaidError] = useState<string | null>(null);

  // month変更時に未払金データを取得
  useEffect(() => {
    setIsLoadingUnpaid(true);
    setUnpaidError(null);
    apiFetch("/api/admin/card-matching/withdrawal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
        setUnpaidData({
          usageMonth: data.usageMonth,
          unpaidTotal: data.unpaidTotal,
          unpaidBreakdown: data.unpaidBreakdown,
          journalCount: data.journalCount,
        });
      })
      .catch((e) => {
        setUnpaidError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setIsLoadingUnpaid(false));
  }, [month]);

  const usageMonth = unpaidData?.usageMonth || month.replace(/^(\d{4})-0?(\d{1,2})$/, "$1年$2月");
  const unpaidTotal = unpaidData?.unpaidTotal || 0;
  const unpaidBreakdown = unpaidData?.unpaidBreakdown || [];

  // パース済みなら照合結果を計算
  const withdrawalTotal = parsedItems ? parsedItems.reduce((s, i) => s + i.amount, 0) : 0;
  const difference = parsedItems ? unpaidTotal - withdrawalTotal : 0;
  const isMatched = parsedItems ? difference === 0 : false;

  async function handleConfirmWithdrawal() {
    if (confirmingWithdrawal) return;
    setConfirmingWithdrawal(true);
    setWithdrawalResult(null);
    try {
      // 引落日: CSVの最初の日付、またはデフォルトで翌月27日
      const withdrawalDate = parsedItems?.[0]?.date || (() => {
        const [y, m] = month.split("-").map(Number);
        const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        return `${nextMonth}-27`;
      })();
      const res = await apiFetch("/api/admin/card-matching/withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          action: "confirm",
          withdrawalDate,
          withdrawalAmount: withdrawalTotal || unpaidTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
      setWithdrawalResult({ ok: true, journalId: data.stage3JournalId, message: `Stage 3 仕訳を作成しました（ID: ${data.stage3JournalId}）` });
    } catch (e) {
      setWithdrawalResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setConfirmingWithdrawal(false);
    }
  }

  function handleParse() {
    if (!csvText.trim()) return;
    const items = parseWithdrawalCsv(csvText);
    if (items.length > 0) {
      setParsedItems(items);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      const items = parseWithdrawalCsv(text);
      if (items.length > 0) setParsedItems(items);
    };
    reader.readAsText(file, "UTF-8");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      const items = parseWithdrawalCsv(text);
      if (items.length > 0) setParsedItems(items);
    };
    reader.readAsText(file, "UTF-8");
  }

  // 未入力 → CSV入力画面
  if (!parsedItems) {
    return (
      <div>
        <p className="text-sm text-gray-500 mb-2">
          {usageMonth}利用分の未払金合計と、MFビジネスカードの請求明細を照合します。
        </p>
        <p className="text-sm text-gray-500 mb-5">
          MFビジネスカード管理画面からダウンロードした<strong>入出金履歴CSV</strong>を貼り付けるか、ファイルをドロップしてください。
        </p>

        {/* 未払金サマリー */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 px-5 py-4 mb-5">
          <p className="text-sm font-medium text-gray-700 mb-2">未払金(請求)合計（{usageMonth}利用分）</p>
          {isLoadingUnpaid ? (
            <div className="flex items-center gap-2">
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
              <span className="text-sm text-gray-500">MF会計Plusから取得中...</span>
            </div>
          ) : unpaidError ? (
            <div>
              <p className="text-sm text-red-600">取得エラー: {unpaidError}</p>
              <p className="text-xs text-gray-400 mt-1">MF会計Plusの認証状態を確認してください</p>
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold font-mono text-gray-900">{yen(unpaidTotal)}</p>
              <p className="text-xs text-gray-400 mt-1">
                {unpaidBreakdown.length > 0
                  ? unpaidBreakdown.map((b) => `${b.label} ${b.count}件`).join(" / ")
                  : "仕訳データなし"}
              </p>
            </>
          )}
        </div>

        {/* CSV入力エリア */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
        >
          <p className="text-sm text-gray-500 mb-3">
            CSVファイルをここにドロップ、または
            <label className="text-blue-600 hover:text-blue-800 cursor-pointer mx-1 font-medium">
              ファイルを選択
              <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileSelect} />
            </label>
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"入出金履歴ID,カード利用明細ID,取引日時,確定日時,取引内容,確定金額,カード\nxxx,yyy,2026-01-02,2026-01-02,ラクスル株式会社,5044.0,HIROSHI OKA ....3815"}
            className="w-full h-32 text-sm font-mono border border-gray-200 rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
          />
          <button
            onClick={handleParse}
            disabled={!csvText.trim() || isLoadingUnpaid}
            className="mt-3 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            照合を実行
          </button>
        </div>
      </div>
    );
  }

  // パース済み → 照合結果表示
  return (
    <div>
      <p className="text-sm text-gray-500 mb-5">
        {usageMonth}利用分の未払金合計と、銀行引落額を照合しました。
      </p>

      {/* 照合結果サマリー */}
      <div className={`rounded-lg border-2 p-5 mb-6 ${
        isMatched ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
      }`}>
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-2xl ${isMatched ? "text-green-600" : "text-amber-600"}`}>
            {isMatched ? "\u25cb" : "\u25b3"}
          </span>
          <div>
            <p className={`font-bold text-lg ${isMatched ? "text-green-800" : "text-amber-800"}`}>
              {isMatched ? "引落額が一致しました" : `差額 ${yen(Math.abs(difference))} があります`}
            </p>
            <p className="text-sm text-gray-500">
              {usageMonth}利用 → 銀行引落
            </p>
          </div>
        </div>

        {/* 金額比較 */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-500 mb-1">未払金(請求)合計</p>
            <p className="text-xl font-bold font-mono text-gray-900">{yen(unpaidTotal)}</p>
            <p className="text-xs text-gray-400">{unpaidBreakdown.reduce((s, b) => s + b.count, 0)}件</p>
          </div>
          <div className="flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-400 text-2xl">−</p>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-xs text-gray-500 mb-1">銀行引落額</p>
            <p className="text-xl font-bold font-mono text-gray-900">{yen(withdrawalTotal)}</p>
            <p className="text-xs text-gray-400">{parsedItems.length}件の引落</p>
          </div>
        </div>

        {!isMatched && (
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              差額 <span className="font-bold font-mono text-red-700">{yen(Math.abs(difference))}</span>
              <span className="text-gray-400 ml-1">
                （{difference > 0 ? "未払金が引落より多い" : "引落が未払金より多い"}）
              </span>
            </p>
          </div>
        )}
      </div>

      {/* 差額がある場合のガイド */}
      {!isMatched && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-gray-900 mb-3">差額の考えられる原因</h3>
          <div className="space-y-2">
            {difference > 0 ? (
              <>
                <DiffReasonCard reason="月末利用分が翌月確定に繰越された" action="翌月の引落に含まれる予定。来月再照合" />
                <DiffReasonCard reason="引落がまだ記帳されていない" action="銀行明細を再確認" />
                <DiffReasonCard reason="一部が返品・キャンセルで減額された" action="カード明細で返品分を確認" />
              </>
            ) : (
              <>
                <DiffReasonCard reason="前月の未払残高が今月引落に含まれている" action="前月の引落照合を確認" />
                <DiffReasonCard reason="年会費など未払金計上外の引落がある" action="引落明細の摘要を確認" />
                <DiffReasonCard reason="二重計上の可能性" action="仕訳一覧で重複を確認" />
              </>
            )}
          </div>
        </div>
      )}

      {/* 未払金の内訳 */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">未払金の内訳（{usageMonth}利用分）</h3>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          {unpaidBreakdown.map((item, i) => (
            <div key={i} className={`flex items-center justify-between px-4 py-2.5 text-sm ${
              i < unpaidBreakdown.length - 1 ? "border-b border-gray-100" : ""
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-gray-700">{item.label}</span>
                <span className="text-xs text-gray-400">{item.count}件</span>
              </div>
              <span className="font-mono text-gray-900">{yen(item.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 border-t border-gray-200 font-medium">
            <span className="text-gray-700">合計</span>
            <span className="font-mono text-gray-900">{yen(unpaidTotal)}</span>
          </div>
        </div>
      </div>

      {/* 引落明細（CSVから読み込んだデータ） */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900">銀行引落明細（CSVから読込）</h3>
          <button
            onClick={() => { setParsedItems(null); setCsvText(""); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            CSVを再入力する
          </button>
        </div>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          {parsedItems.map((item, i) => (
            <div key={i} className={`flex items-center justify-between px-4 py-2.5 text-sm ${
              i < parsedItems.length - 1 ? "border-b border-gray-100" : ""
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-gray-500 w-12">{item.date}</span>
                <span className="text-gray-700 flex-1">{item.description}</span>
                {item.card && <span className="font-mono text-gray-400 text-xs">{item.card}</span>}
              </div>
              <span className="font-mono text-gray-900 ml-3">{yen(item.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 border-t border-gray-200 font-medium">
            <span className="text-gray-700">合計</span>
            <span className="font-mono text-gray-900">{yen(withdrawalTotal)}</span>
          </div>
        </div>
      </div>

      {/* アクション */}
      <div className="flex gap-3">
        {withdrawalResult ? (
          <div className={`px-4 py-2 rounded-md text-sm ${withdrawalResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {withdrawalResult.message}
          </div>
        ) : isMatched ? (
          <button
            onClick={handleConfirmWithdrawal}
            disabled={confirmingWithdrawal}
            className="px-5 py-2 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
          >
            {confirmingWithdrawal ? "処理中..." : "消込を確定する"}
          </button>
        ) : (
          <>
            <button
              onClick={handleConfirmWithdrawal}
              disabled={confirmingWithdrawal}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {confirmingWithdrawal ? "処理中..." : "差額を承認して消込する"}
            </button>
            <button className="px-5 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 border border-gray-200">
              来月に再照合する
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DiffReasonCard({ reason, action }: { reason: string; action: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-sm text-gray-800">{reason}</p>
      <p className="text-xs text-blue-600 mt-1">{action}</p>
    </div>
  );
}

function AmazonBadge() {
  return (
    <a href="/admin/journals" className="ml-1 px-1 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium hover:bg-orange-200">
      Amazon照合
    </a>
  );
}

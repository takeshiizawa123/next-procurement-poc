"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useUser } from "@/lib/user-context";

const TRANSPORT_SERVICES = [
  { value: "スマートEX", label: "スマートEX（新幹線）" },
  { value: "えきねっと", label: "えきねっと（JR東日本）" },
  { value: "ANA", label: "ANA（航空券）" },
  { value: "JAL", label: "JAL（航空券）" },
  { value: "トヨタレンタカー", label: "トヨタレンタカー" },
  { value: "タイムズカー", label: "タイムズカー" },
  { value: "その他", label: "その他" },
];

const ACCOMMODATION_SERVICES = [
  { value: "じゃらん", label: "じゃらん" },
  { value: "楽天トラベル", label: "楽天トラベル" },
  { value: "一休", label: "一休" },
  { value: "東横イン", label: "東横イン" },
  { value: "ANA/JALツアー", label: "ANA/JALツアー" },
  { value: "その他", label: "その他" },
];

interface LineItem {
  id: string;
  service: string;
  detail: string;
  amount: string;
}

function newLineItem(): LineItem {
  return { id: crypto.randomUUID(), service: "スマートEX", detail: "", amount: "" };
}

function newAccommodationItem(): LineItem {
  return { id: crypto.randomUUID(), service: "じゃらん", detail: "", amount: "" };
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

export default function TripNewPage() {
  const user = useUser();
  const router = useRouter();

  // 基本情報
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [purpose, setPurpose] = useState("");

  // 交通費明細（複数行）
  const [transports, setTransports] = useState<LineItem[]>([newLineItem()]);

  // 宿泊費明細（複数行、0行も可）
  const [accommodations, setAccommodations] = useState<LineItem[]>([]);

  // PJコード
  const [projectCode, setProjectCode] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projects, setProjects] = useState<{ code: string; name: string }[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const [isEstimate, setIsEstimate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // AIアシスタント
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [bookingLinks, setBookingLinks] = useState<{ service: string; label: string; url: string; icon: string }[]>([]);
  const [aiApplied, setAiApplied] = useState(false);

  const handleAiAssist = async () => {
    if (!aiInput.trim() || aiLoading) return;
    setAiLoading(true);
    setAiSuggestion("");
    setBookingLinks([]);
    try {
      const res = await apiFetch("/api/trip/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: aiInput }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAiSuggestion(`エラー: ${data.error || "解析に失敗しました"}`);
        return;
      }
      const p = data.parsed;
      // フォームに自動入力
      if (p.destination) setDestination(p.destination);
      if (p.startDate) setStartDate(p.startDate);
      if (p.endDate) setEndDate(p.endDate);
      if (p.purpose) setPurpose(p.purpose);
      if (p.isEstimate) setIsEstimate(true);
      // 交通費明細
      if (p.transports?.length > 0) {
        setTransports(
          p.transports.map((t: { service: string; detail: string; estimatedAmount: number }) => ({
            id: crypto.randomUUID(),
            service: t.service || "スマートEX",
            detail: t.detail || "",
            amount: t.estimatedAmount ? String(t.estimatedAmount) : "",
          })),
        );
      }
      // 宿泊費明細
      if (p.accommodations?.length > 0) {
        setAccommodations(
          p.accommodations.map((a: { service: string; area: string; estimatedAmount: number }) => ({
            id: crypto.randomUUID(),
            service: a.service || "じゃらん",
            detail: a.area || "",
            amount: a.estimatedAmount ? String(a.estimatedAmount) : "",
          })),
        );
      }
      setAiSuggestion(data.suggestion || "フォームに入力しました。内容を確認して送信してください。");
      setBookingLinks(data.bookingLinks || []);
      setAiApplied(true);
    } catch (e) {
      setAiSuggestion(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  // PJマスタ取得
  useEffect(() => {
    apiFetch("/api/mf/masters")
      .then((r) => r.json())
      .then((d) => {
        if (d.projects) setProjects(d.projects);
      })
      .catch(() => {});
  }, []);

  // PJ検索候補（未入力=全件表示、1文字から絞り込み）
  const filteredProjects = useMemo(() => {
    if (!projectSearch) return projects;
    const q = projectSearch.toLowerCase();
    return projects.filter(
      (p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [projects, projectSearch]);

  // 明細操作ヘルパー
  const addTransport = () => setTransports((prev) => [...prev, newLineItem()]);
  const removeTransport = (id: string) =>
    setTransports((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev));
  const updateTransport = (id: string, field: keyof LineItem, value: string) =>
    setTransports((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));

  const addAccommodation = () => setAccommodations((prev) => [...prev, newAccommodationItem()]);
  const removeAccommodation = (id: string) =>
    setAccommodations((prev) => prev.filter((a) => a.id !== id));
  const updateAccommodation = (id: string, field: keyof LineItem, value: string) =>
    setAccommodations((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));

  // 合計計算
  const { nights, dailyAllowance, transportTotal, accommodationTotal, totalEstimate } = useMemo(() => {
    if (!startDate || !endDate) {
      return { nights: 0, dailyAllowance: 0, transportTotal: 0, accommodationTotal: 0, totalEstimate: 0 };
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const allowance = diffDays > 0 ? 3000 * (diffDays + 1) : 1000;
    const tTotal = transports.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const aTotal = accommodations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return {
      nights: diffDays,
      dailyAllowance: allowance,
      transportTotal: tTotal,
      accommodationTotal: aTotal,
      totalEstimate: tTotal + aTotal + allowance,
    };
  }, [startDate, endDate, transports, accommodations]);

  const canSubmit =
    destination &&
    startDate &&
    endDate &&
    purpose &&
    transports.some((t) => t.detail && Number(t.amount) > 0) &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const transportServices = transports.filter((t) => Number(t.amount) > 0).map((t) => t.service).join(" / ");
      const transportDetails = transports.filter((t) => t.detail).map((t) => `${t.service}: ${t.detail}`).join("\n");
      const accommodationServices = accommodations.filter((a) => Number(a.amount) > 0).map((a) => a.service).join(" / ");
      const accommodationPlaces = accommodations.filter((a) => a.detail).map((a) => a.detail).join(" / ");

      const res = await apiFetch("/api/trip/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          purpose,
          transportService: transportServices,
          transport: transportDetails,
          transportAmount: transportTotal,
          accommodationService: accommodationServices || undefined,
          accommodationPlace: accommodationPlaces || undefined,
          accommodationAmount: accommodationTotal > 0 ? accommodationTotal : undefined,
          hubspotDealId: projectCode || undefined,
          isEstimate,
          applicantSlackId: user.slackId,
          applicantName: user.name,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(`/purchase/${data.poNumber}`);
      } else {
        setError(data.error || "申請に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user.loaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-xl font-bold text-gray-800 mb-2">✈️ 出張予約完了申請</h1>
        <p className="text-sm text-gray-500 mb-6">
          先に予約を完了してから、実額で申請してください（事後承認）
        </p>

        {/* AIアシスタント */}
        <section className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200 p-5 mb-5">
          <h2 className="font-semibold text-purple-900 mb-2">🤖 AIアシスタント — まず予約してから申請</h2>
          <p className="text-xs text-purple-600 mb-3">出張の内容を入力 → 予約リンクで予約 → 実額をフォームに入力して申請</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing && handleAiAssist()}
              placeholder="例: 4/21朝9時頃 大阪出張 1泊 新幹線 翌日夕方戻り"
              className="flex-1 px-3 py-2 border border-purple-300 rounded-md text-sm focus:ring-2 focus:ring-purple-500"
              disabled={aiLoading}
            />
            <button
              type="button"
              onClick={handleAiAssist}
              disabled={aiLoading || !aiInput.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-md whitespace-nowrap"
            >
              {aiLoading ? "解析中..." : "AIで入力"}
            </button>
          </div>

          {aiSuggestion && (
            <div className={`mt-3 p-3 rounded-md text-sm ${aiSuggestion.startsWith("エラー") ? "bg-red-50 text-red-700" : "bg-white text-gray-700 border border-purple-100"}`}>
              {aiSuggestion}
            </div>
          )}

          {bookingLinks.length > 0 && (
            <div className="mt-3 p-3 bg-white rounded-md border border-purple-100">
              <p className="text-xs font-medium text-purple-800 mb-2">🔗 まず予約してください（予約後に実額を下のフォームに入力）</p>
              <div className="space-y-1">
                {bookingLinks.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <span>{link.icon}</span>
                    <span className="font-medium">{link.service}</span>
                    <span className="text-gray-500">{link.label}</span>
                    <span className="text-xs text-gray-400 ml-auto">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {aiApplied && (
            <p className="mt-2 text-xs text-green-600">✅ フォームに概算入力しました。予約リンクで予約後、実額に修正して送信してください。</p>
          )}
        </section>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 基本情報 */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-800 mb-4">基本情報</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  行き先 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="大阪本社 / 福岡支社 など"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">出発日 <span className="text-red-500">*</span></label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">帰着日 <span className="text-red-500">*</span></label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">出張目的 <span className="text-red-500">*</span></label>
                <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: クライアントA社との打合せおよび現地調査" rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" required />
              </div>
            </div>
          </section>

          {/* 交通費（複数行） */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">🚄 交通費</h2>
              <button type="button" onClick={addTransport} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 行を追加</button>
            </div>
            <div className="space-y-3">
              {transports.map((t, i) => (
                <div key={t.id} className="p-3 bg-gray-50 rounded-md space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                    <select
                      value={t.service}
                      onChange={(e) => updateTransport(t.id, "service", e.target.value)}
                      className="flex-shrink-0 px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {TRANSPORT_SERVICES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    {transports.length > 1 && (
                      <button type="button" onClick={() => removeTransport(t.id)} className="text-xs text-red-400 hover:text-red-600 ml-auto">削除</button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={t.detail}
                    onChange={(e) => updateTransport(t.id, "detail", e.target.value)}
                    placeholder="のぞみXX号 東京→新大阪 / ANA123便 羽田→福岡"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">金額（円）</span>
                    <input
                      type="number"
                      value={t.amount}
                      onChange={(e) => updateTransport(t.id, "amount", e.target.value)}
                      placeholder="14000"
                      min="0"
                      className="w-32 px-3 py-1.5 border border-gray-300 rounded text-sm text-right"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 宿泊費（複数行、任意） */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">🏨 宿泊費（任意）</h2>
              <button type="button" onClick={addAccommodation} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ 行を追加</button>
            </div>
            {accommodations.length === 0 ? (
              <p className="text-xs text-gray-400">宿泊がある場合は「+ 行を追加」で入力してください</p>
            ) : (
              <div className="space-y-3">
                {accommodations.map((a, i) => (
                  <div key={a.id} className="p-3 bg-gray-50 rounded-md space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                      <select
                        value={a.service}
                        onChange={(e) => updateAccommodation(a.id, "service", e.target.value)}
                        className="flex-shrink-0 px-2 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        {ACCOMMODATION_SERVICES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeAccommodation(a.id)} className="text-xs text-red-400 hover:text-red-600 ml-auto">削除</button>
                    </div>
                    <input
                      type="text"
                      value={a.detail}
                      onChange={(e) => updateAccommodation(a.id, "detail", e.target.value)}
                      placeholder="ホテル名 / 所在地"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">金額（円）</span>
                      <input
                        type="number"
                        value={a.amount}
                        onChange={(e) => updateAccommodation(a.id, "amount", e.target.value)}
                        placeholder="15000"
                        min="0"
                        className="w-32 px-3 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* PJ・オプション */}
          <section className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-800 mb-4">追加情報（任意）</h2>
            <div className="space-y-4">
              {/* PJコード検索 */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">プロジェクト（PJコード）</label>
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => {
                    setProjectSearch(e.target.value);
                    setShowProjectDropdown(true);
                  }}
                  onFocus={() => setShowProjectDropdown(true)}
                  placeholder="PJコードまたは名前で検索..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                {projectCode && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{projectCode}</span>
                    <button type="button" onClick={() => { setProjectCode(""); setProjectSearch(""); }} className="text-xs text-red-400">クリア</button>
                  </div>
                )}
                {showProjectDropdown && filteredProjects.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filteredProjects.map((p) => (
                      <li
                        key={p.code}
                        onClick={() => {
                          setProjectCode(p.code);
                          setProjectSearch(`${p.code} ${p.name}`);
                          setShowProjectDropdown(false);
                        }}
                        className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                      >
                        <span className="font-mono text-blue-600">{p.code}</span>
                        <span className="text-gray-600 ml-2">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={isEstimate} onChange={(e) => setIsEstimate(e.target.checked)} className="rounded" />
                <span>金額が未確定（予約前の概算申請の場合のみチェック）</span>
              </label>
            </div>
          </section>

          {/* 合計見込 */}
          <section className="bg-blue-50 rounded-lg border border-blue-200 p-5">
            <h2 className="font-semibold text-blue-900 mb-3">💰 合計見込</h2>
            <div className="space-y-2 text-sm">
              {transports.filter((t) => Number(t.amount) > 0).map((t) => (
                <div key={t.id} className="flex justify-between">
                  <span className="text-gray-600">🚄 {t.service}{t.detail ? ` (${t.detail.slice(0, 20)})` : ""}</span>
                  <span className="font-medium">{formatYen(Number(t.amount))}</span>
                </div>
              ))}
              {accommodations.filter((a) => Number(a.amount) > 0).map((a) => (
                <div key={a.id} className="flex justify-between">
                  <span className="text-gray-600">🏨 {a.service}{a.detail ? ` (${a.detail.slice(0, 20)})` : ""}</span>
                  <span className="font-medium">{formatYen(Number(a.amount))}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-gray-600">
                  日当（{nights > 0 ? `${nights}泊${nights + 1}日 × ¥3,000` : startDate ? "日帰り ¥1,000" : "日程未入力"}）
                </span>
                <span className="font-medium">{formatYen(dailyAllowance)}</span>
              </div>
              <div className="border-t border-blue-300 pt-2 flex justify-between">
                <span className="font-semibold text-blue-900">合計</span>
                <span className="font-bold text-blue-900 text-lg">{formatYen(totalEstimate)}</span>
              </div>
            </div>
          </section>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md">{error}</div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-md transition-colors"
          >
            {submitting ? "申請中..." : "予約完了申請を送信"}
          </button>
        </form>
      </div>
    </div>
  );
}

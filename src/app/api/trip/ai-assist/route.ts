import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.0-flash";

/**
 * 出張AIアシスタント
 * POST /api/trip/ai-assist
 *
 * 自然言語の出張意図から構造化データを抽出し、予約リンクを生成する。
 *
 * Body: { message: string }
 * Returns: { parsed: TripParsed, bookingLinks: BookingLink[], suggestion: string }
 */

interface TripParsed {
  destination: string;
  destinationPrefCode: string; // 都道府県コード (じゃらん/楽天用)
  startDate: string;           // YYYY-MM-DD
  endDate: string;             // YYYY-MM-DD
  nights: number;
  purpose: string;
  transports: {
    service: string;           // スマートEX / えきねっと / ANA / JAL等
    detail: string;            // 便名・区間
    estimatedAmount: number;
    departureStation?: string;
    arrivalStation?: string;
    departureHour?: number;    // 出発希望時刻 (0-23)
    departureMinute?: number;  // 出発希望分 (0-59)
  }[];
  accommodations: {
    service: string;
    area: string;
    estimatedAmount: number;
  }[];
  isEstimate: boolean;
}

interface BookingLink {
  service: string;
  label: string;
  url: string;
  icon: string;
}

// 都道府県コード(じゃらん用)
const PREF_CODES: Record<string, string> = {
  "北海道": "010000", "青森": "020000", "岩手": "030000", "宮城": "040000",
  "秋田": "050000", "山形": "060000", "福島": "070000", "茨城": "080000",
  "栃木": "090000", "群馬": "100000", "埼玉": "110000", "千葉": "120000",
  "東京": "130000", "神奈川": "140000", "新潟": "150000", "富山": "160000",
  "石川": "170000", "福井": "180000", "山梨": "190000", "長野": "200000",
  "岐阜": "210000", "静岡": "220000", "愛知": "230000", "三重": "240000",
  "滋賀": "250000", "京都": "260000", "大阪": "270000", "兵庫": "280000",
  "奈良": "290000", "和歌山": "300000", "鳥取": "310000", "島根": "320000",
  "岡山": "330000", "広島": "340000", "山口": "350000", "徳島": "360000",
  "香川": "370000", "愛媛": "380000", "高知": "390000", "福岡": "400000",
  "佐賀": "410000", "長崎": "420000", "熊本": "430000", "大分": "440000",
  "宮崎": "450000", "鹿児島": "460000", "沖縄": "470000",
};

// 楽天用都道府県コード
const RAKUTEN_PREF_CODES: Record<string, string> = {
  "北海道": "01", "青森": "02", "岩手": "03", "宮城": "04",
  "秋田": "05", "山形": "06", "福島": "07", "茨城": "08",
  "栃木": "09", "群馬": "10", "埼玉": "11", "千葉": "12",
  "東京": "13", "神奈川": "14", "新潟": "15", "富山": "16",
  "石川": "17", "福井": "18", "山梨": "19", "長野": "20",
  "岐阜": "21", "静岡": "22", "愛知": "23", "三重": "24",
  "滋賀": "25", "京都": "26", "大阪": "27", "兵庫": "28",
  "奈良": "29", "和歌山": "30", "鳥取": "31", "島根": "32",
  "岡山": "33", "広島": "34", "山口": "35", "徳島": "36",
  "香川": "37", "愛媛": "38", "高知": "39", "福岡": "40",
  "佐賀": "41", "長崎": "42", "熊本": "43", "大分": "44",
  "宮崎": "45", "鹿児島": "46", "沖縄": "47",
};

function resolvePrefCode(destination: string): { jalan: string; rakuten: string } {
  for (const [pref, code] of Object.entries(PREF_CODES)) {
    if (destination.includes(pref)) {
      return { jalan: code, rakuten: RAKUTEN_PREF_CODES[pref] || "" };
    }
  }
  // 主要都市→都道府県マッピング
  const cityToPref: Record<string, string> = {
    "札幌": "北海道", "仙台": "宮城", "さいたま": "埼玉", "横浜": "神奈川",
    "名古屋": "愛知", "金沢": "石川", "新大阪": "大阪", "梅田": "大阪",
    "難波": "大阪", "神戸": "兵庫", "博多": "福岡", "天神": "福岡",
    "那覇": "沖縄", "広島": "広島", "岡山": "岡山",
  };
  for (const [city, pref] of Object.entries(cityToPref)) {
    if (destination.includes(city)) {
      return { jalan: PREF_CODES[pref] || "", rakuten: RAKUTEN_PREF_CODES[pref] || "" };
    }
  }
  return { jalan: "", rakuten: "" };
}

function generateBookingLinks(parsed: TripParsed): BookingLink[] {
  const links: BookingLink[] = [];
  const d = new Date(parsed.startDate);
  const d2 = new Date(parsed.endDate);
  const prefCodes = resolvePrefCode(parsed.destination);

  // 宿泊リンク（日帰りでなければ）
  if (parsed.nights > 0) {
    // じゃらん — 都道府県ページ + 日付パラメータ
    if (prefCodes.jalan) {
      const jalanUrl = `https://www.jalan.net/${prefCodes.jalan}/` +
        `?stayYear=${d.getFullYear()}&stayMonth=${d.getMonth() + 1}&stayDay=${d.getDate()}` +
        `&stayCount=${parsed.nights}&roomCount=1&adultNum=1&dateUndecided=0`;
      links.push({ service: "じゃらん", label: `${parsed.destination} ${parsed.startDate} ${parsed.nights}泊`, url: jalanUrl, icon: "🏨" });
    }

    // 楽天トラベル — キーワード検索 + 日付パラメータ
    const rakutenUrl = `https://travel.rakuten.co.jp/yado/list.html` +
      `?f_cd=${prefCodes.rakuten || ""}` +
      `&f_nen1=${d.getFullYear()}&f_tuki1=${d.getMonth() + 1}&f_hi1=${d.getDate()}` +
      `&f_nen2=${d2.getFullYear()}&f_tuki2=${d2.getMonth() + 1}&f_hi2=${d2.getDate()}` +
      `&f_otona_su=1&f_heya_su=1&f_hak=${parsed.nights}`;
    links.push({ service: "楽天トラベル", label: `${parsed.destination} ${parsed.startDate} ${parsed.nights}泊`, url: rakutenUrl, icon: "🏨" });
  }

  // 交通リンク — Yahoo路線/Googleマップで具体的な便候補を表示
  for (const t of parsed.transports) {
    const from = t.departureStation || "";
    const to = t.arrivalStation || "";
    const travelDate = new Date(parsed.startDate);
    // 復路の場合は endDate を使用
    const isReturn = from && to && parsed.transports.indexOf(t) > 0;
    const dateForLink = isReturn ? new Date(parsed.endDate) : travelDate;

    // Yahoo路線検索リンク（便候補一覧が表示される。EX予約連携あり）
    if (from && to) {
      const hh = String(t.departureHour ?? 8).padStart(2, "0");
      const mm = String(t.departureMinute ?? 0).padStart(2, "0");
      const timeLabel = `${hh}:${mm}頃発`;
      const yahooUrl = `https://transit.yahoo.co.jp/search/result` +
        `?from=${encodeURIComponent(from)}` +
        `&to=${encodeURIComponent(to)}` +
        `&y=${dateForLink.getFullYear()}` +
        `&m=${String(dateForLink.getMonth() + 1).padStart(2, "0")}` +
        `&d=${String(dateForLink.getDate()).padStart(2, "0")}` +
        `&hh=${hh}&mm=${mm}&type=1&ticket=ic`;
      links.push({
        service: "Yahoo路線",
        label: `${from}→${to} ${dateForLink.toLocaleDateString("ja-JP")} ${timeLabel}`,
        url: yahooUrl,
        icon: "🔍",
      });
    }

    // Googleマップ経路検索
    if (from && to) {
      const gmapUrl = `https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
      links.push({
        service: "Googleマップ",
        label: `${from}→${to} 経路`,
        url: gmapUrl,
        icon: "🗺️",
      });
    }

    // 各予約サービスへの直接リンクも追加
    switch (t.service) {
      case "スマートEX":
        links.push({ service: "スマートEX", label: `ログインして予約`, url: "https://smart-ex.jp/", icon: "🚄" });
        break;
      case "えきねっと":
        links.push({ service: "えきねっと", label: `ログインして予約`, url: "https://www.eki-net.com/Personal/reserve/wb/RouteSearchConditionInput/Index", icon: "🚃" });
        break;
      case "ANA":
        links.push({ service: "ANA", label: `国内線予約`, url: "https://www.ana.co.jp/ja/jp/book-plan/domestic/", icon: "✈️" });
        break;
      case "JAL":
        links.push({ service: "JAL", label: `国内線予約`, url: "https://www.jal.co.jp/jp/ja/dom/", icon: "✈️" });
        break;
      case "トヨタレンタカー":
        links.push({ service: "トヨタレンタカー", label: "予約", url: "https://rent.toyota.co.jp/", icon: "🚗" });
        break;
      case "タイムズカー":
        links.push({ service: "タイムズカー", label: "予約", url: "https://rental.timescar.jp/", icon: "🚗" });
        break;
    }
  }

  return links;
}

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { message } = await request.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const prompt = `あなたは出張予約アシスタントです。以下のユーザーメッセージから出張情報を抽出してJSONで返してください。

今日の日付: ${today}

ユーザーメッセージ: "${message}"

以下のJSON形式で返してください（JSON以外のテキストは不要）:
{
  "destination": "行き先（都市名や拠点名）",
  "destinationPref": "都道府県名（例: 大阪）",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "nights": 泊数（数値）,
  "purpose": "推定される目的（不明なら空文字）",
  "transports": [
    {
      "service": "スマートEX or えきねっと or ANA or JAL or トヨタレンタカー or タイムズカー or その他",
      "detail": "具体的な便名・区間（例: のぞみ 東京→新大阪）",
      "estimatedAmount": 概算金額（円、数値）,
      "departureStation": "出発駅/空港（例: 東京駅, 羽田空港）",
      "arrivalStation": "到着駅/空港（例: 新大阪駅, 伊丹空港）",
      "departureHour": 出発希望時刻の時（0-23の数値、不明なら8）,
      "departureMinute": 出発希望時刻の分（0-59の数値、不明なら0）
    }
  ],
  "accommodations": [
    {
      "service": "じゃらん or 楽天トラベル or 一休 or 東横イン or その他",
      "area": "宿泊エリア",
      "estimatedAmount": 概算金額（円、数値）
    }
  ],
  "isEstimate": true,
  "suggestion": "ユーザーへの一言アドバイス（早割情報、おすすめ便、注意事項等。時刻に言及があればその前後の便候補を提案）"
}

注意:
- ユーザーが「朝」「午前」「9時頃」「夕方」「18時」等の時間帯を指定した場合は departureHour/departureMinute に反映
  - 「朝」→ 7-8時、「午前」→ 9-10時、「昼」→ 12時、「午後」→ 13-14時、「夕方」→ 16-17時、「夜」→ 19-20時
  - 「XX時頃」→ そのまま反映
- 往復の場合、復路の時間帯も考慮（「翌日夕方」→ 復路のdepartureHour=17等）
- 東京-大阪 新幹線のぞみ指定席は片道約¥14,000（EX早特だと¥11,000前後）
- 東京-福岡 新幹線のぞみは片道約¥23,000、飛行機は¥15,000-30,000
- 東京-名古屋 新幹線のぞみは片道約¥11,000
- 東京-仙台 新幹線はやぶさは片道約¥11,000
- 東京-広島 新幹線のぞみは片道約¥19,000
- 宿泊は一般ビジネスホテル1泊¥7,000-12,000が目安
- 往復の場合はtransportsに2件（往路+復路）入れてください
- 宿泊ありの場合はaccommodationsに1件以上入れてください
- 交通手段の指定がなければ一般的な手段を推定してください
- サービス名は必ず上記の選択肢から選んでください
- 東海道新幹線(東京-名古屋-京都-新大阪)はスマートEX、東北/上越/北陸新幹線はえきねっと`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json({ error: `Gemini API error: ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // JSON部分を抽出（マークダウンコードブロック対応）
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答をパースできませんでした", raw: rawText }, { status: 500 });
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as TripParsed & { suggestion?: string; destinationPref?: string };

    // 予約リンク生成
    const bookingLinks = generateBookingLinks(parsed);

    return NextResponse.json({
      ok: true,
      parsed: {
        destination: parsed.destination || "",
        startDate: parsed.startDate || "",
        endDate: parsed.endDate || "",
        nights: parsed.nights || 0,
        purpose: parsed.purpose || "",
        transports: parsed.transports || [],
        accommodations: parsed.accommodations || [],
        isEstimate: parsed.isEstimate ?? true,
      },
      bookingLinks,
      suggestion: parsed.suggestion || "",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

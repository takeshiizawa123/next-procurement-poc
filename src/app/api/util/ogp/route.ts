import { NextRequest, NextResponse } from "next/server";

/**
 * OGP/メタタグ取得API
 * GET /api/util/ogp?url=https://www.amazon.co.jp/dp/xxx
 *
 * Amazon等の商品ページから品目名・価格を抽出する
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  // URLバリデーション
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // 許可ドメインチェック（SSRF防止）
  const allowedDomains = [
    "amazon.co.jp",
    "www.amazon.co.jp",
    "amazon.com",
    "www.amazon.com",
    "monotaro.com",
    "www.monotaro.com",
    "askul.co.jp",
    "www.askul.co.jp",
    "yodobashi.com",
    "www.yodobashi.com",
    "biccamera.com",
    "www.biccamera.com",
  ];

  if (!allowedDomains.includes(parsed.hostname)) {
    return NextResponse.json(
      { error: "このドメインには対応していません", supported: allowedDomains },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    let html: string;

    if (!res.ok) {
      // ブロックされた場合、ScraperAPI でリトライ
      const scraperHtml = await fetchViaScraperApi(url);
      if (scraperHtml) {
        html = scraperHtml;
      } else {
        // ScraperAPIも失敗 → URLスラッグからフォールバック
        if (parsed.hostname.includes("amazon")) {
          const asin = extractAsin(url);
          const slugTitle = extractAmazonSlugTitle(url);
          return NextResponse.json({
            title: slugTitle,
            price: null,
            image: "",
            siteName: "Amazon",
            url,
            note: slugTitle
              ? "URLから品名を取得しました。金額は手動で入力してください。"
              : "商品情報を取得できませんでした。",
            asin,
          });
        }
        return NextResponse.json(
          { error: `Failed to fetch: ${res.status}` },
          { status: 502 },
        );
      }
    } else {
      html = await res.text();
    }

    // メタタグ抽出
    let title = extractMeta(html, "og:title") || extractTitle(html) || "";
    let price = extractPrice(html, parsed.hostname);
    const image = extractMeta(html, "og:image") || "";
    const siteName = extractMeta(html, "og:site_name") || guessSiteName(parsed.hostname);

    // Amazon: ScraperAPIで再取得が必要なケースを判定
    // - タイトルが汎用的（Amazon.co.jp のみ）
    // - 価格なし
    // - 価格が不自然に低い（1000円未満 = レビュー数等の誤取得の可能性）
    const needsScraperRetry = parsed.hostname.includes("amazon") && (
      (!title || /^Amazon[\s.]*co[\s.]*jp/i.test(title.trim())) ||
      !price ||
      (price !== null && price < 1000)
    );
    if (needsScraperRetry) {
      console.log("[ogp] Amazon data insufficient (price:", price, "), trying ScraperAPI...");
      const scraperHtml = await fetchViaScraperApi(url);
      if (scraperHtml) {
        const scraperTitle = extractMeta(scraperHtml, "og:title") || extractTitle(scraperHtml) || "";
        const scraperPrice = extractPrice(scraperHtml, parsed.hostname);
        if (scraperTitle) title = scraperTitle;
        if (scraperPrice !== null && scraperPrice >= 1000) price = scraperPrice;
      }
    }

    return NextResponse.json({
      title: cleanTitle(title),
      price,
      image,
      siteName,
      url,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ogp] fetch error:", msg);
    return NextResponse.json({ error: "ページの取得に失敗しました" }, { status: 502 });
  }
}

// --- ScraperAPI フォールバック ---

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "";

async function fetchViaScraperApi(targetUrl: string): Promise<string | null> {
  if (!SCRAPER_API_KEY) {
    console.warn("[ogp] SCRAPER_API_KEY is not set. Skipping scraper fallback.");
    return null;
  }

  const apiUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`;

  try {
    console.log("[ogp] ScraperAPI fallback for:", targetUrl.substring(0, 80));
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[ogp] ScraperAPI returned ${res.status}`);
      return null;
    }

    const html = await res.text();
    console.log(`[ogp] ScraperAPI success: ${html.length} bytes`);
    return html;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ogp] ScraperAPI error:", msg);
    return null;
  }
}

// --- ヘルパー ---

function extractMeta(html: string, property: string): string {
  // og:xxx or name="xxx"
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHTMLEntities(m[1]);
  }
  return "";
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHTMLEntities(m[1].trim()) : "";
}

function extractPrice(html: string, hostname: string): number | null {
  // Amazon
  if (hostname.includes("amazon")) {
    const candidates: number[] = [];

    const patterns = [
      // corePriceDisplay 内の価格（最も信頼性が高い）
      /id="corePrice[^"]*"[\s\S]{0,500}?class="a-price-whole"[^>]*>([0-9,]+)/,
      /id="corePrice[^"]*"[\s\S]{0,500}?class="a-offscreen"[^>]*>￥([0-9,]+)/,
      // JSON内の価格データ
      /"priceAmount"\s*:\s*"?([0-9,]+(?:\.[0-9]+)?)"?/,
      // 従来のpriceblock
      /id="priceblock_ourprice"[^>]*>[^0-9]*([0-9,]+)/,
      /id="priceblock_dealprice"[^>]*>[^0-9]*([0-9,]+)/,
      // a-price-whole（汎用）
      /class="a-price-whole"[^>]*>([0-9,]+)/,
    ];

    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const price = parseInt(m[1].replace(/,/g, "").replace(/\.\d+$/, ""), 10);
        // 100円以上かつ1億未満の妥当な価格のみ採用
        if (price >= 100 && price < 100000000) {
          candidates.push(price);
        }
      }
    }

    // 候補の中から最も高い価格を採用（送料等の低い値を避ける）
    if (candidates.length > 0) {
      return Math.max(...candidates);
    }
  }

  // モノタロウ
  if (hostname.includes("monotaro")) {
    // 販売価格パターン
    const patterns = [
      /class="[^"]*ProductPrice[^"]*"[^>]*>[^0-9]*([0-9,]+)/i,
      /class="[^"]*selling-price[^"]*"[^>]*>[^0-9]*([0-9,]+)/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const price = parseInt(m[1].replace(/,/g, ""), 10);
        if (price >= 10) return price;
      }
    }
  }

  // 汎用: 価格っぽいパターン
  const pricePatterns = [
    /["']price["'][^>]*content=["']([0-9,]+(?:\.[0-9]+)?)["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9,]+(?:\.[0-9]+)?)["']/i,
  ];
  for (const re of pricePatterns) {
    const m = html.match(re);
    if (m) {
      const price = parseInt(m[1].replace(/,/g, ""), 10);
      if (price >= 10 && price < 100000000) return price;
    }
  }

  return null;
}

function cleanTitle(title: string): string {
  let t = title;

  // Amazon: 先頭の "Amazon.co.jp: " or "Amazon.co.jp： "
  t = t.replace(/^Amazon[\s.]*co[\s.]*jp\s*[:：]\s*/i, "");

  // Amazon: 末尾の " : カテゴリ名" (最後の : 以降を除去)
  t = t.replace(/\s*[:：]\s*(?:パソコン|家電|ホーム|キッチン|DIY|文房具|オフィス|産業|スポーツ|ゲーム|ペット|ビューティー|ドラッグストア|食品|ファッション|シューズ|ベビー|おもちゃ|本|ミュージック|DVD|ソフトウェア|車|バイク).*$/i, "");

  // 他サイト: "| サイト名" or "- サイト名"
  t = t.replace(/\s*[\|｜\-]\s*Amazon\.co\.jp.*$/i, "");
  t = t.replace(/\s*[\|｜]\s*モノタロウ.*$/i, "");
  t = t.replace(/\s*【通販モノタロウ】.*$/i, "");
  t = t.replace(/\s*[\|｜]\s*アスクル.*$/i, "");
  t = t.replace(/\s*[\|｜]\s*ヨドバシ\.com.*$/i, "");
  t = t.replace(/\s*[\|｜]\s*ビックカメラ.*$/i, "");

  return t.trim();
}

function guessSiteName(hostname: string): string {
  if (hostname.includes("amazon")) return "Amazon";
  if (hostname.includes("monotaro")) return "モノタロウ";
  if (hostname.includes("askul")) return "ASKUL";
  if (hostname.includes("yodobashi")) return "ヨドバシ.com";
  if (hostname.includes("biccamera")) return "ビックカメラ";
  return hostname;
}

function extractAsin(url: string): string {
  const m = url.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})/i);
  return m ? m[1] : "";
}

/**
 * AmazonのURLスラッグから商品名を抽出
 * 例: /HP-IPSディスプレイ-グレイシャーシルバー-Copilotキー搭載-型番：BF8H3PA-AAAA/dp/B0F6MHTQ36/
 *   → "HP IPSディスプレイ グレイシャーシルバー Copilotキー搭載 型番：BF8H3PA-AAAA"
 */
function extractAmazonSlugTitle(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    // /slug/dp/ASIN パターンからスラッグ部分を取得
    const m = path.match(/^\/([^/]+)\/dp\//);
    if (!m) return "";

    return m[1]
      .replace(/-/g, " ")  // ハイフンをスペースに
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

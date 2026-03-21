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

    if (!res.ok) {
      // Amazon等でブロックされた場合、URLからASINを抽出して最低限の情報を返す
      if (parsed.hostname.includes("amazon")) {
        const asin = extractAsin(url);
        return NextResponse.json({
          title: "",
          price: null,
          image: "",
          siteName: "Amazon",
          url,
          note: "商品情報を自動取得できませんでした。品目名と金額を手動で入力してください。",
          asin,
        });
      }
      return NextResponse.json(
        { error: `Failed to fetch: ${res.status}` },
        { status: 502 },
      );
    }

    const html = await res.text();

    // メタタグ抽出
    const title = extractMeta(html, "og:title") || extractTitle(html) || "";
    const price = extractPrice(html, parsed.hostname);
    const image = extractMeta(html, "og:image") || "";
    const siteName = extractMeta(html, "og:site_name") || guessSiteName(parsed.hostname);

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
    // priceblock_ourprice, corePriceDisplay, a-price-whole
    const patterns = [
      /class="a-price-whole"[^>]*>([0-9,]+)/,
      /"priceAmount":"?([0-9,]+(?:\.[0-9]+)?)"?/,
      /id="priceblock_ourprice"[^>]*>[^0-9]*([0-9,]+)/,
      /id="priceblock_dealprice"[^>]*>[^0-9]*([0-9,]+)/,
      /class="a-offscreen"[^>]*>￥?([0-9,]+)/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const price = parseInt(m[1].replace(/,/g, ""), 10);
        if (price > 0 && price < 100000000) return price;
      }
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
  return title
    .replace(/\s*[\|｜\-]\s*Amazon\.co\.jp.*$/i, "")
    .replace(/\s*[\|｜]\s*モノタロウ.*$/i, "")
    .replace(/\s*【通販モノタロウ】.*$/i, "")
    .replace(/\s*[\|｜]\s*アスクル.*$/i, "")
    .replace(/\s*[\|｜]\s*ヨドバシ\.com.*$/i, "")
    .replace(/\s*[\|｜]\s*ビックカメラ.*$/i, "")
    .trim();
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

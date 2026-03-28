import { NextRequest, NextResponse } from "next/server";

const KATANA_API_KEY = process.env.KATANA_API_KEY || "";
const KATANA_BASE_URL = "https://api.katanamrp.com/v1";

interface KatanaPO {
  id: number;
  po_number: string;
  supplier_name: string;
  status: string;
  created_at: string;
  total: number;
  currency_code: string;
}

/**
 * KATANA購買注文一覧（サジェスト用）
 * GET /api/katana/purchase-orders?q=PO-123
 */
export async function GET(request: NextRequest) {
  if (!KATANA_API_KEY) {
    return NextResponse.json({ orders: [], error: "KATANA_API_KEY not configured" });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";

  try {
    const res = await fetch(`${KATANA_BASE_URL}/purchase_orders?limit=50`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${KATANA_API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[katana] API error:", res.status, text.substring(0, 200));
      return NextResponse.json({ orders: [], error: `KATANA API error: ${res.status}` });
    }

    const data = await res.json();
    const rawOrders: KatanaPO[] = Array.isArray(data) ? data : data.data || data.results || [];

    // サジェスト用にフィルタ・整形
    const orders = rawOrders
      .filter((o) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          (o.po_number || "").toLowerCase().includes(q) ||
          (o.supplier_name || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 20)
      .map((o) => ({
        id: o.id,
        poNumber: o.po_number || String(o.id),
        supplierName: o.supplier_name || "",
        status: o.status || "",
        createdAt: o.created_at || "",
        total: o.total || 0,
        currency: o.currency_code || "JPY",
      }));

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("[katana] Error:", error);
    return NextResponse.json({ orders: [], error: "Failed to fetch KATANA orders" });
  }
}

"use client";

import { ReactNode, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, signOut } from "next-auth/react";
import { UserProvider, useUser } from "@/lib/user-context";

function Nav() {
  const user = useUser();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const links = [
    { href: "/dashboard", label: "ダッシュボード" },
    { href: "/purchase/new", label: "購買申請" },
    { href: "/trip/new", label: "出張予約" },
    { href: "/expense/new", label: "立替精算" },
    { href: "/purchase/my", label: "マイ申請" },
  ];

  // クライアント側でマウント後のみ管理メニュー表示（hydration mismatch回避）
  if (mounted && user.isAdmin) {
    links.push(
      { href: "/admin/journals", label: "仕訳管理" },
      { href: "/admin/card-matching", label: "カード照合" },
      { href: "/admin/trip-controls", label: "出張統制" },
      { href: "/admin/approval-routes", label: "承認設定" },
      { href: "/admin/contracts", label: "契約管理" },
      { href: "/admin/notion-sync", label: "Notion" },
    );
  }

  return (
    <nav className="bg-white border-b sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center h-12 gap-1 overflow-x-auto">
        <a href="/" className="font-bold text-sm text-gray-800 mr-4 shrink-0">購買管理</a>
        {links.map((l) => {
          const isActive = pathname === l.href || (l.href !== "/dashboard" && pathname.startsWith(l.href));
          return (
            <a key={l.href} href={l.href} className={`text-xs px-3 py-1.5 rounded-lg whitespace-nowrap ${isActive ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`} aria-current={isActive ? "page" : undefined}>
              {l.label}
            </a>
          );
        })}
        {mounted && user.loaded && user.name && (
          <span className="ml-auto text-xs text-gray-400 shrink-0 flex items-center gap-2">
            {user.name}{user.isAdmin ? "（管理本部）" : ""}
            <button onClick={() => signOut({ callbackUrl: "/auth/signin" })} className="text-gray-400 hover:text-red-500 transition-colors" title="ログアウト">
              ログアウト
            </button>
          </span>
        )}
      </div>
    </nav>
  );
}

export function LayoutClient({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <UserProvider>
        <Nav />
        {children}
      </UserProvider>
    </SessionProvider>
  );
}

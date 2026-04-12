"use client";

import { ReactNode, useState, useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { UserProvider, useUser } from "@/lib/user-context";

function Nav() {
  const user = useUser();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const links = [
    { href: "/dashboard", label: "ダッシュボード" },
    { href: "/purchase/new", label: "購買申請" },
    { href: "/trip/new", label: "出張予約" },
    { href: "/purchase/my", label: "マイ申請" },
  ];

  // クライアント側でマウント後のみ管理メニュー表示（hydration mismatch回避）
  if (mounted && user.isAdmin) {
    links.push(
      { href: "/admin/journals", label: "仕訳管理" },
      { href: "/admin/card-matching", label: "カード照合" },
      { href: "/admin/trip-controls", label: "出張統制" },
      { href: "/admin/approval-routes", label: "承認設定" },
    );
  }

  return (
    <nav className="bg-white border-b sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center h-12 gap-1 overflow-x-auto">
        <a href="/" className="font-bold text-sm text-gray-800 mr-4 shrink-0">購買管理</a>
        {links.map((l) => (
          <a key={l.href} href={l.href} className="text-xs px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap">
            {l.label}
          </a>
        ))}
        {mounted && user.loaded && user.name && (
          <span className="ml-auto text-xs text-gray-400 shrink-0">
            {user.name}{user.isAdmin ? "（管理本部）" : ""}
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

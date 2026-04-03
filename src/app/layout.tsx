import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "購買管理システム",
  description: "購買申請・承認フロー管理",
};

function Nav() {
  const links = [
    { href: "/dashboard", label: "ダッシュボード" },
    { href: "/purchase/new", label: "新規申請" },
    { href: "/purchase/my", label: "マイ申請" },
    { href: "/admin/journals", label: "仕訳管理" },
    { href: "/admin/card-matching", label: "カード照合" },
  ];
  return (
    <nav className="bg-white border-b sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center h-12 gap-1 overflow-x-auto">
        <a href="/" className="font-bold text-sm text-gray-800 mr-4 shrink-0">購買管理</a>
        {links.map((l) => (
          <a key={l.href} href={l.href} className="text-xs px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap">
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
      </body>
    </html>
  );
}

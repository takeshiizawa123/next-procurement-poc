"use client";

import { useState } from "react";

/**
 * Bookmarklet配布ページ
 * /bookmarklet でアクセス
 */

// インライン方式（CSPで外部スクリプトがブロックされるため）
const BOOKMARKLET_HREF = "javascript:void(function(){var h=location.hostname,t='',p='',s='',u=location.href;if(h.indexOf('amazon')>=0){s='Amazon';var e=document.getElementById('productTitle');if(e)t=e.innerText.trim();var q=document.querySelector('.a-price .a-offscreen');if(q)p=q.innerText.replace(/[^0-9]/g,'');if(!p){q=document.querySelector('.a-price-whole');if(q)p=q.innerText.replace(/[^0-9]/g,'')}}else if(h.indexOf('monotaro')>=0){s='%E3%83%A2%E3%83%8E%E3%82%BF%E3%83%AD%E3%82%A6';var h1=document.querySelector('h1');if(h1)t=h1.innerText.trim();q=document.querySelector('[class*=ProductPrice],[class*=selling-price]');if(q)p=q.innerText.replace(/[^0-9]/g,'')}else if(h.indexOf('askul')>=0){s='ASKUL';h1=document.querySelector('h1');if(h1)t=h1.innerText.trim();q=document.querySelector('[class*=price]');if(q)p=q.innerText.replace(/[^0-9]/g,'')}else if(h.indexOf('yodobashi')>=0){s='%E3%83%A8%E3%83%89%E3%83%90%E3%82%B7.com';h1=document.querySelector('h1');if(h1)t=h1.innerText.trim()}else if(h.indexOf('biccamera')>=0){s='%E3%83%93%E3%83%83%E3%82%AF%E3%82%AB%E3%83%A1%E3%83%A9';h1=document.querySelector('h1');if(h1)t=h1.innerText.trim()}else{s=h.replace('www.','');t=document.title}var uid=localStorage.getItem('proc_uid');if(!uid){uid=prompt('Slack User ID%E3%82%92%E5%85%A5%E5%8A%9B%EF%BC%88%E5%88%9D%E5%9B%9E%E3%81%AE%E3%81%BF%EF%BC%89');if(uid)localStorage.setItem('proc_uid',uid)}var r=[];if(uid)r.push('user_id='+encodeURIComponent(uid));if(t)r.push('item_name='+encodeURIComponent(t));if(p)r.push('price='+encodeURIComponent(p));if(s)r.push('supplier_name='+encodeURIComponent(s));r.push('url='+encodeURIComponent(u));window.open('https://next-procurement-poc.vercel.app/purchase/new?'+r.join('&'))}())";

export default function BookmarkletPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(BOOKMARKLET_HREF);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">購買申請ブックマークレット</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
        <p className="font-bold text-blue-900">設定方法</p>
        <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
          <li>
            下のボタンを
            <strong>ブックマークバーにドラッグ&ドロップ</strong>
            してください
          </li>
          <li>Amazon等の商品ページを開いた状態でブックマークをクリック</li>
          <li>
            品名・価格・購入先が入った購買申請フォームが開きます
          </li>
        </ol>
      </div>

      <div className="flex flex-col items-center gap-4 py-6">
        <a
          href={BOOKMARKLET_HREF}
          onClick={(e) => e.preventDefault()}
          className="inline-block px-6 py-3 bg-green-600 text-white font-bold rounded-lg shadow-lg hover:bg-green-700 cursor-grab active:cursor-grabbing text-lg select-none"
          title="ブックマークバーにドラッグしてください"
        >
          購買申請
        </a>
        <p className="text-sm text-gray-500">
          ↑ このボタンをブックマークバーにドラッグ&ドロップ
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-bold">対応サイト</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["Amazon.co.jp", "品名・価格・出品者名"],
            ["モノタロウ", "品名・価格"],
            ["ASKUL", "品名・価格"],
            ["ヨドバシ.com", "品名・価格"],
            ["ビックカメラ", "品名・価格"],
            ["その他", "OGPタイトル・価格"],
          ].map(([site, info]) => (
            <div key={site} className="bg-gray-50 rounded p-2">
              <span className="font-medium">{site}</span>
              <span className="text-gray-500 ml-1 text-xs">{info}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-bold">使い方</h2>
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
          <div className="flex gap-3">
            <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">
              1
            </span>
            <span>Amazon等で購入したい商品のページを開く</span>
          </div>
          <div className="flex gap-3">
            <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">
              2
            </span>
            <span>
              ブックマークバーの「購買申請」をクリック
            </span>
          </div>
          <div className="flex gap-3">
            <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">
              3
            </span>
            <span>
              確認ダイアログに品名・価格が表示 → OKで申請フォームが開く
            </span>
          </div>
          <div className="flex gap-3">
            <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">
              4
            </span>
            <span>
              残りの項目（申請区分・支払方法等）を入力して送信
            </span>
          </div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <p className="text-sm text-gray-600 font-medium">
          ドラッグ&ドロップできない場合:
        </p>
        <div className="space-y-2">
          <button
            onClick={handleCopy}
            className="px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            {copied ? "コピーしました!" : "ブックマークレットURLをコピー"}
          </button>
          <ol className="list-decimal list-inside text-xs text-gray-500 space-y-1">
            <li>上のボタンでURLをコピー</li>
            <li>ブックマークバーを右クリック → 「ページを追加」</li>
            <li>名前: 「購買申請」、URL: コピーしたURLを貼り付け</li>
            <li>保存</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

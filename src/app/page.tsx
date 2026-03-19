import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        購買管理システム POC
      </h1>
      <p className="text-gray-500 mb-8">UI/UX プレビュー</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <Link
          href="/mock/dashboard"
          className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-3xl mb-3">📊</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            管理本部ダッシュボード
          </h2>
          <p className="text-sm text-gray-500">
            発注待ち・証憑待ち・支払待ちの一覧。管理本部の作業キュー。
          </p>
        </Link>
        <Link
          href="/mock/mypage"
          className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-3xl mb-3">👤</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            申請者マイページ
          </h2>
          <p className="text-sm text-gray-500">
            自分の申請一覧、ステータス確認、証憑アップロード。
          </p>
        </Link>
        <Link
          href="/mock/slack-preview"
          className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-3xl mb-3">💬</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Slack メッセージプレビュー
          </h2>
          <p className="text-sm text-gray-500">
            承認フロー各ステップのSlackボタン操作イメージ。
          </p>
        </Link>
      </div>
    </div>
  );
}

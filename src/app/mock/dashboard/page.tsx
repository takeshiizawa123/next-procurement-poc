import Link from "next/link";

// モックデータ
const summary = {
  evidenceWaiting: 4,
  evidenceOverdue: 1,
  approvalWaiting: 3,
  orderWaiting: 2,
  deliveryWaiting: 8,
  journalWaiting: 2,
  completedThisMonth: 42,
  evidenceRate: 91,
  totalAmount: 2340000,
};

const actionItems = [
  {
    id: "PO-2025-0350",
    item: "会議用モニター",
    amount: 45000,
    applicant: "田中太郎",
    dept: "営業部",
    status: "発注待ち",
    statusColor: "bg-blue-100 text-blue-800",
    days: 0,
    action: "発注手配",
  },
  {
    id: "PO-2025-0348",
    item: "開発用ノートPC",
    amount: 198000,
    applicant: "佐藤花子",
    dept: "開発部",
    status: "発注待ち",
    statusColor: "bg-blue-100 text-blue-800",
    days: 1,
    action: "発注手配（10万超・承認済）",
  },
  {
    id: "PO-2025-0330",
    item: "プリンタートナー",
    amount: 12000,
    applicant: "山田一郎",
    dept: "総務部",
    status: "仕訳待ち",
    statusColor: "bg-green-100 text-green-800",
    days: 0,
    action: "MF会計Plus仕訳起票",
  },
  {
    id: "PO-2025-0325",
    item: "サーバーラック",
    amount: 85000,
    applicant: "鈴木次郎",
    dept: "インフラ部",
    status: "支払待ち",
    statusColor: "bg-purple-100 text-purple-800",
    days: 0,
    action: "振込処理（期日: 3/25）",
  },
];

const followItems = [
  {
    id: "PO-2025-0338",
    item: "マウス 10個",
    amount: 35000,
    person: "田中太郎",
    status: "証憑待ち",
    statusColor: "bg-orange-100 text-orange-800",
    days: 3,
    note: "Day3催促済（スレッド公開投稿）",
  },
  {
    id: "PO-2025-0342",
    item: "ノートPC",
    amount: 150000,
    person: "田中太郎",
    status: "証憑待ち",
    statusColor: "bg-orange-100 text-orange-800",
    days: 5,
    note: "Day7エスカレーション予定（3/26）",
  },
  {
    id: "PO-2025-0344",
    item: "プロジェクター",
    amount: 280000,
    person: "木村部長",
    status: "承認待ち",
    statusColor: "bg-yellow-100 text-yellow-800",
    days: 2,
    note: "部門長承認2日超過",
  },
  {
    id: "PO-2025-0336",
    item: "LANケーブル 50本",
    amount: 25000,
    person: "高橋三郎",
    status: "検収待ち",
    statusColor: "bg-yellow-100 text-yellow-800",
    days: 4,
    note: "納品予定日超過",
  },
];

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
              ← 戻る
            </Link>
            <h1 className="text-xl font-bold text-gray-900">
              購買管理ダッシュボード
            </h1>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">
              管理本部
            </span>
          </div>
          <div className="text-sm text-gray-500">2025/03/19 09:00 更新</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* サマリーカード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="証憑待ち"
            value={summary.evidenceWaiting}
            unit="件"
            color="text-orange-600"
            bg="bg-orange-50"
            sub={`うち${summary.evidenceOverdue}件が3日超過`}
          />
          <SummaryCard
            label="管理本部の要対応"
            value={summary.orderWaiting + summary.journalWaiting}
            unit="件"
            color="text-blue-600"
            bg="bg-blue-50"
            sub={`発注${summary.orderWaiting} / 仕訳${summary.journalWaiting}`}
          />
          <SummaryCard
            label="今月処理完了"
            value={summary.completedThisMonth}
            unit="件"
            color="text-green-600"
            bg="bg-green-50"
            sub={`証憑提出率 ${summary.evidenceRate}%`}
          />
          <SummaryCard
            label="今月発注総額"
            value={`¥${summary.totalAmount.toLocaleString()}`}
            unit=""
            color="text-gray-700"
            bg="bg-gray-50"
            sub={`承認待ち ${summary.approvalWaiting}件`}
          />
        </div>

        {/* 要対応（自分のボール） */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            要対応（管理本部のボール）
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">PO番号</th>
                  <th className="px-4 py-3 text-left">品目</th>
                  <th className="px-4 py-3 text-right">金額</th>
                  <th className="px-4 py-3 text-left">申請者</th>
                  <th className="px-4 py-3 text-left">ステータス</th>
                  <th className="px-4 py-3 text-left">次のアクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {actionItems.map((item) => (
                  <tr key={item.id} className="hover:bg-blue-50/50">
                    <td className="px-4 py-3 font-mono text-blue-600 font-medium">
                      {item.id}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{item.item}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      ¥{item.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.applicant}
                      <span className="text-gray-400 ml-1 text-xs">
                        {item.dept}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${item.statusColor}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* フォロー要（他者のボールだが遅延） */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            フォロー要（遅延案件）
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">PO番号</th>
                  <th className="px-4 py-3 text-left">品目</th>
                  <th className="px-4 py-3 text-right">金額</th>
                  <th className="px-4 py-3 text-left">担当者</th>
                  <th className="px-4 py-3 text-left">ステータス</th>
                  <th className="px-4 py-3 text-center">経過日数</th>
                  <th className="px-4 py-3 text-left">催促状況</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {followItems.map((item) => (
                  <tr
                    key={item.id}
                    className={
                      item.days >= 5
                        ? "bg-red-50/50 hover:bg-red-50"
                        : "hover:bg-yellow-50/50"
                    }
                  >
                    <td className="px-4 py-3 font-mono text-blue-600 font-medium">
                      {item.id}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{item.item}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      ¥{item.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.person}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${item.statusColor}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-bold ${
                          item.days >= 5
                            ? "text-red-600"
                            : item.days >= 3
                            ? "text-orange-600"
                            : "text-yellow-600"
                        }`}
                      >
                        {item.days}日
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {item.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  unit,
  color,
  bg,
  sub,
}: {
  label: string;
  value: number | string;
  unit: string;
  color: string;
  bg: string;
  sub: string;
}) {
  return (
    <div className={`${bg} rounded-lg p-4 border border-gray-200`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>
        {value}
        <span className="text-sm font-normal ml-0.5">{unit}</span>
      </div>
      <div className="text-xs text-gray-400 mt-1">{sub}</div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";

type Step =
  | "pending"
  | "approved"
  | "ordered"
  | "inspected"
  | "evidence_requested"
  | "evidence_uploaded"
  | "rejected";

export default function SlackPreview() {
  const [step, setStep] = useState<Step>("pending");

  return (
    <div className="min-h-screen bg-[#1a1d21] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            ← 戻る
          </Link>
          <h1 className="text-xl font-bold">
            Slack メッセージ プレビュー
          </h1>
        </div>

        {/* ステップ選択 */}
        <div className="flex flex-wrap gap-2 mb-8">
          {(
            [
              ["pending", "1. 承認待ち"],
              ["approved", "2. 承認済"],
              ["ordered", "3. 発注済"],
              ["inspected", "4. 検収済"],
              ["evidence_requested", "5. 証憑催促"],
              ["evidence_uploaded", "6. 証憑完了"],
              ["rejected", "差戻し"],
            ] as [Step, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStep(key)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                step === key
                  ? "bg-blue-600 text-white"
                  : "bg-[#2b2d31] text-gray-300 hover:bg-[#383a40]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Slackメッセージ風表示 */}
        <div className="bg-[#1a1d21] rounded-lg">
          {/* チャンネルヘッダー */}
          <div className="border-b border-[#383a40] pb-3 mb-4">
            <span className="text-gray-400 text-sm"># purchase-request</span>
          </div>

          {/* Bot メッセージ */}
          <div className="flex gap-3">
            {/* Bot アイコン */}
            <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center text-sm font-bold shrink-0">
              PB
            </div>

            <div className="flex-1 min-w-0">
              {/* Bot名 + 時刻 */}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-bold text-sm">procurement-bot</span>
                <span className="text-xs text-gray-500">10:30 AM</span>
              </div>

              {/* メッセージ本体 */}
              <SlackMessage step={step} />
            </div>
          </div>

          {/* スレッド返信（検収済以降） */}
          {(step === "inspected" ||
            step === "evidence_requested" ||
            step === "evidence_uploaded") && (
            <div className="ml-12 mt-4 border-l-2 border-[#383a40] pl-4">
              <ThreadReplies step={step} />
            </div>
          )}
        </div>

        {/* 説明 */}
        <div className="mt-8 p-4 bg-[#2b2d31] rounded-lg">
          <StepDescription step={step} />
        </div>
      </div>
    </div>
  );
}

function SlackMessage({ step }: { step: Step }) {
  return (
    <div className="bg-[#2b2d31] rounded-lg border border-[#383a40] overflow-hidden max-w-lg">
      {/* ヘッダー */}
      <div className="px-4 pt-3 pb-2 border-b border-[#383a40] bg-[#323438]">
        <span className="font-bold text-base">
          📋 購買申請 PO-2025-0350
        </span>
      </div>

      {/* フィールド */}
      <div className="px-4 py-3 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <div>
          <span className="font-bold text-gray-300">品目:</span>{" "}
          <span className="text-gray-100">会議用モニター</span>
        </div>
        <div>
          <span className="font-bold text-gray-300">金額:</span>{" "}
          <span className="text-gray-100">¥45,000</span>
        </div>
        <div>
          <span className="font-bold text-gray-300">申請者:</span>{" "}
          <span className="text-blue-400">@tanaka</span>
        </div>
        <div>
          <span className="font-bold text-gray-300">部門:</span>{" "}
          <span className="text-gray-100">営業部</span>
        </div>
      </div>

      {/* ステータス */}
      <div className="px-4 py-2 border-t border-[#383a40]">
        <StatusBadge step={step} />
      </div>

      {/* アクションボタン */}
      <ActionButtons step={step} />

      {/* 証憑待ちメッセージ */}
      {(step === "inspected" || step === "evidence_requested") && (
        <div className="px-4 py-3 border-t border-[#383a40] bg-[#2d2a1e]">
          <p className="text-sm text-yellow-200">
            📎 <strong>納品書をこのスレッドに添付してください</strong>
          </p>
          <p className="text-xs text-yellow-200/70 mt-1">
            ⏸️ 証憑が揃うまで経理処理は保留されます
          </p>
        </div>
      )}

      {/* 証憑完了メッセージ */}
      {step === "evidence_uploaded" && (
        <div className="px-4 py-3 border-t border-[#383a40] bg-[#1e2d1e]">
          <p className="text-sm text-green-200">
            📄 証憑確認OK — 仕訳計上の準備が整いました
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ step }: { step: Step }) {
  const statusMap: Record<Step, { color: string; label: string; detail: string }> = {
    pending: {
      color: "text-blue-400",
      label: "🔵 承認待ち",
      detail: "",
    },
    approved: {
      color: "text-green-400",
      label: "🟢 承認済",
      detail: "（yamada が承認 3/19 10:35）",
    },
    ordered: {
      color: "text-yellow-400",
      label: "🟡 発注済",
      detail: "（suzuki が発注完了 3/19 11:00）",
    },
    inspected: {
      color: "text-orange-400",
      label: "🟠 検収済・証憑待ち",
      detail: "（tanaka が検収 3/21 14:00）",
    },
    evidence_requested: {
      color: "text-orange-400",
      label: "🟠 検収済・証憑待ち",
      detail: "（tanaka が検収 3/21 14:00）— 1日経過",
    },
    evidence_uploaded: {
      color: "text-green-400",
      label: "🟢 証憑完了",
      detail: "（納品書確認済 3/22 09:30）",
    },
    rejected: {
      color: "text-red-400",
      label: "🔴 差戻し",
      detail: "（yamada が差戻し 3/19 10:40）",
    },
  };

  const s = statusMap[step];
  return (
    <span className={`text-sm ${s.color}`}>
      ステータス: <strong>{s.label}</strong>
      <span className="text-gray-500 text-xs ml-1">{s.detail}</span>
    </span>
  );
}

function ActionButtons({ step }: { step: Step }) {
  if (step === "inspected" || step === "evidence_requested" || step === "evidence_uploaded" || step === "rejected") {
    return null;
  }

  const buttons: Record<string, { primary: string; danger?: string }> = {
    pending: { primary: "✅ 承認", danger: "↩️ 差戻し" },
    approved: { primary: "🛒 発注完了" },
    ordered: { primary: "✅ 検収完了" },
  };

  const b = buttons[step];
  if (!b) return null;

  return (
    <div className="px-4 py-3 border-t border-[#383a40] flex gap-2">
      <button className="px-4 py-1.5 bg-[#007a5a] hover:bg-[#148567] text-white text-sm font-medium rounded transition-colors">
        {b.primary}
      </button>
      {b.danger && (
        <button className="px-4 py-1.5 bg-[#e01e5a] hover:bg-[#c91b50] text-white text-sm font-medium rounded transition-colors">
          {b.danger}
        </button>
      )}
    </div>
  );
}

function ThreadReplies({ step }: { step: Step }) {
  return (
    <div className="space-y-4">
      {/* 検収記録 */}
      <ThreadMessage
        bot
        time="3/21 14:00"
        text="✅ 検収記録しました（tanaka）
📎 納品書をこのスレッドに添付してください。
⏸️ 証憑が添付されるまで、この案件の経理処理は保留されます。"
      />

      {/* Day1 催促（DMイメージ） */}
      {(step === "evidence_requested" || step === "evidence_uploaded") && (
        <div className="bg-[#3d2e1e] rounded p-3 border border-yellow-800/50">
          <div className="text-xs text-yellow-500 mb-2">
            📩 tanaka へのDM（Day1催促）
          </div>
          <ThreadMessage
            bot
            time="3/22 10:00"
            text="⏸️ あなたの証憑待ちで止まっている案件: 1件
PO-2025-0350: 会議用モニター（検収から1日経過）
👉 スレッドに納品書を添付してください"
          />
        </div>
      )}

      {/* 証憑添付 */}
      {step === "evidence_uploaded" && (
        <>
          <ThreadMessage
            time="3/22 11:00"
            user="tanaka"
            text=""
            attachment="納品書_モニター.pdf"
          />
          <ThreadMessage
            bot
            time="3/22 11:00"
            text="📄 証憑を確認しました
種別: 納品書 / 金額照合: ○ 税込一致
仕訳計上の準備が整いました"
          />
        </>
      )}
    </div>
  );
}

function ThreadMessage({
  bot,
  user,
  time,
  text,
  attachment,
}: {
  bot?: boolean;
  user?: string;
  time: string;
  text: string;
  attachment?: string;
}) {
  return (
    <div className="flex gap-2">
      {bot ? (
        <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-[10px] font-bold shrink-0">
          PB
        </div>
      ) : (
        <div className="w-6 h-6 rounded bg-green-700 flex items-center justify-center text-[10px] font-bold shrink-0">
          {user?.[0]?.toUpperCase() || "U"}
        </div>
      )}
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-xs">
            {bot ? "procurement-bot" : user}
          </span>
          <span className="text-[10px] text-gray-500">{time}</span>
        </div>
        {text && (
          <p className="text-sm text-gray-200 whitespace-pre-line mt-0.5">
            {text}
          </p>
        )}
        {attachment && (
          <div className="mt-1 inline-flex items-center gap-2 bg-[#383a40] rounded px-3 py-2 text-sm">
            <span className="text-red-400">📄</span>
            <span className="text-blue-400 underline">{attachment}</span>
            <span className="text-gray-500 text-xs">245 KB</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDescription({ step }: { step: Step }) {
  const descriptions: Record<Step, { title: string; points: string[] }> = {
    pending: {
      title: "Step 1: 承認待ち",
      points: [
        "Slack WF送信 → Botが自動投稿",
        "[✅ 承認] [↩️ 差戻し] ボタンを表示",
        "承認者（部門長）のみがボタンを操作可能（権限チェック）",
        "10万円以上の場合、管理本部の追加承認ボタンも表示",
      ],
    },
    approved: {
      title: "Step 2: 承認済",
      points: [
        "承認者がボタンを押すとメッセージが即時更新",
        "誰がいつ承認したかが記録される",
        "[🛒 発注完了] ボタンが管理本部向けに表示",
        "管理本部の #purchase-ops にも通知",
      ],
    },
    ordered: {
      title: "Step 3: 発注済",
      points: [
        "管理本部が発注完了ボタンを押す",
        "[✅ 検収完了] ボタンが検収者に表示",
        "申請者・検収者にDMで「物品が届いたら検収ボタンを押してください」と通知",
      ],
    },
    inspected: {
      title: "Step 4: 検収済 → 証憑待ち",
      points: [
        "検収者が✅ボタンを押すと、メッセージが更新",
        "スレッドに「証憑を添付してください」と自動投稿",
        "ボタンは消え、証憑添付を待つ状態に",
        "ここから証憑催促のカウントダウンが開始",
      ],
    },
    evidence_requested: {
      title: "Step 5: Day1 証憑催促",
      points: [
        "翌朝10:00にBotが担当者にDMで催促（ダイジェスト形式）",
        "スレッドではなくDMなので、他のメンバーには見えない",
        "Day3: スレッドに公開投稿（チャンネルメンバーに可視化）",
        "Day7: 部門長にDMでエスカレーション",
      ],
    },
    evidence_uploaded: {
      title: "Step 6: 証憑完了",
      points: [
        "担当者がスレッドに納品書を添付",
        "BotがOCR解析（種別判定・金額照合・適格番号抽出）",
        "確認結果をスレッドに自動投稿",
        "ステータスが「証憑完了」に → 仕訳計上へ進める",
      ],
    },
    rejected: {
      title: "差戻し",
      points: [
        "承認者が差戻しボタンを押すとメッセージが更新",
        "理由入力モーダルを表示（将来実装）",
        "申請者にDMで差戻し通知",
        "再申請が必要",
      ],
    },
  };

  const d = descriptions[step];
  return (
    <div>
      <h3 className="font-bold text-gray-200 mb-2">{d.title}</h3>
      <ul className="space-y-1">
        {d.points.map((p, i) => (
          <li key={i} className="text-sm text-gray-400 flex gap-2">
            <span className="text-gray-600">-</span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

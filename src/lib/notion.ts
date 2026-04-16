/**
 * Notion API クライアント — 自己文書化システムの基盤
 *
 * 機能:
 * 1. 業務フロー図の自動同期（Mermaid → Notionページ）
 * 2. AIプロンプト透明化（推定ロジック → Notion DB）
 * 3. 変更履歴の記録（コミット → Notion DB）
 * 4. エラー報告 + AI修正提案（DLQ → Notion DB）
 * 5. 契約マスタ閲覧同期（contracts → Notion DB）
 */

import { Client } from "@notionhq/client";

// ========================================
// 初期化
// ========================================

const NOTION_API_KEY = process.env.NOTION_API_KEY || "";

let client: Client | null = null;

export function getNotionClient(): Client | null {
  if (!NOTION_API_KEY) {
    console.warn("[notion] NOTION_API_KEY not configured — sync disabled");
    return null;
  }
  if (!client) {
    client = new Client({ auth: NOTION_API_KEY });
  }
  return client;
}

// ========================================
// ページ・DB ID（環境変数から取得）
// ========================================

const PAGE_IDS = {
  flowDiagram: process.env.NOTION_FLOW_PAGE_ID || "",
  promptDb: process.env.NOTION_PROMPT_DB_ID || "",
  changelogDb: process.env.NOTION_CHANGELOG_DB_ID || "",
  errorDb: process.env.NOTION_ERROR_DB_ID || "",
  contractDb: process.env.NOTION_CONTRACT_DB_ID || "",
};

// ========================================
// 1. 業務フロー図の同期
// ========================================

/**
 * Notionページにフロー図（Mermaid/テキスト）を同期
 */
export async function syncFlowDiagram(
  title: string,
  mermaidCode: string,
  description: string,
): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.flowDiagram) return false;

  try {
    // 既存の子ブロックを取得して、同名のセクションがあれば更新
    const children = await notion.blocks.children.list({
      block_id: PAGE_IDS.flowDiagram,
      page_size: 100,
    });

    // 新しいブロックを追加
    await notion.blocks.children.append({
      block_id: PAGE_IDS.flowDiagram,
      children: [
        {
          object: "block" as const,
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: `${title} (${new Date().toISOString().split("T")[0]})` } }],
          },
        },
        {
          object: "block" as const,
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: description } }],
          },
        },
        {
          object: "block" as const,
          type: "code",
          code: {
            rich_text: [{ type: "text", text: { content: mermaidCode } }],
            language: "mermaid",
          },
        },
        {
          object: "block" as const,
          type: "divider",
          divider: {},
        },
      ],
    });

    console.log(`[notion] Synced flow diagram: ${title}`);
    return true;
  } catch (e) {
    console.error("[notion] syncFlowDiagram failed:", e);
    return false;
  }
}

// ========================================
// 2. AIプロンプト透明化
// ========================================

/**
 * AIプロンプトをNotion DBに記録
 */
export async function syncPrompt(data: {
  name: string;
  module: string;
  prompt: string;
  purpose: string;
  lastUpdated: string;
}): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.promptDb) return false;

  try {
    await notion.pages.create({
      parent: { database_id: PAGE_IDS.promptDb },
      properties: {
        "名前": { title: [{ text: { content: data.name } }] },
        "モジュール": { rich_text: [{ text: { content: data.module } }] },
        "用途": { rich_text: [{ text: { content: data.purpose } }] },
        "最終更新": { date: { start: data.lastUpdated } },
      },
      children: [
        {
          object: "block" as const,
          type: "code",
          code: {
            rich_text: [{ type: "text", text: { content: data.prompt } }],
            language: "plain text",
          },
        },
      ],
    });

    console.log(`[notion] Synced prompt: ${data.name}`);
    return true;
  } catch (e) {
    console.error("[notion] syncPrompt failed:", e);
    return false;
  }
}

// ========================================
// 3. 変更履歴の記録
// ========================================

/**
 * コミット情報をNotion DBに記録
 */
export async function recordChangelog(data: {
  commitHash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.changelogDb) return false;

  try {
    await notion.pages.create({
      parent: { database_id: PAGE_IDS.changelogDb },
      properties: {
        "コミット": { title: [{ text: { content: data.commitHash.slice(0, 7) } }] },
        "メッセージ": { rich_text: [{ text: { content: data.message.slice(0, 200) } }] },
        "作成者": { rich_text: [{ text: { content: data.author } }] },
        "日付": { date: { start: data.date } },
        "変更ファイル数": { number: data.filesChanged },
      },
    });

    console.log(`[notion] Recorded changelog: ${data.commitHash.slice(0, 7)}`);
    return true;
  } catch (e) {
    console.error("[notion] recordChangelog failed:", e);
    return false;
  }
}

// ========================================
// 4. エラー報告
// ========================================

/**
 * エラー/DLQレコードをNotion DBに記録
 */
export async function reportError(data: {
  taskType: string;
  taskId: string;
  errorMessage: string;
  suggestion?: string;
  severity: "critical" | "high" | "medium" | "low";
}): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.errorDb) return false;

  try {
    const children: Array<Record<string, unknown>> = [
      {
        object: "block" as const,
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: "エラー内容" } }],
        },
      },
      {
        object: "block" as const,
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: data.errorMessage } }],
          language: "plain text",
        },
      },
    ];

    if (data.suggestion) {
      children.push(
        {
          object: "block" as const,
          type: "heading_3",
          heading_3: {
            rich_text: [{ type: "text", text: { content: "AI修正提案" } }],
          },
        },
        {
          object: "block" as const,
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: data.suggestion } }],
          },
        },
      );
    }

    await notion.pages.create({
      parent: { database_id: PAGE_IDS.errorDb },
      properties: {
        "タスク": { title: [{ text: { content: `${data.taskType}: ${data.taskId}` } }] },
        "深刻度": { select: { name: data.severity } },
        "ステータス": { select: { name: "未対応" } },
        "発生日": { date: { start: new Date().toISOString().split("T")[0] } },
      },
      children: children as never[],
    });

    console.log(`[notion] Reported error: ${data.taskType}:${data.taskId}`);
    return true;
  } catch (e) {
    console.error("[notion] reportError failed:", e);
    return false;
  }
}

// ========================================
// 5. 契約マスタ同期
// ========================================

/**
 * 契約データをNotion DBに同期
 */
export async function syncContract(data: {
  contractNumber: string;
  category: string;
  supplierName: string;
  monthlyAmount: number;
  accountTitle: string;
  department: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
}): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.contractDb) return false;

  try {
    // 既存レコードを検索（契約番号のtitleフィルタで正確な重複チェック）
    // Notion SDK v5: databases.query廃止 → dataSources.query を使用
    const queryResult = await notion.dataSources.query({
      data_source_id: PAGE_IDS.contractDb,
      filter: {
        property: "契約番号",
        title: { equals: data.contractNumber },
      },
      page_size: 1,
    });
    const matchedPages = queryResult.results;

    const properties: Record<string, unknown> = {
      "契約番号": { title: [{ text: { content: data.contractNumber } }] },
      "カテゴリ": { select: { name: data.category } },
      "取引先": { rich_text: [{ text: { content: data.supplierName } }] },
      "月額": { number: data.monthlyAmount },
      "勘定科目": { rich_text: [{ text: { content: data.accountTitle } }] },
      "部門": { rich_text: [{ text: { content: data.department } }] },
      "開始日": { date: { start: data.startDate } },
      "ステータス": { select: { name: data.isActive ? "契約中" : "終了" } },
    };

    if (data.endDate) {
      properties["終了日"] = { date: { start: data.endDate } };
    }

    if (matchedPages.length > 0) {
      // 更新
      await notion.pages.update({
        page_id: matchedPages[0].id,
        properties: properties as never,
      });
    } else {
      // 新規作成
      await notion.pages.create({
        parent: { database_id: PAGE_IDS.contractDb },
        properties: properties as never,
      });
    }

    console.log(`[notion] Synced contract: ${data.contractNumber}`);
    return true;
  } catch (e) {
    console.error("[notion] syncContract failed:", e);
    return false;
  }
}

// ========================================
// 業務フロー定義（Mermaid）
// ========================================

export const FLOW_DEFINITIONS = {
  purchaseFlow: {
    title: "購買フロー（物品）",
    description: "物品の発注→承認→検収→証憑→仕訳の一気通貫フロー",
    mermaid: `graph TD
    A[申請者: /purchase で申請] --> B{部門長: 承認/差戻し}
    B -->|承認| C[申請者: MFカードで発注]
    B -->|差戻し| A
    C --> D[申請者: 検収完了ボタン]
    D --> E[申請者: 証憑をSlackスレッドに添付]
    E --> F[Bot: OCR金額照合 + 適格請求書検証]
    F --> G[管理本部: 仕訳管理画面で確認]
    G --> H[MF会計Plus: 仕訳登録]
    H --> I[カード照合: 月次消込]`,
  },

  contractFlow: {
    title: "契約管理フロー（役務提供）",
    description: "継続契約の登録→月次請求書→承認→仕訳のフロー",
    mermaid: `graph TD
    A[管理本部: 契約登録] --> B[毎月: 請求書受領待ち]
    B --> C{請求書到着?}
    C -->|到着| D[OCR読取 + 金額突合]
    D --> E{定額一致?}
    E -->|一致| F[自動承認]
    E -->|差額あり| G[手動確認・承認]
    F --> H[MF会計Plus: 仕訳登録]
    G --> H
    C -->|未着| I[月末: 見積計上（未払費用）]
    I --> J[翌月初: リバース（洗替）]
    J --> B
    K[契約更新アラート] --> L{更新/解約?}
    L -->|更新| B
    L -->|解約| M[契約終了]`,
  },

  approvalFlow: {
    title: "承認フロー",
    description: "部門長承認のワークフロー",
    mermaid: `graph TD
    A[申請] --> B{部門長DM}
    B -->|承認ボタン| C[承認済]
    B -->|差戻しボタン| D[差戻し理由入力]
    D --> E[申請者DM: 差戻し通知]
    C --> F[申請者DM: 承認通知]
    F --> G[発注可能]`,
  },

  journalFlow: {
    title: "仕訳生成フロー",
    description: "AI推定→管理者確認→MF会計Plus登録のフロー",
    mermaid: `graph TD
    A[証憑完了] --> B[AI: 勘定科目推定（RAG）]
    B --> C[仕訳管理画面で表示]
    C --> D{管理者: 科目確認}
    D -->|修正| E[account_corrections に記録]
    E --> F[学習ループ: 次回RAGに反映]
    D -->|承認| G[MF会計Plus: 仕訳登録]
    G --> H[Stage 1: 費用/未払金]
    H --> I[カード照合確定: Stage 2]
    I --> J[引落消込: Stage 3]`,
  },
};

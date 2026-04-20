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

// 環境変数の値に改行や空白が混入していても動作するよう防御的にtrim
const PAGE_IDS = {
  flowDiagram: (process.env.NOTION_FLOW_PAGE_ID || "").trim(),
  promptDb: (process.env.NOTION_PROMPT_DB_ID || "").trim(),
  changelogDb: (process.env.NOTION_CHANGELOG_DB_ID || "").trim(),
  errorDb: (process.env.NOTION_ERROR_DB_ID || "").trim(),
  contractDb: (process.env.NOTION_CONTRACT_DB_ID || "").trim(),
};

// data_source_id は database_id と異なる場合があるため、runtime で解決してキャッシュ
const dataSourceCache = new Map<string, string>();
async function resolveDataSourceId(databaseId: string): Promise<string | null> {
  if (!databaseId) return null;
  const cached = dataSourceCache.get(databaseId);
  if (cached) return cached;
  const notion = getNotionClient();
  if (!notion) return null;
  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataSources = (db as any).data_sources as Array<{ id: string }> | undefined;
    const id = dataSources?.[0]?.id || databaseId;
    dataSourceCache.set(databaseId, id);
    return id;
  } catch (e) {
    console.error("[notion] resolveDataSourceId failed:", e);
    return null;
  }
}

// ========================================
// 1. 業務フロー図の同期
// ========================================

/**
 * Notionページにフロー図（Mermaid/テキスト）を同期（upsert方式）
 *
 * 既存の同名フロー図ブロック群（heading_2 + description + code + divider）を
 * 削除してから新規追加する。重複防止。
 */
export async function syncFlowDiagram(
  title: string,
  mermaidCode: string,
  description: string,
): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.flowDiagram) return false;

  try {
    // ページの全子ブロックを取得（ページネーション対応）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBlocks: any[] = [];
    let cursor: string | undefined;
    do {
      const res = await notion.blocks.children.list({
        block_id: PAGE_IDS.flowDiagram,
        page_size: 100,
        start_cursor: cursor,
      });
      allBlocks.push(...res.results);
      cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
    } while (cursor);

    // 同タイトルのheading_2 + 直後のparagraph/code/dividerを削除対象に
    const toDelete: string[] = [];
    for (let i = 0; i < allBlocks.length; i++) {
      const b = allBlocks[i];
      if (b.type !== "heading_2") continue;
      const text = b.heading_2?.rich_text?.[0]?.plain_text || "";
      // 「タイトル (YYYY-MM-DD)」形式。startsWithで判定
      if (!text.startsWith(title)) continue;

      toDelete.push(b.id);
      // 次に続くparagraph/code/dividerも削除（dividerで停止）
      for (let j = 1; j <= 5 && i + j < allBlocks.length; j++) {
        const next = allBlocks[i + j];
        if (!next) break;
        if (next.type === "paragraph" || next.type === "code") {
          toDelete.push(next.id);
        } else if (next.type === "divider") {
          toDelete.push(next.id);
          break; // dividerで1セット終わり
        } else {
          break; // 想定外ブロック → 停止
        }
      }
    }

    // 既存ブロックを削除
    for (const id of toDelete) {
      try {
        await notion.blocks.delete({ block_id: id });
      } catch (e) {
        console.warn(`[notion] Delete block ${id} failed:`, e);
      }
    }

    // 新規追加
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

    console.log(`[notion] Upserted flow diagram: ${title} (deleted ${toDelete.length} old blocks)`);
    return true;
  } catch (e) {
    console.error("[notion] syncFlowDiagram failed:", e);
    return false;
  }
}

// ========================================
// 2. AIプロンプト透明化
// ========================================

export interface PromptSyncData {
  name: string;
  module: string;
  purpose: string;
  /** 使用モデル: "Claude Haiku 4.5", "Gemini 3 Flash" 等 */
  model: string;
  /** 入力データの説明 */
  input: string;
  /** RAG/DB/ファイル等のコンテキスト注入内容 */
  contextInjection: string;
  /** 出力形式（JSON schema の説明 or free text） */
  outputFormat: string;
  /** 学習ループ（account_corrections 等）があるか */
  hasLearningLoop: boolean;
  /** システムプロンプト本文（長い場合はpage bodyにcode block化） */
  prompt: string;
  /** 最終更新日 YYYY-MM-DD */
  lastUpdated: string;
}

/**
 * AIプロンプトをNotion DBに同期
 * 同名プロンプトが既存ならpage update、なければcreate
 */
export async function syncPrompt(data: PromptSyncData): Promise<boolean> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.promptDb) return false;

  try {
    // 既存チェック
    let existingPageId: string | null = null;
    try {
      const queryResult = await notion.dataSources.query({
        data_source_id: PAGE_IDS.promptDb,
        filter: {
          property: "名前",
          title: { equals: data.name },
        },
        page_size: 1,
      });
      if (queryResult.results.length > 0) {
        existingPageId = queryResult.results[0].id;
      }
    } catch {
      // 検索失敗時は新規作成フォールバック
    }

    // プロンプト本文はプロパティに200字サマリー、page bodyに全文
    const promptSummary = data.prompt.length > 200
      ? data.prompt.slice(0, 200) + "..."
      : data.prompt;

    const properties: Record<string, unknown> = {
      "名前": { title: [{ text: { content: data.name } }] },
      "モジュール": { rich_text: [{ text: { content: data.module } }] },
      "用途": { rich_text: [{ text: { content: data.purpose } }] },
      "モデル": { rich_text: [{ text: { content: data.model } }] },
      "入力": { rich_text: [{ text: { content: data.input } }] },
      "コンテキスト注入": { rich_text: [{ text: { content: data.contextInjection } }] },
      "出力形式": { rich_text: [{ text: { content: data.outputFormat } }] },
      "学習ループ": { checkbox: data.hasLearningLoop },
      "プロンプト本文": { rich_text: [{ text: { content: promptSummary } }] },
      "最終更新": { date: { start: data.lastUpdated } },
    };

    // Notionのrich_textは2000字制限があるので、プロンプト本文は分割
    const promptChunks: string[] = [];
    for (let i = 0; i < data.prompt.length; i += 1900) {
      promptChunks.push(data.prompt.slice(i, i + 1900));
    }
    const codeBlocks = promptChunks.map((chunk) => ({
      object: "block" as const,
      type: "code" as const,
      code: {
        rich_text: [{ type: "text" as const, text: { content: chunk } }],
        language: "plain text" as const,
      },
    }));

    if (existingPageId) {
      // update: properties のみ更新（既存の本文は維持）
      await notion.pages.update({
        page_id: existingPageId,
        properties: properties as never,
      });
    } else {
      // 新規作成: properties + body
      await notion.pages.create({
        parent: { database_id: PAGE_IDS.promptDb },
        properties: properties as never,
        children: codeBlocks as never,
      });
    }

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
 * 同一コミットhashが既存の場合はスキップ（重複防止）
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

  const shortHash = data.commitHash.slice(0, 7);

  try {
    // 重複チェック: 同じコミットhashのレコードが既にあればスキップ
    try {
      const existing = await notion.dataSources.query({
        data_source_id: PAGE_IDS.changelogDb,
        filter: {
          property: "コミット",
          title: { equals: shortHash },
        },
        page_size: 1,
      });
      if (existing.results.length > 0) {
        console.log(`[notion] Changelog already exists, skipping: ${shortHash}`);
        return true; // 既存をスキップしたが正常扱い
      }
    } catch (dupErr) {
      // 重複チェック失敗時は念のため記録続行
      console.warn("[notion] Dup check failed, proceeding with insert:", dupErr);
    }

    await notion.pages.create({
      parent: { database_id: PAGE_IDS.changelogDb },
      properties: {
        "コミット": { title: [{ text: { content: shortHash } }] },
        "メッセージ": { rich_text: [{ text: { content: data.message.slice(0, 200) } }] },
        "作成者": { rich_text: [{ text: { content: data.author } }] },
        "日付": { date: { start: data.date } },
        "変更ファイル数": { number: data.filesChanged },
      },
    });

    console.log(`[notion] Recorded changelog: ${shortHash}`);
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
 * ファイルをNotionにアップロードして file_upload_id を返す
 * 失敗時はnullを返す
 */
export async function uploadFileToNotion(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<string | null> {
  const notion = getNotionClient();
  if (!notion) return null;

  try {
    // single_partモードでアップロード作成
    const upload = await notion.fileUploads.create({
      mode: "single_part",
      filename,
      content_type: contentType,
    });

    // ファイル本体を送信（BlobでArrayBufferを渡す）
    await notion.fileUploads.send({
      file_upload_id: upload.id,
      file: {
        filename,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: new Blob([buffer as any], { type: contentType }),
      },
    });

    console.log(`[notion] Uploaded file: ${filename} (${upload.id})`);
    return upload.id;
  } catch (e) {
    console.error("[notion] uploadFileToNotion failed:", e);
    return null;
  }
}

/**
 * 契約データをNotion DBに同期
 * fileUploadIdを渡すと「契約書」プロパティにファイル添付する
 * 戻り値: Notion page URL（成功時）、null（失敗時）
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
  fileUploadId?: string;
  fileName?: string;
}): Promise<string | null> {
  const notion = getNotionClient();
  if (!notion || !PAGE_IDS.contractDb) return null;

  try {
    const dataSourceId = await resolveDataSourceId(PAGE_IDS.contractDb);
    if (!dataSourceId) {
      console.error("[notion] syncContract: data_source_id resolution failed");
      return null;
    }

    // 既存レコードを検索
    const queryResult = await notion.dataSources.query({
      data_source_id: dataSourceId,
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

    // 契約書ファイルの添付
    if (data.fileUploadId) {
      properties["契約書"] = {
        files: [
          {
            type: "file_upload",
            file_upload: { id: data.fileUploadId },
            name: data.fileName || `${data.contractNumber}.pdf`,
          },
        ],
      };
    }

    let pageId: string;
    let pageUrl: string;
    if (matchedPages.length > 0) {
      const updated = await notion.pages.update({
        page_id: matchedPages[0].id,
        properties: properties as never,
      });
      pageId = updated.id;
      pageUrl = "url" in updated ? (updated as { url: string }).url : "";
    } else {
      const created = await notion.pages.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parent: { type: "data_source_id", data_source_id: dataSourceId } as any,
        properties: properties as never,
      });
      pageId = created.id;
      pageUrl = "url" in created ? (created as { url: string }).url : "";
    }

    console.log(`[notion] Synced contract: ${data.contractNumber} (${pageId})`);
    return pageUrl || `https://www.notion.so/${pageId.replace(/-/g, "")}`;
  } catch (e) {
    console.error("[notion] syncContract failed:", e);
    return null;
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

  serviceFlow: {
    title: "役務申請フロー（スポット役務）",
    description: "単発コンサル・修繕等、purchase_requests(type=役務)での申請→役務完了確認→請求書→仕訳",
    mermaid: `graph TD
    A[申請者: /purchase 役務を選択] --> B[サービス内容・金額・取引先を入力]
    B --> C{部門長: 承認/差戻し}
    C -->|承認| D[ステータス: 発注済・役務実施中]
    C -->|差戻し| A
    D --> E[役務実施・納品]
    E --> F[申請者/検収者: 役務完了確認ボタン]
    F --> G[ステータス: 役務完了・請求書待ち]
    G --> H[申請者: 請求書をSlackスレッドに添付]
    H --> I[OCR読取+金額照合]
    I --> J[管理本部: 仕訳管理で確認]
    J --> K[MF会計Plus: 仕訳登録]`,
  },

  cardAutoMatchFlow: {
    title: "カード自動マッチフロー（SaaS・クラウドサービス）",
    description: "契約マスタ(billing_type=カード自動)とMF経費カード明細を自動マッチ→contract_invoice生成→仕訳",
    mermaid: `graph TD
    A[管理本部: /admin/contracts で契約登録] --> B[billing_type=カード自動 を選択]
    B --> C[取引先名・月額/予算額を設定]
    C --> D[毎週月曜: card-reconciliation cron]
    D --> E[MF経費からカード明細取得]
    E --> F[matchContractCards: 加盟店名×契約マスタ突合]
    F --> G{スコア ≥75?}
    G -->|confident| H[applyContractMatches: contract_invoice 自動生成]
    G -->|candidate| I[手動確認待ち]
    H --> J[ステータス: 受領済]
    J --> K[管理本部: 承認 → 仕訳登録]
    K --> L[ContractJournalTab: MF仕訳登録]`,
  },

  tripFlow: {
    title: "出張申請フロー",
    description: "出張計画→AI支援でフォーム生成→予約→旅費精算の一気通貫。日当は給与連携フローで別途支給",
    mermaid: `graph TD
    A["申請者: trip/new で自然言語入力"] --> B["Gemini 2.0 Flash で AI構造化"]
    B --> C["目的地・日程・交通・宿泊を自動生成"]
    C --> D["予約リンク自動生成 Jalan 楽天 SmartEX えきねっと"]
    D --> E["申請者: 内容確認・編集"]
    E --> F["提出: purchase_requests に出張PO作成"]
    F --> F2["trip_allowance 自動計算 日帰り1000円 または 泊数プラス1日ぶん3000円"]
    F2 --> G{"部門長: 承認または差戻し"}
    G -->|承認| H["申請者: 外部予約サイトで予約"]
    G -->|差戻し| A
    H --> I["出張実施"]
    I --> J["領収書を Slackスレッドに添付"]
    J --> K["OCR と金額照合 そして仕訳生成"]
    F2 --> L["出張手当は payrollIntegrationFlow で月次集計し MF給与へ"]`,
  },

  expenseFlow: {
    title: "立替精算フロー",
    description: "従業員が立替払いした経費を精算。承認・発注・検収ステップをスキップ。月次で給与連携",
    mermaid: `graph TD
    A["従業員: expense/new で申請"] --> B["品目 金額 取引先 支払方法=立替 を入力"]
    B --> C["request_type=購入済で submit"]
    C --> D["承認 発注 検収ステップをスキップ"]
    D --> E["ステータス: 検収済 証憑待ち"]
    E --> F["申請者: 領収書を Slackスレッドに添付"]
    F --> G["Gemini OCR で金額抽出"]
    G --> H["金額照合 申請額 vs OCR金額"]
    H --> I{"誤差 20パーセント以内?"}
    I -->|OK| J["仕訳登録 借方費用 貸方未払金"]
    I -->|差異大| K["承認者に再承認DM送信"]
    K --> L["再承認後に仕訳"]
    J --> M["月次で payrollIntegrationFlow により集計"]
    L --> M
    M --> N["MF給与で給与と合算して振込"]`,
  },

  payrollIntegrationFlow: {
    title: "給与連携フロー（立替経費+出張手当）",
    description: "月次締め後、立替経費と出張手当を従業員別に集計→MF給与CSVに転記→月次給与と合算して振込",
    mermaid: `graph TD
    A["購買管理: 立替精算と出張手当が仕訳済"] --> B["月末締め"]
    B --> C["管理本部: admin/expense/payroll で対象月選択"]
    C --> D["集計API 従業員別に立替経費合計と出張手当合計"]
    D --> E["payroll_code 6桁社員コードで従業員特定"]
    E --> F{"社員コード未マッピング?"}
    F -->|あり| G["admin/employees/payroll-mapping で設定"]
    F -->|なし| H["集計結果を表示"]
    G --> H
    H --> I{"出力方式"}
    I -->|即貼付| J["クリップボードコピー タブ区切り"]
    I -->|CSV保存| K["CSVダウンロード"]
    J --> L["給与関連一覧表.xlsx の立替経費 出張手当列に貼付"]
    K --> L
    L --> M["MF給与csv用シート.xlsx が VLOOKUPで自動反映"]
    M --> N["MF用シートをCSV保存"]
    N --> O["MF給与にCSVインポート"]
    O --> P["月次給与に合算して振込 月末締め翌月15日支給"]`,
  },

  voucherOcrFlow: {
    title: "証憑OCR処理フロー",
    description: "Slackに添付された領収書・請求書をGeminiでOCR抽出し金額照合→仕訳生成",
    mermaid: `graph TD
    A[申請者: 領収書/請求書をSlackスレッドに添付] --> B[Slackイベント受信]
    B --> C[画像/PDFをダウンロード]
    C --> D[Gemini 3 Flash でOCR抽出]
    D --> E[金額・日付・税率・適格請求書番号]
    E --> F[国税庁API: 適格請求書発行事業者検証]
    F --> G[金額照合: 申請額 vs OCR金額]
    G --> H{差異}
    H -->|一致| I[ステータス: 証憑OK]
    H -->|20%超| J[金額差異再承認フロー]
    I --> K[AI勘定科目推定 → 仕訳生成]`,
  },

  amountDiffFlow: {
    title: "金額差異再承認フロー",
    description: "OCR金額と申請額に差異あり→承認者に再承認DM→承認後に補正仕訳",
    mermaid: `graph TD
    A[証憑OCR完了] --> B[金額照合]
    B --> C{差異の程度}
    C -->|±20%以内 かつ ±¥1,000以内| D[通常仕訳]
    C -->|それを超える| E[sendAmountDiffApproval]
    E --> F[承認者DM: 申請額 vs OCR金額を提示]
    F --> G{承認/却下}
    G -->|承認| H[OCR金額で再計上]
    G -->|却下| I[申請者に差し戻し]
    H --> J[仕訳に差額調整 remark]
    I --> K[申請者: 金額訂正 or 取消]`,
  },

  partialInspectionFlow: {
    title: "部分検収フロー",
    description: "発注数量に対して一部のみ納品された場合の段階的検収",
    mermaid: `graph TD
    A[発注完了: 10個] --> B[一部納品: 5個到着]
    B --> C[申請者: 部分検収ボタン押下]
    C --> D[モーダル: 検収数量=5を入力]
    D --> E[ステータス: 部分検収(5/10)]
    E --> F[OPSに通知]
    F --> G[残り納品待ち]
    G --> H[全量納品後: 全数検収ボタン]
    H --> I[ステータス: 検収済]`,
  },

  returnFlow: {
    title: "返品処理フロー",
    description: "検収済み商品の返品と逆仕訳生成",
    mermaid: `graph TD
    A[検収済みの商品] --> B[不具合等で返品判断]
    B --> C[申請者/検収者: 返品ボタン押下]
    C --> D[モーダル: 返品数量・理由を入力]
    D --> E[GAS/DBステータス: 返品処理中]
    E --> F[取消仕訳ドラフト自動作成]
    F --> G[借方: 未払金/買掛金, 貸方: 元の費用科目]
    G --> H[管理本部: MF会計Plusで取消仕訳を確認・承認]
    H --> I[ステータス: 返品済]`,
  },

  cardReconciliationFlow: {
    title: "カード月次照合フロー（予測マッチ）",
    description: "カード明細と購買予測レコードを突合し、未申請/金額不一致を検出",
    mermaid: `graph TD
    A[毎週月曜 JST 11:00: card-reconciliation cron] --> B[MF経費APIからカード明細取得 過去30日]
    B --> C[predicted_transactions取得: status=pending]
    C --> D[matchByOfficeMember: 従業員×金額×日付]
    D --> E[スコア: 金額60+日付30+サービス名10]
    E --> F{判定}
    F -->|confident ≥80| G[自動確定: status=matched]
    F -->|candidate 50-79| H[手動確認待ち]
    F -->|unmatched| I[OPSに未申請アラート]
    F -->|unreported| J[申請者にDM: 未申請のカード利用]
    G --> K[月次ダッシュボードで可視化]`,
  },

  journalLearningFlow: {
    title: "仕訳学習ループ",
    description: "AI勘定科目推定 → 管理者による修正 → account_corrections DB → 次回推定の精度向上",
    mermaid: `graph TD
    A[証憑完了] --> B[buildJournalFromPurchase]
    B --> C[estimateAccountFromHistory: RAG検索]
    C --> D[Claude Haiku 4.5: 勘定科目+税区分推定]
    D --> E[仕訳管理画面で表示]
    E --> F{管理者: 科目確認}
    F -->|修正| G[POST /api/admin/account-correction]
    G --> H[account_corrections テーブルに記録]
    H --> I[次回同類の品目/仕入先で推定]
    I --> J[getAccountCorrections → RAGコンテキストに注入]
    J --> C
    F -->|そのまま| K[MF会計Plus: 仕訳登録]`,
  },

  monthlyAccrualFlow: {
    title: "月次見積計上＆リバースフロー",
    description: "月末に未着請求書を見積計上→翌月初にリバース洗替→実請求書で確定",
    mermaid: `graph TD
    A[月末 JST 23:00: contract-accrual cron] --> B[active契約 + autoAccrue=true]
    B --> C[当月の請求書レコードなし?]
    C -->|あり| D[見積計上仕訳作成]
    D --> E[借方: 費用科目, 貸方: 未払費用]
    E --> F[contract_invoice.accrualJournalId 記録]
    F --> G[翌月初 JST 01:00: contract-reversal cron]
    G --> H[前月の見積仕訳をリバース]
    H --> I[借方: 未払費用, 貸方: 費用科目]
    I --> J[contract_invoice.reversalJournalId 記録]
    J --> K[ステータス: 未受領に戻る]
    K --> L[実際の請求書到着を待つ]`,
  },

  slackAiFlow: {
    title: "Slack /ask 対話型AIアシスタント",
    description: "購買・仕訳データにRAG検索+集計+Claude Haikuで自然言語応答",
    mermaid: `graph TD
    A[Slack: /ask 今月の消耗品費の合計は?] --> B[/api/ai/ask 受信]
    B --> C[キーワード検出: 仕入先/品目/科目]
    C --> D[RAGコンテキスト構築]
    D --> E[purchase_requests: ILIKE検索 top15]
    D --> F[journal_rows: ILIKE検索 top15]
    D --> G{集計キーワード?}
    G -->|いくら/合計/上位| H[過去3ヶ月集計: 仕入先・科目ごと top10]
    E --> I[Claude Haiku 4.5 に構造化プロンプト送信]
    F --> I
    H --> I
    I --> J[日本語で回答生成]
    J --> K[Slackスレッドに返信]`,
  },
};

// ========================================
// AIプロンプト定義
// ========================================

/**
 * 5つのAIプロンプトの構造化定義
 * Notion同期時にここから全フィールドを渡す
 */
export const PROMPT_DEFINITIONS: Omit<PromptSyncData, "lastUpdated">[] = [
  {
    name: "勘定科目推定プロンプト",
    module: "src/lib/account-estimator.ts",
    purpose: "品目名・仕入先・金額・部門から最適な勘定科目と税区分をRAG検索+Claudeで推定",
    model: "Claude Haiku 4.5 (claude-haiku-4-5-20251001)",
    input: "itemName, supplierName, totalAmount, department, unitPrice, ocrTaxCategory",
    contextInjection: [
      "過去の仕訳実績（仕入先マッチ + キーワードマッチ top15）",
      "部門別の科目/税区分統計（DeptAccountTaxStat）",
      "account_corrections テーブル（管理者による修正履歴）← 学習ループ",
      "使用可能な勘定科目マスタ（MF会計Plus）",
      "使用可能な税区分マスタ",
    ].join(" / "),
    outputFormat: `JSON: {account: string, taxType: string, confidence: "high"|"medium"|"low", reason: string (≤30字)}`,
    hasLearningLoop: true,
    prompt: `あなたは日本の企業の経理担当者です。購買データから最適な勘定科目と税区分を判定してください。

## 判定の最重要ポイント
**品名の内容から「何を購入したか」を判断し、それに適した勘定科目を選んでください。**
取引先名（Amazonなど）は様々な品目を扱うため、取引先だけでは判断できません。

## 会計基準（必須）
- 固定資産の判定は「単価（1個あたりの取得価額）」で行う
- 税抜単価10万円未満の有形物品は消耗品費等で費用処理（少額減価償却資産の特例）
- 税抜単価10万円以上の有形物品のみ固定資産に計上
- 数量1でも品名から消耗品と判断できるなら消耗品費を選ぶ

## RAGコンテキスト
- 過去の仕訳実績（取引先マッチ+品名類似度）
- 部門別の科目傾向
- account_corrections の修正履歴（学習ループ）

## 出力
以下のJSON形式のみで回答:
{"account": "勘定科目名", "taxType": "税区分名", "confidence": "high|medium|low", "reason": "判定理由（30文字以内）"}`,
  },
  {
    name: "証憑OCR解析プロンプト",
    module: "src/lib/ocr.ts",
    purpose: "証憑画像（請求書・領収書・納品書）から金額・日付・適格請求書番号を構造化抽出",
    model: "Gemini 3 Flash Preview (gemini-3-flash-preview)",
    input: "Base64 画像/PDF + MIME type",
    contextInjection: "なし（プロンプトのみで判定）。国税庁API検証は別処理",
    outputFormat: `JSON: {document_type, date (YYYY-MM-DD), amount, tax_rate, tax_amount, subtotal, vendor_name, items[{name, quantity, unit_price}], confidence, invoice_number, is_qualified_invoice, registration_number (T+13桁)}`,
    hasLearningLoop: false,
    prompt: `この証憑（請求書・領収書・納品書）から以下の情報をJSON形式で抽出してください。

## 抽出フィールド
- document_type: "delivery_note" | "invoice" | "receipt"
- date: YYYY-MM-DD形式
- amount: 税込合計（数値のみ、カンマ/円記号除去）
- tax_rate: 10 | 8 | 0（複数税率時は主たる税率）
- tax_amount: 消費税額
- subtotal: 税抜金額
- vendor_name: 発行者/店舗名
- items: [{ name, quantity, unit_price }]
- confidence: 0-1の確信度
- invoice_number: 請求書番号
- is_qualified_invoice: 適格請求書かどうか
- registration_number: T+13桁の登録番号

## 注意
- 登録番号は「T」で始まる13桁。ヘッダー・フッター・欄外の小さな文字も注意深く探す
- is_qualified_invoice: 登録番号が見つかればtrue
- 税率: 10%対象と8%（軽減税率）対象が混在する場合、金額が大きい方の税率を設定

JSONのみ出力（説明文は不要）`,
  },
  {
    name: "契約書OCR抽出プロンプト",
    module: "src/lib/contract-ocr.ts",
    purpose: "契約書PDF/画像から取引先・期間・金額・カテゴリ・勘定科目を構造化抽出",
    model: "Gemini 3 Flash Preview (gemini-3-flash-preview)",
    input: "Base64 契約書PDF/画像 + MIME type",
    contextInjection: "なし（カテゴリ分類ルールをプロンプトに埋込）",
    outputFormat: `JSON: {supplierName, category (派遣/外注/SaaS/顧問/賃貸/保守/清掃/その他), billingType (固定/従量/カード自動), monthlyAmount, annualAmount, contractStartDate, contractEndDate, renewalType, accountTitle, confidence, notes}`,
    hasLearningLoop: false,
    prompt: `この契約書から以下の情報をJSON形式で抽出してください。

## カテゴリ判定ガイド
- SaaS: クラウドサービス、ソフトウェア利用料
- 派遣: 派遣社員受入契約
- 外注: 業務委託、請負、制作委託
- 顧問: 税理士/弁護士/社労士等の顧問契約
- 賃貸: オフィス・倉庫・機器のリース
- 保守: 保守契約、メンテナンス
- 清掃: 清掃業務委託

## 請求タイプ判定
- 固定: 月額○○円・年額○○円など定額
- 従量: タイムシート・作業時間・成果物ベース
- カード自動: クレジットカード自動引き落とし明記

## 金額抽出
- 「月額○○円（税込）」が最優先。税抜なら税率加算して税込額へ変換
- 「令和5年4月1日」→ "2023-04-01" に変換
- 無期限契約なら contractEndDate は null

## 勘定科目推定
- SaaS → "支払手数料" / "通信費"
- 派遣 → "派遣料"
- 外注 → "外注費" / "業務委託費"
- 顧問 → "支払報酬料" / "顧問料"
- 賃貸 → "地代家賃" / "賃借料"
- 保守 → "修繕費" / "保守料"

JSONのみ出力`,
  },
  {
    name: "Slack対話型AIアシスタント",
    module: "src/app/api/ai/ask/route.ts",
    purpose: "/ask コマンドで購買・仕訳データにRAG検索+集計しClaude Haikuで自然言語応答",
    model: "Claude Haiku 4.5 (claude-haiku-4-5-20251001)",
    input: "自然言語クエリ (例: 「今月の消耗品費の合計は?」)",
    contextInjection: [
      "purchase_requests: ILIKE検索 top15 (itemName/supplierName/applicantName/department)",
      "journal_rows: ILIKE検索 top15 (remark/account/counterparty/department)",
      "キーワード検知: 「いくら/合計/上位」→ 過去3ヶ月の仕入先・科目別集計 top10",
    ].join(" / "),
    outputFormat: "自然言語（日本語、Slack向けフォーマット: ¥記号・bullet list）",
    hasLearningLoop: false,
    prompt: `あなたは購買管理システムのAIアシスタントです。
データベース検索結果のみに基づいて回答してください（推論不可）。

## フォーマット
- 金額: ¥1,234,567 表記
- 日付: 日本語形式 (4月18日)
- 複数項目: bulletリスト

## データが見つからない場合
「該当するデータが見つかりませんでした」と答える（推測で回答しない）

## 集計系の質問
「いくら」「合計」「上位」を含むクエリには、過去3ヶ月の統計を付加して回答`,
  },
  {
    name: "出張AI支援プロンプト",
    module: "src/app/api/trip/ai-assist/route.ts",
    purpose: "自然言語の出張計画を構造化し、予約サイトURLを自動生成",
    model: "Gemini 2.0 Flash (gemini-2.0-flash)",
    input: "自然言語 (例: 「来月の2-4日で大阪出張、のぞみで」)",
    contextInjection: [
      "今日の日付（相対日付解決用）",
      "交通費/宿泊費の相場ヒューリスティクス (東海道新幹線: ¥11,000〜14,000、ビジネスホテル: ¥7,000〜12,000)",
      "予約サイトURL生成ルール (Jalan/楽天/SmartEX/えきねっと/ANA/JAL)",
      "都道府県コードマッピング",
    ].join(" / "),
    outputFormat: `JSON: {destination, startDate, endDate, nights, purpose, transports[], accommodations[], isEstimate, suggestion}`,
    hasLearningLoop: false,
    prompt: `出張計画の自然言語入力を構造化JSONに変換し、予約サイトURLを生成してください。

## 時刻解析
- 「朝」→ 7-8時, 「午前」→ 9-10時, 「午後」→ 13-15時, 「夕方」→ 17-19時
- 往復明示がない場合、往路のみ

## 予約サイト選定
- 東海道新幹線 → SmartEX URL
- 東北/上越/北陸新幹線 → えきねっと URL
- 宿泊 → Jalan + 楽天トラベル 両方
- 航空券 → ANA/JAL 両方

## 相場（確度表示用）
- 東京⇔大阪新幹線: ¥11,000-14,000
- ビジネスホテル: ¥7,000-12,000/泊

## 出力
JSON: {destination, startDate, endDate, nights, purpose, transports: [{mode, from, to, url, priceEstimate}], accommodations: [{area, url, priceEstimate}], isEstimate, suggestion}`,
  },
];

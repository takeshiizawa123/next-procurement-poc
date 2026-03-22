/**
 * 勘定科目推定ロジック
 *
 * 品目名・購入先のキーワードマッチで勘定科目を推定する。
 * 優先順位: 品目名キーワード > 購入先 > 金額ベース
 */

interface EstimationRule {
  keywords: RegExp;
  account: string;
  subAccount?: string;
}

// 品目名ベースのルール（優先度高）
const ITEM_RULES: EstimationRule[] = [
  // IT機器・備品（10万円以上は固定資産）
  { keywords: /ノートPC|パソコン|PC|MacBook|ThinkPad|Surface/i, account: "工具器具備品" },
  { keywords: /モニター|ディスプレイ|液晶/i, account: "工具器具備品" },
  { keywords: /サーバー|サーバ|NAS/i, account: "工具器具備品" },
  { keywords: /プリンター|プリンタ|複合機/i, account: "工具器具備品" },
  { keywords: /タブレット|iPad/i, account: "工具器具備品" },
  { keywords: /キーボード|マウス|ヘッドセット|Webカメラ|USBハブ|充電器|ケーブル|アダプタ/i, account: "消耗品費", subAccount: "PC周辺機器" },

  // ソフトウェア・ライセンス
  { keywords: /ライセンス|サブスク|月額|年額|SaaS|クラウド/i, account: "支払手数料", subAccount: "ソフトウェア" },
  { keywords: /ソフトウェア|ソフト|Microsoft|Adobe|Office/i, account: "支払手数料", subAccount: "ソフトウェア" },

  // 事務用品
  { keywords: /コピー用紙|用紙|紙|封筒|ファイル|バインダー/i, account: "事務用品費" },
  { keywords: /ペン|ボールペン|マーカー|付箋|ノート|クリップ/i, account: "事務用品費" },
  { keywords: /トナー|インク|カートリッジ/i, account: "事務用品費" },
  { keywords: /切手|はがき|レターパック|郵便/i, account: "通信費" },

  // 電子部品・材料（製造系）
  { keywords: /基板|PCB|プリント基板/i, account: "材料費" },
  { keywords: /抵抗|コンデンサ|IC|半導体|ダイオード|トランジスタ/i, account: "材料費", subAccount: "電子部品" },
  { keywords: /センサー|センサ|モーター|モータ|アクチュエータ/i, account: "材料費", subAccount: "電子部品" },
  { keywords: /ケーブル|コネクタ|ハーネス|端子/i, account: "材料費" },
  { keywords: /ねじ|ボルト|ナット|ワッシャ|スペーサ/i, account: "材料費", subAccount: "機械部品" },
  { keywords: /3Dプリンタ.*フィラメント|フィラメント|レジン/i, account: "材料費" },

  // 工具
  { keywords: /工具|ドライバー|レンチ|ペンチ|ニッパー|はんだ/i, account: "消耗品費", subAccount: "工具" },
  { keywords: /テスター|オシロ|計測器|測定器/i, account: "工具器具備品" },

  // 書籍・研修
  { keywords: /書籍|本|技術書|参考書|雑誌/i, account: "新聞図書費" },
  { keywords: /研修|セミナー|講座|トレーニング/i, account: "研修費" },

  // 消耗品一般
  { keywords: /電池|バッテリー|乾電池/i, account: "消耗品費" },
  { keywords: /洗剤|ティッシュ|ペーパータオル|ゴミ袋|掃除/i, account: "消耗品費", subAccount: "衛生用品" },
  { keywords: /飲料|お茶|コーヒー|水|菓子/i, account: "福利厚生費" },
];

// 購入先ベースのデフォルトルール（品目名で判定できない場合のフォールバック）
const SUPPLIER_DEFAULTS: Record<string, string> = {
  "Amazon": "消耗品費",
  "モノタロウ": "消耗品費",
  "アスクル": "事務用品費",
  "ASKUL": "事務用品費",
  "ヨドバシ": "消耗品費",
  "ビックカメラ": "消耗品費",
  "チップワンストップ": "材料費",
  "DigiKey": "材料費",
  "Mouser": "材料費",
  "ミスミ": "材料費",
  "RSコンポーネンツ": "材料費",
  "マルツ": "材料費",
  "秋月電子": "材料費",
  "スイッチサイエンス": "材料費",
  "DELL": "工具器具備品",
  "Lenovo": "工具器具備品",
};

export interface AccountEstimation {
  account: string;
  subAccount: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * 勘定科目を推定
 */
export function estimateAccount(
  itemName: string,
  supplierName: string,
  totalAmount: number,
): AccountEstimation {
  // 1. 品目名キーワードマッチ（優先）
  for (const rule of ITEM_RULES) {
    if (rule.keywords.test(itemName)) {
      // 10万円以上の工具器具備品は固定資産に格上げ
      let account = rule.account;
      if (account === "工具器具備品" && totalAmount >= 100000) {
        account = "工具器具備品（固定資産）";
      }
      // 10万円未満の工具器具備品は消耗品費に格下げ
      if (account === "工具器具備品" && totalAmount > 0 && totalAmount < 100000) {
        account = "消耗品費";
      }
      return {
        account,
        subAccount: rule.subAccount || "",
        confidence: "high",
        reason: `品目名「${itemName}」から推定`,
      };
    }
  }

  // 2. 購入先デフォルト
  for (const [supplier, account] of Object.entries(SUPPLIER_DEFAULTS)) {
    if (supplierName.includes(supplier) || supplier.includes(supplierName)) {
      return {
        account,
        subAccount: "",
        confidence: "medium",
        reason: `購入先「${supplierName}」から推定`,
      };
    }
  }

  // 3. 金額ベースの推定（最低信頼度）
  if (totalAmount >= 100000) {
    return {
      account: "工具器具備品（固定資産）",
      subAccount: "",
      confidence: "low",
      reason: "10万円以上のため固定資産の可能性",
    };
  }

  return {
    account: "消耗品費",
    subAccount: "",
    confidence: "low",
    reason: "デフォルト（品目名・購入先から判定不可）",
  };
}

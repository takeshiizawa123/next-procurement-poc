/**
 * GAS追加コード: MFマスタデータの永続化
 *
 * 既存のGAS Web Appの doPost/doGet に以下のアクションを追加してください。
 * 「MFマスタ」シートにJSON形式でマスタデータを保存・読取します。
 *
 * 使い方:
 * 1. GASエディタで既存のコード.gsを開く
 * 2. doPost() の switch/if 文に saveMfMasters アクションを追加
 * 3. doGet() の switch/if 文に getMfMasters アクションを追加
 * 4. 下記の handleSaveMfMasters / handleGetMfMasters 関数をコピー
 * 5. デプロイを更新（新しいバージョン）
 */

// ============================================
// doPost に追加するケース
// ============================================
// 既存の doPost() 内の action 分岐に以下を追加:
//
//   case "saveMfMasters":
//     return ContentService
//       .createTextOutput(JSON.stringify(handleSaveMfMasters(data)))
//       .setMimeType(ContentService.MimeType.JSON);

/**
 * MFマスタデータをスプレッドシートに保存
 *
 * @param {Object} data - リクエストデータ
 * @param {Object} data.masters - マスタデータ（accounts, taxes, departments, subAccounts, projects, counterparties, syncedAt）
 * @returns {Object} { success: true, data: { saved: true } }
 */
function handleSaveMfMasters(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("MFマスタ");

    // シートがなければ作成
    if (!sheet) {
      sheet = ss.insertSheet("MFマスタ");
      sheet.getRange("A1").setValue("masters_json");
      sheet.getRange("B1").setValue("synced_at");
      sheet.getRange("C1").setValue("counts");
    }

    var masters = data.masters;
    if (!masters) {
      return { success: false, error: "masters data is required" };
    }

    // マスタ全体をJSON文字列としてA2に保存
    var json = JSON.stringify(masters);
    sheet.getRange("A2").setValue(json);
    sheet.getRange("B2").setValue(masters.syncedAt || new Date().toISOString());

    // カウント情報をC2に保存（確認用）
    var counts = {
      accounts: (masters.accounts || []).length,
      taxes: (masters.taxes || []).length,
      departments: (masters.departments || []).length,
      subAccounts: (masters.subAccounts || []).length,
      projects: (masters.projects || []).length,
      counterparties: (masters.counterparties || []).length,
    };
    sheet.getRange("C2").setValue(JSON.stringify(counts));

    Logger.log("[saveMfMasters] Saved: " + JSON.stringify(counts));

    return {
      success: true,
      data: { saved: true },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    Logger.log("[saveMfMasters] Error: " + e.message);
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================
// doGet に追加するケース
// ============================================
// 既存の doGet() 内の action 分岐に以下を追加:
//
//   case "getMfMasters":
//     return ContentService
//       .createTextOutput(JSON.stringify(handleGetMfMasters()))
//       .setMimeType(ContentService.MimeType.JSON);

/**
 * スプレッドシートからMFマスタデータを読み取り
 *
 * @returns {Object} { success: true, data: { masters: {...} } }
 */
function handleGetMfMasters() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("MFマスタ");

    if (!sheet) {
      return {
        success: false,
        error: "MFマスタシートが存在しません。MF会計認証後に自動作成されます。",
        timestamp: new Date().toISOString(),
      };
    }

    var json = sheet.getRange("A2").getValue();
    if (!json) {
      return {
        success: false,
        error: "マスタデータが空です。MF会計認証を実行してください。",
        timestamp: new Date().toISOString(),
      };
    }

    var masters = JSON.parse(json);

    Logger.log("[getMfMasters] Loaded (synced: " + (masters.syncedAt || "unknown") + ")");

    return {
      success: true,
      data: { masters: masters },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    Logger.log("[getMfMasters] Error: " + e.message);
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * GAS追加コード: MFマスタデータの読取・キャッシュ
 *
 * 既存シート「取引先マスタ_MF」「部門マスタ_MF」から読取 +
 * 「MFマスタ」シートにJSON形式で勘定科目・税区分・PJ・補助科目をキャッシュ
 *
 * doGet に追加するアクション:
 *   - getMfCounterparties: 取引先マスタ_MFシートから取得
 *   - getMfDepartments: 部門マスタ_MFシートから取得
 *   - getMfMasters: MFマスタシート（JSONキャッシュ）から取得
 *
 * doPost に追加するアクション:
 *   - saveMfMasters: MFマスタシートにJSONキャッシュ保存
 */

// ============================================
// doGet に追加する3ケース
// ============================================
//
// case "getMfCounterparties":
//   return jsonResponse(handleGetMfCounterparties());
//
// case "getMfDepartments":
//   return jsonResponse(handleGetMfDepartments());
//
// case "getMfMasters":
//   return jsonResponse(handleGetMfMasters());
//
// ※ jsonResponse = (data) => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)

// ============================================
// doPost に追加する1ケース
// ============================================
//
// case "saveMfMasters":
//   return jsonResponse(handleSaveMfMasters(data));

// ============================================
// 取引先マスタ（既存シートから読取）
// ============================================

/**
 * 取引先マスタ_MFシートから全行を取得
 *
 * シート構成:
 *   A: MF会計ID, B: コード, C: 取引先名, D: 検索キー, E: 適格事業者番号, F: 有効, G: 購入先名（別名）
 */
function handleGetMfCounterparties() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("取引先マスタ_MF");
    if (!sheet) {
      return { success: false, error: "取引先マスタ_MFシートが見つかりません" };
    }

    var data = sheet.getDataRange().getValues();
    var counterparties = [];

    // 1行目はヘッダー、2行目からデータ
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[2]) continue; // 取引先名が空はスキップ

      counterparties.push({
        mfId: String(row[0] || ""),
        code: String(row[1] || ""),
        name: String(row[2] || ""),
        searchKey: String(row[3] || ""),
        invoiceRegistrationNumber: String(row[4] || ""),
        available: String(row[5] || "") === "○",
        alias: String(row[6] || ""),
      });
    }

    return {
      success: true,
      data: { counterparties: counterparties },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// 部門マスタ（既存シートから読取）
// ============================================

/**
 * 部門マスタ_MFシートから全行を取得
 *
 * シート構成:
 *   A: MF会計ID, B: コード, C: 部門名, D: 検索キー, E: 有効
 */
function handleGetMfDepartments() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("部門マスタ_MF");
    if (!sheet) {
      return { success: false, error: "部門マスタ_MFシートが見つかりません" };
    }

    var data = sheet.getDataRange().getValues();
    var departments = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[2]) continue;

      departments.push({
        mfId: String(row[0] || ""),
        code: String(row[1] || ""),
        name: String(row[2] || ""),
        searchKey: String(row[3] || ""),
        available: String(row[4] || "") === "○",
      });
    }

    return {
      success: true,
      data: { departments: departments },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// MF APIマスタ JSONキャッシュ（勘定科目・税区分・PJ・補助科目）
// ============================================

/**
 * MFマスタシートからJSONキャッシュを読取
 */
function handleGetMfMasters() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("MFマスタ");
    if (!sheet) {
      return { success: false, error: "MFマスタシートなし（MF認証後に自動作成）" };
    }

    var json = sheet.getRange("A2").getValue();
    if (!json) {
      return { success: false, error: "キャッシュデータなし" };
    }

    return {
      success: true,
      data: { masters: JSON.parse(json) },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * MFマスタシートにJSONキャッシュを保存
 */
function handleSaveMfMasters(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("MFマスタ");
    if (!sheet) {
      sheet = ss.insertSheet("MFマスタ");
      sheet.getRange("A1").setValue("masters_json");
      sheet.getRange("B1").setValue("synced_at");
    }

    var masters = data.masters;
    if (!masters) {
      return { success: false, error: "masters data is required" };
    }

    sheet.getRange("A2").setValue(JSON.stringify(masters));
    sheet.getRange("B2").setValue(masters.syncedAt || new Date().toISOString());

    return {
      success: true,
      data: { saved: true },
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

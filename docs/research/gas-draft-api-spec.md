# GAS 下書き保存API 実装仕様

## 概要
購買申請モーダルの下書きをGASスプレッドシートに永続保存する。
1か月経過した下書きは自動削除。

## シート: `下書き`

| 列 | 内容 |
|----|------|
| A | userId (Slack User ID) |
| B | draft (JSON文字列) |
| C | savedAt (ISO 8601) |

## API アクション

### `saveDraft` (POST)
```json
{
  "action": "saveDraft",
  "userId": "U12345",
  "draft": { "itemName": "...", "amount": 1000, ... }
}
```
- userId の既存行があれば上書き（UPSERT）
- なければ新規行を追加
- `savedAt` は現在時刻（ISO 8601）
- レスポン��: `{ "success": true }`

### `loadDraft` (GET)
```
?action=loadDraft&userId=U12345
```
- userId に一致する行を検索
- `savedAt` が1か月以上前なら削除して `null` を返す
- レスポンス: `{ "success": true, "data": { "draft": {...} } }`
- 見つか��ない場合: `{ "success": true, "data": { "draft": null } }`

### `clearDraft` (POST)
```json
{
  "action": "clearDraft",
  "userId": "U12345"
}
```
- userId に一致する行を削除
- レスポンス: `{ "success": true }`

## GAS実装例 (webApi.js に追加)

```javascript
// saveDraft
function handleSaveDraft_(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("下書き")
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet("下書き");
  const userId = params.userId;
  const draft = JSON.stringify(params.draft);
  const savedAt = new Date().toISOString();
  
  // 既存行を検索
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[draft, savedAt]]);
      return { success: true };
    }
  }
  // 新規追加
  sheet.appendRow([userId, draft, savedAt]);
  return { success: true };
}

// loadDraft
function handleLoadDraft_(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("下書き");
  if (!sheet) return { success: true, data: { draft: null } };
  
  const userId = params.userId;
  const data = sheet.getDataRange().getValues();
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === userId) {
      const savedAt = new Date(data[i][2]);
      if (savedAt < oneMonthAgo) {
        sheet.deleteRow(i + 1);
        return { success: true, data: { draft: null } };
      }
      return { success: true, data: { draft: JSON.parse(data[i][1]) } };
    }
  }
  return { success: true, data: { draft: null } };
}

// clearDraft
function handleClearDraft_(params) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("下書き");
  if (!sheet) return { success: true };
  
  const userId = params.userId;
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] === userId) {
      sheet.deleteRow(i + 1);
    }
  }
  return { success: true };
}
```

## webApi.js のルーティングに追加

```javascript
// doPost 内
case "saveDraft":   return respond_(handleSaveDraft_(params));
case "clearDraft":  return respond_(handleClearDraft_(params));

// doGet 内
case "loadDraft":   return respond_(handleLoadDraft_(params));
```

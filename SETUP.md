# POC セットアップ手順

## 前提条件
- Node.js 18+
- npm
- Slackワークスペースの管理権限（App作成のため）
- GitHubアカウント（Vercelデプロイ用）
- Vercelアカウント（無料 Hobbyプラン）

---

## Step 1: Slack App 作成

1. https://api.slack.com/apps にアクセス
2. **Create New App** > **From an app manifest** を選択
3. ワークスペースを選択
4. `slack-app-manifest.yml` の内容を貼り付け
   - この時点では `YOUR_VERCEL_DOMAIN` のままでOK（後で更新）
5. **Create** をクリック

### トークンの取得
1. 左メニュー **OAuth & Permissions** > **Install to Workspace**
2. 権限を許可
3. 以下をメモ:
   - **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
   - 左メニュー **Basic Information** > **Signing Secret** → `SLACK_SIGNING_SECRET`

---

## Step 2: Vercel デプロイ

### 方法A: GitHub経由（推奨）
1. このプロジェクトをGitHubリポジトリにpush
2. https://vercel.com/new でプロジェクトをインポート
3. Environment Variables に以下を設定:
   - `SLACK_BOT_TOKEN` = `xoxb-...`
   - `SLACK_SIGNING_SECRET` = `...`
4. **Deploy** をクリック

### 方法B: Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod
# Environment Variables の設定を促されたら上記を入力
```

### デプロイ後
デプロイURLを確認（例: `https://next-procurement-poc.vercel.app`）

---

## Step 3: Slack App の URL 更新

デプロイURL取得後、Slack App設定を更新:

1. https://api.slack.com/apps でアプリを選択
2. **Interactivity & Shortcuts**:
   - Request URL: `https://YOUR_VERCEL_DOMAIN/api/slack/events`
3. **Slash Commands** > `/po-test`:
   - Request URL: `https://YOUR_VERCEL_DOMAIN/api/slack/events`
4. （オプション）**Event Subscriptions**:
   - Request URL: `https://YOUR_VERCEL_DOMAIN/api/slack/events`
   - ※ URL Verification のチャレンジに自動応答します

---

## Step 4: 動作確認

### 4-1. ヘルスチェック
ブラウザで以下にアクセス:
```
https://YOUR_VERCEL_DOMAIN/api/test/health
```

期待されるレスポンス:
```json
{
  "ok": true,
  "timestamp": "2025-03-19T...",
  "env": {
    "hasSlackToken": true,
    "hasSigningSecret": true,
    "hasGasUrl": false
  }
}
```

### 4-2. Slackでテスト
Slackの任意のチャンネルで:
```
/po-test
```

期待される動作:
1. ボタン付きの購買申請メッセージが投稿される
2. [✅ 承認] ボタンを押す → メッセージが「承認済」に更新 + [🛒 発注完了] ボタンが表示
3. [🛒 発注完了] ボタンを押す → 「発注済」+ [✅ 検収完了] ボタンが表示
4. [✅ 検収完了] ボタンを押す → 「検収済・証憑待ち」+ スレッドに証憑添付依頼

### 4-3. GAS連携テスト（Step 5完了後）
```
GET https://YOUR_VERCEL_DOMAIN/api/test/gas
POST https://YOUR_VERCEL_DOMAIN/api/test/gas
```

---

## Step 5: GAS連携（オプション・POC-2）

### GAS側の準備
既存のProcurement-Assistantまたはテスト用GASプロジェクトに以下を追加:

```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // APIキー検証
  if (data.apiKey !== PropertiesService.getScriptProperties().getProperty('API_KEY')) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Unauthorized' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var result;

  switch (data.action) {
    case 'ping':
      result = { pong: true, timestamp: new Date().toISOString() };
      break;

    case 'updateStatus':
      // スプレッドシートのステータス更新
      result = updateSheetStatus(data.poNumber, data.status, data.updatedBy);
      break;

    case 'getRequest':
      result = getRequestByPoNumber(data.poNumber);
      break;

    default:
      result = { error: 'Unknown action: ' + data.action };
  }

  return ContentService.createTextOutput(
    JSON.stringify({ success: true, data: result })
  ).setMimeType(ContentService.MimeType.JSON);
}

function updateSheetStatus(poNumber, status, updatedBy) {
  // テスト用: 実際のスプレッドシート操作は既存コードを流用
  Logger.log('Status update: ' + poNumber + ' -> ' + status + ' by ' + updatedBy);
  return { updated: true, poNumber: poNumber, status: status };
}

function getRequestByPoNumber(poNumber) {
  // テスト用
  return { poNumber: poNumber, itemName: 'テスト品目', status: '承認待ち' };
}
```

### GAS デプロイ
1. GASエディタ > **デプロイ** > **新しいデプロイ**
2. 種類: **ウェブアプリ**
3. アクセスできるユーザー: **全員**
4. デプロイURL をコピー

### 環境変数追加
Vercelの Environment Variables に追加:
- `GAS_WEB_APP_URL` = GASのデプロイURL
- `GAS_API_KEY` = GAS側のスクリプトプロパティに設定したキー

---

## ファイル構成

```
next-procurement-poc/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── slack/
│   │   │   │   └── events/
│   │   │   │       └── route.ts    ← Slack統一エンドポイント
│   │   │   └── test/
│   │   │       ├── gas/
│   │   │       │   └── route.ts    ← GAS連携テスト
│   │   │       └── health/
│   │   │           └── route.ts    ← ヘルスチェック
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── lib/
│       ├── slack.ts                ← Slack操作（メッセージ構築・アクション処理）
│       └── gas-client.ts           ← GAS Web App連携クライアント
├── slack-app-manifest.yml          ← Slack Appマニフェスト
├── .env.local                      ← 環境変数（ローカル用）
├── SETUP.md                        ← このファイル
└── package.json
```

---

## トラブルシューティング

### ボタンを押しても反応しない
- Vercel Logsを確認（Vercelダッシュボード > Functions タブ）
- Slack App の Interactivity Request URL が正しいか確認
- `SLACK_SIGNING_SECRET` が正しいか確認

### /po-test コマンドが見つからない
- Slack App の Slash Commands にコマンドが登録されているか確認
- Request URL が正しいか確認
- Slackを再起動してキャッシュをクリア

### GAS連携でエラー
- GAS Web AppのURLが正しいか確認（末尾 `/exec`）
- GASのデプロイが「ウェブアプリ」で「全員」アクセス可能になっているか確認
- GASの実行ログを確認

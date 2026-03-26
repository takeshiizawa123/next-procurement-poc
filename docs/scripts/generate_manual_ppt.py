"""利用者向け運用マニュアル — Silicon Valley Style PPT (Final)"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

BG = RGBColor(0x0F, 0x0F, 0x1A)
CARD = RGBColor(0x1E, 0x29, 0x3B)
CYAN = RGBColor(0x00, 0xD4, 0xFF)
PURPLE = RGBColor(0x7C, 0x3A, 0xED)
PINK = RGBColor(0xEC, 0x48, 0x99)
GREEN = RGBColor(0x10, 0xB9, 0x81)
ORANGE = RGBColor(0xF5, 0x9E, 0x0B)
RED = RGBColor(0xEF, 0x44, 0x44)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT = RGBColor(0xE2, 0xE8, 0xF0)
MUTED = RGBColor(0x94, 0xA3, 0xB8)
SURFACE = RGBColor(0x1A, 0x1C, 0x2E)


def dbg(s):
    s.background.fill.solid(); s.background.fill.fore_color.rgb = BG


def hero(title, sub="", accent=CYAN):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    al = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.5), Inches(2.6), Inches(1.2), Pt(4))
    al.fill.solid(); al.fill.fore_color.rgb = accent; al.line.fill.background()
    t = s.shapes.add_textbox(Inches(1.5), Inches(2.8), Inches(10), Inches(2.5))
    t.text_frame.word_wrap = True
    t.text_frame.paragraphs[0].text = title
    t.text_frame.paragraphs[0].font.size = Pt(52); t.text_frame.paragraphs[0].font.bold = True
    t.text_frame.paragraphs[0].font.color.rgb = WHITE
    if sub:
        p2 = t.text_frame.add_paragraph()
        p2.text = sub; p2.font.size = Pt(22); p2.font.color.rgb = MUTED; p2.space_before = Pt(20)


def sec(num, title, accent=CYAN):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    nt = s.shapes.add_textbox(Inches(1.5), Inches(1.5), Inches(3), Inches(3))
    nt.text_frame.paragraphs[0].text = f"{num:02d}"
    nt.text_frame.paragraphs[0].font.size = Pt(120); nt.text_frame.paragraphs[0].font.bold = True
    nt.text_frame.paragraphs[0].font.color.rgb = accent
    tt = s.shapes.add_textbox(Inches(1.5), Inches(4.2), Inches(10), Inches(1.5))
    tt.text_frame.paragraphs[0].text = title
    tt.text_frame.paragraphs[0].font.size = Pt(40); tt.text_frame.paragraphs[0].font.bold = True
    tt.text_frame.paragraphs[0].font.color.rgb = WHITE


def bullets(title, items, accent=CYAN):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    t = s.shapes.add_textbox(Inches(1.5), Inches(0.7), Inches(10), Inches(1))
    t.text_frame.paragraphs[0].text = title
    t.text_frame.paragraphs[0].font.size = Pt(32); t.text_frame.paragraphs[0].font.bold = True
    t.text_frame.paragraphs[0].font.color.rgb = WHITE
    al = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.5), Inches(1.5), Inches(0.8), Pt(3))
    al.fill.solid(); al.fill.fore_color.rgb = accent; al.line.fill.background()
    ct = s.shapes.add_textbox(Inches(1.5), Inches(1.9), Inches(10.3), Inches(5))
    ct.text_frame.word_wrap = True
    for i, item in enumerate(items):
        p = ct.text_frame.paragraphs[0] if i == 0 else ct.text_frame.add_paragraph()
        if isinstance(item, tuple):
            p.text = item[0]; p.level = item[1]
            p.font.size = Pt(15 if item[1] > 0 else 20); p.font.color.rgb = MUTED if item[1] > 0 else LIGHT
        elif item == "":
            p.text = ""; p.font.size = Pt(8)
        else:
            p.text = item; p.font.size = Pt(20); p.font.color.rgb = LIGHT
        p.space_after = Pt(4)


def steps(title, data):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    t = s.shapes.add_textbox(Inches(1.5), Inches(0.7), Inches(10), Inches(1))
    t.text_frame.paragraphs[0].text = title
    t.text_frame.paragraphs[0].font.size = Pt(32); t.text_frame.paragraphs[0].font.bold = True
    t.text_frame.paragraphs[0].font.color.rgb = WHITE
    cw = Inches(3.8); ch = Inches(1.6); mg = Inches(0.3)
    colors = [CYAN, PURPLE, PINK, GREEN, ORANGE, RED]
    for i, (num, label, desc) in enumerate(data):
        col = i % 3; row = i // 3
        x = int(Inches(0.6) + col * (cw + mg)); y = int(Inches(1.8) + row * (ch + mg))
        bx = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, int(cw), int(ch))
        bx.fill.solid(); bx.fill.fore_color.rgb = CARD; bx.line.fill.background()
        ab = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, int(cw), Pt(3))
        ab.fill.solid(); ab.fill.fore_color.rgb = colors[i % len(colors)]; ab.line.fill.background()
        ci = s.shapes.add_shape(MSO_SHAPE.OVAL, x + int(Inches(0.15)), y + int(Inches(0.2)), int(Inches(0.45)), int(Inches(0.45)))
        ci.fill.solid(); ci.fill.fore_color.rgb = colors[i % len(colors)]; ci.line.fill.background()
        ci.text_frame.paragraphs[0].text = str(num)
        ci.text_frame.paragraphs[0].font.size = Pt(16); ci.text_frame.paragraphs[0].font.bold = True
        ci.text_frame.paragraphs[0].font.color.rgb = WHITE; ci.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
        ci.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
        lt = s.shapes.add_textbox(x + int(Inches(0.7)), y + int(Inches(0.15)), int(cw - Inches(0.9)), int(Inches(0.4)))
        lt.text_frame.paragraphs[0].text = label
        lt.text_frame.paragraphs[0].font.size = Pt(16); lt.text_frame.paragraphs[0].font.bold = True
        lt.text_frame.paragraphs[0].font.color.rgb = WHITE
        dt = s.shapes.add_textbox(x + int(Inches(0.15)), y + int(Inches(0.7)), int(cw - Inches(0.3)), int(ch - Inches(0.75)))
        dt.text_frame.word_wrap = True
        dt.text_frame.paragraphs[0].text = desc
        dt.text_frame.paragraphs[0].font.size = Pt(12); dt.text_frame.paragraphs[0].font.color.rgb = MUTED


def stat(title, cards):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    t = s.shapes.add_textbox(Inches(1.5), Inches(0.8), Inches(10), Inches(1))
    t.text_frame.paragraphs[0].text = title
    t.text_frame.paragraphs[0].font.size = Pt(28); t.text_frame.paragraphs[0].font.color.rgb = MUTED
    n = len(cards); cw = min(Inches(2.8), Inches(10.5) / n); gap = Inches(0.4)
    tw = n * cw + (n - 1) * gap; sx = (prs.slide_width - int(tw)) / 2
    for i, (val, lbl, clr) in enumerate(cards):
        x = int(sx) + i * (int(cw) + int(gap))
        bx = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, Inches(2.2), int(cw), Inches(3.5))
        bx.fill.solid(); bx.fill.fore_color.rgb = RGBColor(0x1E, 0x29, 0x3B); bx.line.fill.background()
        ab = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, Inches(2.2), int(cw), Pt(4))
        ab.fill.solid(); ab.fill.fore_color.rgb = clr; ab.line.fill.background()
        vt = s.shapes.add_textbox(x + Inches(0.3), Inches(2.8), int(cw) - Inches(0.6), Inches(1.5))
        vt.text_frame.paragraphs[0].text = val
        vt.text_frame.paragraphs[0].font.size = Pt(48); vt.text_frame.paragraphs[0].font.bold = True
        vt.text_frame.paragraphs[0].font.color.rgb = clr
        lt2 = s.shapes.add_textbox(x + Inches(0.3), Inches(4.3), int(cw) - Inches(0.6), Inches(1))
        lt2.text_frame.word_wrap = True
        lt2.text_frame.paragraphs[0].text = lbl
        lt2.text_frame.paragraphs[0].font.size = Pt(16); lt2.text_frame.paragraphs[0].font.color.rgb = LIGHT


def tbl(title, headers, rows, accent=CYAN):
    s = prs.slides.add_slide(prs.slide_layouts[6]); dbg(s)
    t = s.shapes.add_textbox(Inches(1.5), Inches(0.7), Inches(10), Inches(1))
    t.text_frame.paragraphs[0].text = title
    t.text_frame.paragraphs[0].font.size = Pt(32); t.text_frame.paragraphs[0].font.bold = True
    t.text_frame.paragraphs[0].font.color.rgb = WHITE
    cols = len(headers); n = len(rows) + 1
    ts = s.shapes.add_table(n, cols, Inches(1.2), Inches(1.7), Inches(10.9), Inches(0.45) * n)
    table = ts.table
    for j, h in enumerate(headers):
        c = table.cell(0, j); c.text = h
        c.fill.solid(); c.fill.fore_color.rgb = SURFACE
        for par in c.text_frame.paragraphs:
            par.font.size = Pt(13); par.font.bold = True; par.font.color.rgb = accent
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            c = table.cell(i + 1, j); c.text = str(v)
            c.fill.solid(); c.fill.fore_color.rgb = CARD if i % 2 == 0 else BG
            for par in c.text_frame.paragraphs:
                par.font.size = Pt(12); par.font.color.rgb = LIGHT


# ==================== SLIDES ====================

# --- Title ---
hero("購買申請システム\n利用者マニュアル", "Slack Bot + Webフォーム で購買申請から仕訳まで\nv0.2 — 2026-03-26")

# --- 01: 申請の出し方 ---
sec(1, "購買申請の出し方")

steps("Slackモーダルで申請", [
    (1, "/purchase を入力", "Slackの任意チャンネルで\nコマンドを送信"),
    (2, "入力方法を選択", "Slackモーダル（簡易）\nor Webフォーム（高機能）"),
    (3, "フォームに入力", "品目・金額・数量・支払方法\n・購入目的を入力"),
    (4, "送信", "#purchase-request に\n自動投稿されます"),
    (5, "承認を待つ", "部門長にDMで\n承認依頼が届きます"),
    (6, "番号を確認", "PR-0050 のような\n申請番号が発行されます"),
])

tbl("入力項目", ["項目", "必須", "説明", "入力例"],
    [
        ["申請区分", "★", "「購入前」or「購入済」", "購入前"],
        ["品目名", "★", "何を買うか", "会議用モニター"],
        ["単価（税抜）", "★", "1個の金額", "45,000"],
        ["数量", "★", "個数", "1"],
        ["支払方法", "★", "カード or 請求書", "会社カード"],
        ["購入先", "", "店舗/サイト名", "Amazon"],
        ["購入目的", "★", "利用目的", "業務利用"],
        ["商品URL", "", "自動で情報取得", "https://..."],
    ])

# --- 02: Webフォーム ---
sec(2, "Webフォームの機能", CYAN)

steps("Webフォーム: 4ステップ入力", [
    (1, "申請区分", "「購入前」or「購入済」\n購入済は証憑添付が必須に"),
    (2, "商品情報", "品目・金額・購入先\nURL貼付で自動取得"),
    (3, "詳細情報", "条件分岐で項目が変化\n承認ルートをプレビュー"),
    (4, "確認画面", "重複チェック + 勘定科目推定\n送信前に最終確認"),
])

bullets("入力支援機能", [
    "商品URL自動解析",
    ("URLを貼ると商品名・価格を自動取得", 1),
    ("対応: Amazon / モノタロウ / ASKUL / ヨドバシ / ビックカメラ", 1),
    ("Amazon がブロックした場合はURL文字列から商品名を推定（金額は手動）", 1),
    "",
    "購入先サジェスト — 過去の購入先から候補表示",
    "金額カンマ整形 — 離れると 45,000 に自動整形 + 合計リアルタイム計算",
    "条件分岐 — 区分・支払方法で項目が動的変化",
    "承認ルートプレビュー — 金額に応じた承認フローをリアルタイム表示",
], accent=CYAN)

bullets("高度な機能", [
    "一括申請（複数品目）",
    ("「品目を追加」ボタンで追加品目を入力 / 合計金額を自動計算", 1),
    "",
    "確認画面:",
    ("重複チェック — 類似申請がある場合に警告表示", 1),
    ("勘定科目推定 — 品目名から推定科目を自動表示（確度: 高/中/低）", 1),
    "",
    "その他:",
    ("下書き自動保存（0.5秒ごと / ブラウザ再訪問で復元）", 1),
    ("過去申請ワンクリック複製", 1),
    ("カメラ撮影対応（モバイル — 証憑を直接撮影）", 1),
    ("KATANA POサジェスト（在庫管理連携）", 1),
], accent=PURPLE)

# --- 03: ブックマークレット・URL解析 ---
sec(3, "ブックマークレット", PINK)

steps("ECサイトからワンクリック申請", [
    (1, "初回設定", "/bookmarklet ページから\nボタンをブックマークバーに\nドラッグ&ドロップ"),
    (2, "商品ページを開く", "Amazon等で購入したい\n商品のページを表示"),
    (3, "ブックマークをクリック", "ブックマークバーの\n「購買申請」を押す"),
    (4, "フォーム自動入力", "商品名・価格・購入先・URL\nが入力済みで開きます"),
    (5, "残りを入力して送信", "支払方法・数量等を\n追加して申請完了"),
])

tbl("URL解析 対応サイト", ["サイト", "商品名", "価格", "備考"],
    [
        ["Amazon.co.jp", "O", "O", "ブロック時はURL文字列から商品名を推定"],
        ["モノタロウ", "O", "O", "安定して取得可能"],
        ["ASKUL", "O", "O", "安定して取得可能"],
        ["ヨドバシ.com", "O", "O", ""],
        ["ビックカメラ", "O", "O", ""],
        ["その他", "タイトル", "-", "ブックマークレットの場合のみ"],
    ], accent=PINK)

# --- 04: 承認後の操作 ---
sec(4, "承認後の操作")

bullets("承認された場合", [
    "会社カード + 10万円未満（自分で発注）",
    ("DM: 「承認されました。発注してください」", 1),
    ("MFバーチャルカードで購入 → [発注完了] ボタン", 1),
    ("3日後に自動リマインドDMが届きます（押し忘れ防止）", 1),
    "",
    "会社カード + 10万円以上 / 請求書払い",
    ("管理本部が代行 — あなたの操作は不要です", 1),
    "",
    "差戻しの場合",
    ("DMで理由が届く → /purchase で再申請", 1),
    "",
    "取消: [取消] ボタン（発注前のみ）",
])

# --- 05: 検収と証憑 ---
sec(5, "検収と証憑の提出")

steps("検収 → 証憑提出", [
    (1, "物品の到着確認", "注文通りの内容か\n確認してください"),
    (2, "[検収完了] を押す", "#purchase-request の\n該当メッセージで実行"),
    (3, "証憑を用意", "納品書 or 領収書の\nPDF / 写真を準備"),
    (4, "スレッドに添付", "該当申請のスレッドに\nドラッグ&ドロップ"),
    (5, "Bot が自動検知", "種別判定 + OCR金額照合\n→ 結果がスレッドに表示"),
    (6, "完了!", "「あなたの作業は完了です」\n経理処理は管理本部が対応"),
])

bullets("証憑を出さないとどうなる？", [
    "証憑がないと仕訳・支払に進めません",
    "",
    "自動リマインド:",
    ("翌日 — DMで「証憑を提出してください」", 1),
    ("3日後 — スレッドに公開投稿（@メンション — 周りにも見えます）", 1),
    ("7日後 — 部門長にエスカレーション", 1),
    "",
    "次回の申請時、部門長の承認画面に「未提出一覧」が表示されます",
    "",
    "Webからも提出可能:",
    ("マイページ (/purchase/my) の [証憑UP] ボタンから直接アップロード", 1),
], accent=ORANGE)

# --- 06: 購入済（立替） ---
sec(6, "購入済申請（立替）", RED)

bullets("立替精算の手順と注意", [
    "/purchase → 申請区分: 「購入済」を選択",
    ("品目・金額を入力 + レシートを必ず添付", 1),
    ("承認 → 発注・検収スキップ → 「証憑待ち」", 1),
    "",
    "注意:",
    ("購入済は緊急時の例外措置です", 1),
    ("原則: 事前に /purchase → MFカードで購入", 1),
    ("証憑なしの購入済申請は処理されません", 1),
], accent=RED)

# --- 07: 承認者向け ---
sec(7, "承認者（部門長）向け", PURPLE)

bullets("承認者の操作ガイド", [
    "承認依頼: 部下の申請時にBot DMが届く",
    ("内容: 品目名・金額・購入先・支払方法", 1),
    "",
    "承認: [承認] ボタンを押すだけ（10秒）",
    ("DMからでも #purchase-request からでもOK", 1),
    ("10万以上は → 管理本部の二段階目に自動回付", 1),
    ("24時間放置するとリマインドDMが届きます", 1),
    "",
    "差戻し: [差戻し] → 理由入力 → 送信",
    "",
    "確認ポイント:",
    ("申請者の証憑未提出一覧が表示される場合あり", 1),
    ("未提出が多い → 先に提出を促してから承認を推奨", 1),
], accent=PURPLE)

# --- 08: 管理本部向け ---
sec(8, "管理本部向け", PINK)

bullets("管理本部の日常業務", [
    "毎朝 09:00: #purchase-ops 日次サマリ確認",
    ("🔴要対応 / 🟡フォロー要 / 🟢順調", 1),
    "",
    "発注処理: [開く] → 発注 → [発注完了]",
    ("対象: 10万以上 + 請求書払いのみ", 1),
    "",
    "仕訳登録: 証憑完了案件を MF会計Plus に登録",
    ("[仕訳登録] で自動ドラフト作成", 1),
    "",
    "週次: カード明細突合レポート（月曜 11:00）",
    ("未申請購入・承認前購入・金額不一致を自動検知", 1),
    "",
    "月次: CSV取込 / 仕訳一括 / コンプライアンスレビュー",
], accent=PINK)

# --- 09: マイページ・/mystatus ---
sec(9, "マイページと /mystatus", GREEN)

bullets("自分の申請状況を確認する", [
    "/mystatus コマンド（Slack）",
    ("Slackで /mystatus → 自分の未対応案件をDMでサマリ表示", 1),
    ("各案件に「次にやること」が表示される", 1),
    ("マイページへのリンクも含まれる", 1),
    "",
    "マイページ（Web: /purchase/my）",
    ("ページ上部に未対応事項ダッシュボード（黄色いアラート）", 1),
    ("発注未完了・証憑待ちは赤背景で優先表示", 1),
    ("証憑待ち案件は [証憑UP] ボタンからWeb上で直接提出", 1),
    ("フィルター: すべて / 進行中 / 完了", 1),
    ("各申請からSlackスレッドへジャンプ可能", 1),
], accent=GREEN)

# --- 10: 出張申請 ---
sec(10, "出張申請（/trip）", ORANGE)

steps("出張申請フロー", [
    (1, "/trip を入力", "Slackで\nコマンド送信"),
    (2, "モーダルに入力", "行き先・日程・目的\n交通手段・概算額"),
    (3, "送信", "#出張チャンネルに\n自動投稿"),
    (4, "予約する", "じゃらん / ANA Biz\n/ JAL Online"),
    (5, "MFカードで決済", "交通費・食事代も\nカードで"),
    (6, "精算は自動", "MF経費→管理本部\nが仕訳"),
])

bullets("宿泊・交通の手配", [
    "宿泊: じゃらんJCS（先行）/ 楽天Racco（後追い）",
    ("法人専用項目にプロジェクト番号を入力 / 会社宛て請求書払い", 1),
    "",
    "航空券: ANA Biz / JAL Online で法人予約",
    "新幹線: スマートEX → MFカード決済",
    "その他: タクシー・食事もMFカードで決済",
    "",
    "立替が発生した場合: /purchase → 「購入済」で申請",
], accent=ORANGE)

# --- FAQ ---
sec(11, "FAQ & 操作早見表", GREEN)

tbl("よくある質問", ["質問", "回答"],
    [
        ["申請を間違えた", "[取消] → 再申請（発注後は管理本部に連絡）"],
        ["証憑を紛失した", "管理本部に相談（カード明細スクショで代替可）"],
        ["承認が来ない", "部門長にSlackで確認（24時間後に自動リマインド）"],
        ["10万以上を自分で買いたい", "不可（管理本部が発注 — 固定資産管理ルール）"],
        ["複数品目を一括申請", "Webフォームの「品目追加」で可能"],
        ["自分の申請状況を見たい", "/mystatus コマンド or マイページ (/purchase/my)"],
        ["Slackが使えない時の証憑提出", "マイページの [証憑UP] ボタンから"],
    ], accent=GREEN)

tbl("操作早見表", ["やりたいこと", "操作"],
    [
        ["購買申請", "/purchase → モーダル or Webフォーム"],
        ["出張申請", "/trip → モーダル"],
        ["自分の状況確認", "/mystatus or マイページ (/purchase/my)"],
        ["承認する", "DM or #purchase-request の [承認]"],
        ["発注完了", "[発注完了] ボタン"],
        ["検収完了", "[検収完了] ボタン"],
        ["証憑提出", "スレッドにD&D or マイページ [証憑UP]"],
        ["ブックマークレットで申請", "商品ページでブックマーク→自動入力"],
        ["取消", "[取消] ボタン（発注前のみ）"],
    ], accent=CYAN)

# --- End ---
hero("ご不明点は\n管理本部まで", "#purchase-ops チャンネル または DM", PURPLE)

out = "C:/Users/takeshi.izawa/.claude/projects/next-procurement-poc/docs/user-manual-final.pptx"
prs.save(out)
print(f"Saved: {out}")

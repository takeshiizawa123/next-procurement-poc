"use client";

import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useActionState,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";

type FormState = {
  ok: boolean;
  message: string;
  poNumber?: string;
} | null;

// --- 下書き保存 (localStorage) ---

const DRAFT_KEY = "purchase_form_draft";

interface DraftData {
  request_type: string;
  item_name: string;
  amount: string;
  quantity: string;
  payment_method: string;
  supplier_name: string;
  url: string;
  asset_usage: string;
  katana_po: string;
  hubspot_deal_id: string;
  budget_number: string;
  notes: string;
  savedAt: string;
}

function saveDraft(data: Partial<DraftData>) {
  try {
    const existing = loadDraft();
    const merged = { ...existing, ...data, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable
  }
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // noop
  }
}

// --- 金額フォーマット ---

function formatCurrency(value: number): string {
  if (!value || isNaN(value)) return "";
  return `¥${value.toLocaleString()}`;
}

// --- submitPurchase ---

async function submitPurchase(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const res = await fetch("/api/purchase/submit", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, message: data.error || "送信に失敗しました" };
    }
    clearDraft();
    return {
      ok: true,
      message: "申請が完了しました",
      poNumber: data.poNumber,
    };
  } catch {
    return { ok: false, message: "通信エラーが発生しました" };
  }
}

// --- ファイルアップロードUI ---

interface FileItem {
  file: File;
  preview: string | null;
}

function FileUpload({ required }: { required: boolean }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    const items: FileItem[] = Array.from(newFiles).map((file) => ({
      file,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  return (
    <div>
      {files.map((item, i) => {
        const dt = new DataTransfer();
        dt.items.add(item.file);
        return (
          <input
            key={`input-${i}`}
            type="file"
            name="vouchers"
            style={{ display: "none" }}
            ref={(el) => {
              if (el) el.files = dt.files;
            }}
          />
        );
      })}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
      >
        <p className="text-gray-500">
          📎 ファイルをドラッグ&ドロップ、またはクリックして選択
        </p>
        <p className="text-xs text-gray-400 mt-1">
          画像・PDF・Excel対応（複数可）
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.xlsx,.xls,.csv"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {required && files.length === 0 && (
        <input
          type="text"
          required
          value=""
          readOnly
          className="hidden"
          tabIndex={-1}
        />
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((item, i) => (
            <li
              key={i}
              className="flex items-center gap-3 bg-gray-50 rounded-lg p-2"
            >
              {item.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.preview}
                  alt=""
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <span className="w-12 h-12 flex items-center justify-center bg-gray-200 rounded text-lg">
                  {item.file.name.endsWith(".pdf") ? "📄" : "📊"}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{item.file.name}</p>
                <p className="text-xs text-gray-400">
                  {(item.file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="text-red-400 hover:text-red-600 px-2"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- 確認画面 ---

interface FormValues {
  requestType: string;
  itemName: string;
  amount: number;
  quantity: number;
  totalAmount: number;
  paymentMethod: string;
  supplierName: string;
  url: string;
  assetUsage: string;
  katanaPo: string;
  hubspotDealId: string;
  budgetNumber: string;
  notes: string;
}

function ConfirmationView({
  values,
  onBack,
  onSubmit,
  pending,
}: {
  values: FormValues;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const rows: [string, string][] = [
    ["申請区分", values.requestType],
    ["品目名", values.itemName],
    ["単価", formatCurrency(values.amount)],
    ["数量", String(values.quantity)],
    ["合計金額", formatCurrency(values.totalAmount)],
    ["支払方法", values.paymentMethod],
    ["購入先名", values.supplierName],
  ];
  if (values.url) rows.push(["購入先URL", values.url]);
  if (values.assetUsage) rows.push(["購入品の用途", values.assetUsage]);
  if (values.katanaPo) rows.push(["KATANA PO番号", values.katanaPo]);
  if (values.hubspotDealId)
    rows.push(["HubSpot案件番号", values.hubspotDealId]);
  if (values.budgetNumber) rows.push(["実行予算番号", values.budgetNumber]);
  if (values.notes) rows.push(["購入理由", values.notes]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">申請内容の確認</h2>
      <div className="bg-gray-50 rounded-lg divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex px-4 py-3">
            <span className="text-sm text-gray-500 w-32 shrink-0">
              {label}
            </span>
            <span className="text-sm font-medium break-all">{value}</span>
          </div>
        ))}
      </div>

      {values.totalAmount >= 100000 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          この申請は10万円以上のため、部門長承認が必要です。
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 px-4 border-2 border-gray-300 rounded-lg font-bold hover:bg-gray-50"
        >
          修正する
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          className="flex-1 py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {pending ? "送信中..." : "この内容で申請する"}
        </button>
      </div>
    </div>
  );
}

// --- メインフォーム ---

function PurchaseFormInner() {
  const params = useSearchParams();
  const userId = params.get("user_id") || "";
  const channelId = params.get("channel_id") || "";

  const [state, action, pending] = useActionState(submitPurchase, null);
  const formRef = useRef<HTMLFormElement>(null);

  // 従業員マスタ
  type Employee = { name: string; departmentCode: string; departmentName: string; slackAliases: string };
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // 購入先サジェスト
  const [supplierSuggestions, setSupplierSuggestions] = useState<string[]>([]);

  // フォーム state
  const [requestType, setRequestType] = useState("");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState(0);
  const [amountDisplay, setAmountDisplay] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [url, setUrl] = useState("");
  const [assetUsage, setAssetUsage] = useState("");
  const [katanaPo, setKatanaPo] = useState("");
  const [hubspotDealId, setHubspotDealId] = useState("");
  const [budgetNumber, setBudgetNumber] = useState("");
  const [notes, setNotes] = useState("");

  // URL解析
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlResult, setUrlResult] = useState<{
    title: string;
    price: number | null;
    siteName: string;
  } | null>(null);

  // 確認画面
  const [showConfirm, setShowConfirm] = useState(false);

  // 重複チェック
  type Duplicate = { prNumber: string; itemName: string; totalAmount: number; applicationDate: string; applicant: string; status: string };
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [dupChecked, setDupChecked] = useState(false);

  // 過去申請複製
  type PastRequest = { prNumber: string; applicationDate: string; itemName: string; totalAmount: number; unitPrice: number; quantity: number; supplierName: string; supplierUrl: string; paymentMethod: string; purpose: string };
  const [pastRequests, setPastRequests] = useState<PastRequest[]>([]);
  const [showPastRequests, setShowPastRequests] = useState(false);
  const [pastLoading, setPastLoading] = useState(false);

  // 承認ルートプレビュー
  type ApprovalStep = { role: string; name: string; slackId: string };
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [approvalSummary, setApprovalSummary] = useState("");
  const [requiresDeptHead, setRequiresDeptHead] = useState(false);

  // 下書き復元通知
  const [draftRestored, setDraftRestored] = useState(false);

  const isPurchased = requestType === "購入済";
  const totalAmount = amount * quantity;
  const isHighValue = totalAmount >= 100000;

  // 従業員マスタ・購入先一覧を取得
  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d: { employees?: Employee[] }) => {
        if (d.employees) setEmployees(d.employees);
      })
      .catch(() => {});
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((d: { suppliers?: string[] }) => {
        if (d.suppliers) setSupplierSuggestions(d.suppliers);
      })
      .catch(() => {});
  }, []);

  // 承認ルート取得（金額・区分が変わるたび）
  useEffect(() => {
    if (!requestType) return;
    const params = new URLSearchParams({
      amount: String(totalAmount),
      isPurchased: String(isPurchased),
    });
    fetch(`/api/purchase/approval-route?${params}`)
      .then((r) => r.json())
      .then((d: { steps?: ApprovalStep[]; summary?: string; requiresDeptHead?: boolean }) => {
        setApprovalSteps(d.steps || []);
        setApprovalSummary(d.summary || "");
        setRequiresDeptHead(d.requiresDeptHead || false);
      })
      .catch(() => {});
  }, [totalAmount, isPurchased, requestType]);

  // 下書き復元 or クエリパラメータからの自動入力（初回マウント時）
  useEffect(() => {
    // クエリパラメータからの自動入力（Bookmarklet等から）
    const qItemName = params.get("item_name");
    const qPrice = params.get("price");
    const qSupplier = params.get("supplier_name");
    const qUrl = params.get("url");
    const qRequestType = params.get("request_type");

    if (qItemName || qPrice || qSupplier || qUrl) {
      if (qItemName) setItemName(qItemName);
      if (qPrice) {
        const v = parseInt(qPrice.replace(/[,，￥¥]/g, ""), 10) || 0;
        if (v > 0) {
          setAmount(v);
          setAmountDisplay(v.toLocaleString());
        }
      }
      if (qSupplier) setSupplierName(qSupplier);
      if (qUrl) setUrl(qUrl);
      if (qRequestType) setRequestType(qRequestType);
      return; // クエリパラメータがある場合は下書き復元をスキップ
    }

    // 下書き復元
    const draft = loadDraft();
    if (!draft) return;

    if (draft.request_type) setRequestType(draft.request_type);
    if (draft.item_name) setItemName(draft.item_name);
    if (draft.amount) {
      const v = parseInt(draft.amount) || 0;
      setAmount(v);
      setAmountDisplay(draft.amount);
    }
    if (draft.quantity) setQuantity(parseInt(draft.quantity) || 1);
    if (draft.payment_method) setPaymentMethod(draft.payment_method);
    if (draft.supplier_name) setSupplierName(draft.supplier_name);
    if (draft.url) setUrl(draft.url);
    if (draft.asset_usage) setAssetUsage(draft.asset_usage);
    if (draft.katana_po) setKatanaPo(draft.katana_po);
    if (draft.hubspot_deal_id) setHubspotDealId(draft.hubspot_deal_id);
    if (draft.budget_number) setBudgetNumber(draft.budget_number);
    if (draft.notes) setNotes(draft.notes);
    setDraftRestored(true);
  }, [params]);

  // 下書き自動保存（値変更時）
  useEffect(() => {
    if (!requestType && !itemName && !amount) return;
    const timer = setTimeout(() => {
      saveDraft({
        request_type: requestType,
        item_name: itemName,
        amount: String(amount),
        quantity: String(quantity),
        payment_method: paymentMethod,
        supplier_name: supplierName,
        url,
        asset_usage: assetUsage,
        katana_po: katanaPo,
        hubspot_deal_id: hubspotDealId,
        budget_number: budgetNumber,
        notes,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    requestType, itemName, amount, quantity, paymentMethod,
    supplierName, url, assetUsage, katanaPo, hubspotDealId,
    budgetNumber, notes,
  ]);

  // 金額入力ハンドラー（カンマフォーマット）
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[,，\s¥]/g, "");
    const num = parseInt(raw) || 0;
    setAmount(num);
    setAmountDisplay(raw);
  };

  const handleAmountBlur = () => {
    if (amount > 0) {
      setAmountDisplay(amount.toLocaleString());
    }
  };

  const handleAmountFocus = () => {
    if (amount > 0) {
      setAmountDisplay(String(amount));
    }
  };

  // 確認画面 → 送信
  const handleConfirmSubmit = () => {
    formRef.current?.requestSubmit();
  };

  // 過去申請一覧を取得
  const loadPastRequests = async () => {
    setPastLoading(true);
    try {
      const res = await fetch("/api/purchase/recent?limit=20");
      const data = await res.json();
      setPastRequests(data.requests || []);
      setShowPastRequests(true);
    } catch {
      setPastRequests([]);
    } finally {
      setPastLoading(false);
    }
  };

  // 過去申請からフォームに値を複製
  const applyPastRequest = (req: PastRequest) => {
    setItemName(req.itemName);
    if (req.unitPrice > 0) {
      setAmount(req.unitPrice);
      setAmountDisplay(req.unitPrice.toLocaleString());
    } else if (req.totalAmount > 0) {
      setAmount(req.totalAmount);
      setAmountDisplay(req.totalAmount.toLocaleString());
    }
    setQuantity(req.quantity || 1);
    setSupplierName(req.supplierName);
    setUrl(req.supplierUrl);
    setPaymentMethod(req.paymentMethod);
    setAssetUsage(req.purpose);
    setShowPastRequests(false);
  };

  // フォームsubmit前に確認画面を挟む（重複チェック付き）
  const handleFormAction = async (formData: FormData) => {
    if (!showConfirm) {
      // 確認画面表示前に重複チェック
      try {
        const params = new URLSearchParams({ itemName });
        if (totalAmount > 0) params.set("totalAmount", String(totalAmount));
        const res = await fetch(`/api/purchase/check-duplicate?${params}`);
        const data = await res.json();
        setDuplicates(data.duplicates || []);
        setDupChecked(true);
      } catch {
        setDuplicates([]);
        setDupChecked(true);
      }
      setShowConfirm(true);
      return;
    }
    return action(formData);
  };

  if (!userId && employees.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
          <p className="font-bold">読み込み中...</p>
          <p>従業員マスタを取得しています。しばらくお待ちください。</p>
        </div>
      </div>
    );
  }

  if (state?.ok) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-lg font-bold text-green-800">{state.message}</p>
          {state.poNumber && (
            <p className="text-green-700 mt-2">PO番号: {state.poNumber}</p>
          )}
          <p className="text-sm text-green-600 mt-4">
            Slackチャンネルに申請メッセージが投稿されました。
          </p>
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">購買申請</h1>

      {/* 下書き復元通知 */}
      {draftRestored && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-blue-800">
            前回の入力内容を復元しました
          </span>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              setDraftRestored(false);
              setRequestType("");
              setItemName("");
              setAmount(0);
              setAmountDisplay("");
              setQuantity(1);
              setPaymentMethod("");
              setSupplierName("");
              setUrl("");
              setAssetUsage("");
              setKatanaPo("");
              setHubspotDealId("");
              setBudgetNumber("");
              setNotes("");
            }}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            クリア
          </button>
        </div>
      )}

      {state?.ok === false && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-800">
          {state.message}
        </div>
      )}

      <form ref={formRef} action={handleFormAction} className="space-y-5">
        <input type="hidden" name="user_id" value={userId || selectedEmployee?.name || ""} />
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="applicant_name" value={selectedEmployee?.name || ""} />
        <input type="hidden" name="department" value={selectedEmployee?.departmentName || ""} />
        {/* hidden: 確認画面でDOMから消えるフィールドの値を保持 */}
        <input type="hidden" name="request_type" value={requestType} />
        <input type="hidden" name="item_name" value={itemName} />
        <input type="hidden" name="amount" value={amount || ""} />
        <input type="hidden" name="quantity" value={quantity} />
        <input type="hidden" name="payment_method" value={paymentMethod} />
        <input type="hidden" name="supplier_name" value={supplierName} />
        <input type="hidden" name="url" value={url} />
        <input type="hidden" name="asset_usage" value={assetUsage} />
        <input type="hidden" name="katana_po" value={katanaPo} />
        <input type="hidden" name="hubspot_deal_id" value={hubspotDealId} />
        <input type="hidden" name="budget_number" value={budgetNumber} />
        <input type="hidden" name="notes" value={notes} />

        {/* 確認画面 */}
        {showConfirm ? (
          <>
            {/* 重複警告 */}
            {dupChecked && duplicates.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4">
                <p className="font-bold text-amber-800 mb-2">
                  類似の申請が {duplicates.length} 件見つかりました
                </p>
                <ul className="text-sm text-amber-700 space-y-1">
                  {duplicates.map((d) => (
                    <li key={d.prNumber}>
                      {d.prNumber} — {d.itemName}（{d.totalAmount ? `¥${d.totalAmount.toLocaleString()}` : ""}）{d.applicationDate} {d.applicant} [{d.status}]
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-2">
                  重複でない場合はそのまま送信してください
                </p>
              </div>
            )}
          <ConfirmationView
            values={{
              requestType,
              itemName,
              amount,
              quantity,
              totalAmount,
              paymentMethod,
              supplierName,
              url,
              assetUsage,
              katanaPo,
              hubspotDealId,
              budgetNumber,
              notes,
            }}
            onBack={() => { setShowConfirm(false); setDupChecked(false); }}
            onSubmit={handleConfirmSubmit}
            pending={pending}
          />
          </>
        ) : (
          <>
            {/* 過去の申請から入力 */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={loadPastRequests}
                disabled={pastLoading}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                {pastLoading ? "読み込み中..." : "過去の申請から入力"}
              </button>
            </div>

            {/* 過去申請一覧モーダル */}
            {showPastRequests && pastRequests.length > 0 && (
              <div className="bg-gray-50 border rounded-lg p-3 max-h-60 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium">過去の申請（クリックで入力）</p>
                  <button
                    type="button"
                    onClick={() => setShowPastRequests(false)}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                  >&times;</button>
                </div>
                <ul className="space-y-1">
                  {pastRequests.map((req) => (
                    <li key={req.prNumber}>
                      <button
                        type="button"
                        onClick={() => applyPastRequest(req)}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-50 text-sm transition-colors"
                      >
                        <span className="font-medium">{req.itemName}</span>
                        <span className="text-gray-500 ml-2">
                          ¥{req.totalAmount.toLocaleString()} — {req.supplierName}
                        </span>
                        <span className="text-gray-400 ml-2 text-xs">{req.applicationDate}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {showPastRequests && pastRequests.length === 0 && !pastLoading && (
              <div className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-500">
                過去の申請が見つかりませんでした
              </div>
            )}

            {/* 申請者（user_idがない場合は従業員マスタから選択） */}
            {!userId && employees.length > 0 && (
              <fieldset>
                <legend className="block text-sm font-medium mb-1">
                  申請者 <span className="text-red-500">*</span>
                </legend>
                <select
                  required
                  value={selectedEmployee?.name || ""}
                  onChange={(e) => {
                    const emp = employees.find((x) => x.name === e.target.value);
                    setSelectedEmployee(emp || null);
                  }}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">選択してください</option>
                  {employees.map((emp) => (
                    <option key={emp.name} value={emp.name}>
                      {emp.name}（{emp.departmentName}）
                    </option>
                  ))}
                </select>
              </fieldset>
            )}

            {/* userId経由の場合：選択された従業員情報を表示 */}
            {userId && selectedEmployee && (
              <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm text-blue-800">
                申請者: {selectedEmployee.name}（{selectedEmployee.departmentName}）
              </div>
            )}

            {/* 申請区分 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                申請区分 <span className="text-red-500">*</span>
              </legend>
              <div className="flex gap-3 sm:gap-4">
                {["購入前", "購入済"].map((v) => (
                  <label
                    key={v}
                    className={`flex-1 text-center py-3 rounded-lg border-2 cursor-pointer transition-colors text-sm sm:text-base ${
                      requestType === v
                        ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="request_type"
                      value={v}
                      required
                      checked={requestType === v}
                      className="sr-only"
                      onChange={(e) => setRequestType(e.target.value)}
                    />
                    {v === "購入前" ? "🛒 購入前" : "📦 購入済"}
                  </label>
                ))}
              </div>
              {isPurchased && (
                <p className="text-sm text-amber-600 mt-2">
                  ⚡
                  購入済のため承認・発注ステップはスキップされます。証憑の添付が必須です。
                </p>
              )}
            </fieldset>

            {/* 品目名 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                品目名 <span className="text-red-500">*</span>
              </legend>
              <input
                type="text"
                name="item_name"
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="例: ノートPC、モニター等"
                className="w-full border rounded-lg px-3 py-2"
              />
            </fieldset>

            {/* 金額・数量・合計 */}
            <div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <fieldset>
                  <legend className="block text-sm font-medium mb-1">
                    単価（税込・円） <span className="text-red-500">*</span>
                  </legend>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={amountDisplay}
                    onChange={handleAmountChange}
                    onBlur={handleAmountBlur}
                    onFocus={handleAmountFocus}
                    placeholder="165,000"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </fieldset>
                <fieldset>
                  <legend className="block text-sm font-medium mb-1">
                    数量 <span className="text-red-500">*</span>
                  </legend>
                  <input
                    type="number"
                    name="quantity"
                    required
                    min="1"
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(parseInt(e.target.value) || 1)
                    }
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </fieldset>
              </div>
              {totalAmount > 0 && (
                <div
                  className={`mt-2 text-right text-base sm:text-lg font-bold ${isHighValue ? "text-red-600" : "text-gray-700"}`}
                >
                  合計: {formatCurrency(totalAmount)}
                  {isHighValue && (
                    <span className="block sm:inline text-xs sm:text-sm font-normal text-red-500 sm:ml-2">
                      （10万円以上: 用途・理由の入力が必要です）
                    </span>
                  )}
                </div>
              )}

              {/* 承認ルートプレビュー */}
              {requestType && approvalSummary && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${requiresDeptHead ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${requiresDeptHead ? "text-red-700" : "text-blue-700"}`}>
                      承認ルート:
                    </span>
                    {isPurchased ? (
                      <span className="text-gray-500">承認不要（購入済）</span>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap">
                        {approvalSteps.map((step, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="text-gray-400">→</span>}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${step.slackId ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                              {step.role}: {step.name}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 支払方法 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                支払方法 <span className="text-red-500">*</span>
              </legend>
              <select
                name="payment_method"
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 bg-white"
              >
                <option value="">選択してください</option>
                <option value="会社カード">会社カード</option>
                <option value="請求書払い">請求書払い</option>
                <option value="立替">立替</option>
              </select>
            </fieldset>

            {/* 購入先名 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                購入先名 <span className="text-red-500">*</span>
              </legend>
              <input
                type="text"
                name="supplier_name"
                required
                list="supplier-list"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="例: Amazon、モノタロウ、ASKUL等"
                className="w-full border rounded-lg px-3 py-2"
              />
              {supplierSuggestions.length > 0 && (
                <datalist id="supplier-list">
                  {supplierSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Amazonマーケットプレイスの場合は出品者名を記入してください
              </p>
            </fieldset>

            {/* 購入先URL + 自動解析 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                購入先URL
              </legend>
              <input
                type="url"
                name="url"
                value={url}
                onChange={(e) => {
                  const v = e.target.value;
                  setUrl(v);
                  setUrlResult(null);
                }}
                onPaste={(e) => {
                  // 貼り付け時に自動解析
                  const pasted = e.clipboardData.getData("text");
                  if (pasted && /^https?:\/\/.+/.test(pasted.trim())) {
                    const pastedUrl = pasted.trim();
                    setUrl(pastedUrl);
                    setUrlLoading(true);
                    setUrlResult(null);
                    fetch(`/api/util/ogp?url=${encodeURIComponent(pastedUrl)}`)
                      .then((r) => r.json())
                      .then((data) => {
                        if (data.title || data.price) {
                          setUrlResult({
                            title: data.title || "",
                            price: data.price,
                            siteName: data.siteName || "",
                          });
                          // 品名・価格を自動入力
                          if (data.title && !itemName) {
                            setItemName(data.title);
                          }
                          if (data.price && !amount) {
                            setAmount(data.price);
                            setAmountDisplay(data.price.toLocaleString());
                          }
                        }
                        // 購入先名を自動設定
                        if (data.siteName && !supplierName) {
                          setSupplierName(data.siteName);
                        }
                      })
                      .catch(() => {})
                      .finally(() => setUrlLoading(false));
                    e.preventDefault();
                  }
                }}
                placeholder="https://www.amazon.co.jp/... （貼り付けで自動解析）"
                className="w-full border rounded-lg px-3 py-2"
              />

              {urlLoading && (
                <p className="text-xs text-blue-500 mt-1 animate-pulse">
                  商品情報を取得中...
                </p>
              )}

              {urlResult && (
                <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    {urlResult.siteName && `${urlResult.siteName}: `}商品情報を取得しました
                  </p>
                  {urlResult.title && (
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600 truncate mr-2">
                        {urlResult.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => setItemName(urlResult.title)}
                        className="shrink-0 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        品目名に反映
                      </button>
                    </div>
                  )}
                  {urlResult.price && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        {formatCurrency(urlResult.price)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAmount(urlResult.price!);
                          setAmountDisplay(
                            urlResult.price!.toLocaleString(),
                          );
                        }}
                        className="shrink-0 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        金額に反映
                      </button>
                    </div>
                  )}
                  {urlResult.title && urlResult.price && (
                    <button
                      type="button"
                      onClick={() => {
                        setItemName(urlResult.title);
                        setAmount(urlResult.price!);
                        setAmountDisplay(urlResult.price!.toLocaleString());
                        if (urlResult.siteName && !supplierName) {
                          setSupplierName(urlResult.siteName);
                        }
                      }}
                      className="mt-2 w-full text-sm py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      すべて反映
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            {/* 購入品の用途 — 10万以上で必須化 */}
            {(isHighValue || !requestType) && (
              <fieldset>
                <legend className="block text-sm font-medium mb-1">
                  購入品の用途
                  {isHighValue && <span className="text-red-500"> *</span>}
                </legend>
                <select
                  name="asset_usage"
                  required={isHighValue}
                  value={assetUsage}
                  onChange={(e) => setAssetUsage(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="">選択してください</option>
                  <option value="顧客案件">
                    顧客案件に使用する（納品・組込等）
                  </option>
                  <option value="社内使用">社内で使用する</option>
                  <option value="予備品">予備品として保管する</option>
                </select>
              </fieldset>
            )}

            {/* KATANA PO番号 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                KATANA PO番号
              </legend>
              <input
                type="text"
                name="katana_po"
                value={katanaPo}
                onChange={(e) => setKatanaPo(e.target.value)}
                placeholder="例: PO-12345"
                className="w-full border rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                製品部品の場合に入力
              </p>
            </fieldset>

            {/* HubSpot案件番号 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                HubSpot案件番号
              </legend>
              <input
                type="text"
                name="hubspot_deal_id"
                value={hubspotDealId}
                onChange={(e) => setHubspotDealId(e.target.value)}
                placeholder="例: 12345678"
                className="w-full border rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                案件利用でプロジェクトコードを持っている場合は必ず入力
              </p>
            </fieldset>

            {/* 実行予算番号 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                実行予算番号
              </legend>
              <input
                type="text"
                name="budget_number"
                value={budgetNumber}
                onChange={(e) => setBudgetNumber(e.target.value)}
                placeholder="あれば入力"
                className="w-full border rounded-lg px-3 py-2"
              />
            </fieldset>

            {/* 購入理由 — 10万以上で必須化 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                購入理由
                {isHighValue && <span className="text-red-500"> *</span>}
              </legend>
              <textarea
                name="notes"
                rows={3}
                required={isHighValue}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="購入の目的・理由を記入"
                className="w-full border rounded-lg px-3 py-2"
              />
              {isHighValue ? (
                <p className="text-xs text-red-500 mt-1">
                  10万円以上のため必須です
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  単価10万円以上、または案件外の購入は必ず記入してください
                </p>
              )}
            </fieldset>

            {/* 証憑アップロード */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                証憑（納品書・領収書等）
                {isPurchased && <span className="text-red-500"> *</span>}
              </legend>
              {isPurchased && (
                <p className="text-sm text-red-500 mb-2">
                  購入済のため証憑の添付が必須です
                </p>
              )}
              <FileUpload required={isPurchased} />
              {!isPurchased && (
                <p className="text-xs text-gray-500 mt-2">
                  購入前の場合は後からSlackスレッドに添付することもできます
                </p>
              )}
            </fieldset>

            <button
              type="submit"
              disabled={pending}
              className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              確認画面へ
            </button>

            {/* 下書き保存の案内 */}
            <p className="text-xs text-center text-gray-400">
              入力内容は自動的に下書き保存されます
            </p>
          </>
        )}
      </form>
    </div>
  );
}

export default function PurchaseNewPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto p-6 text-center text-gray-500">
          読み込み中...
        </div>
      }
    >
      <PurchaseFormInner />
    </Suspense>
  );
}

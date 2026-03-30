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
import { apiFetch } from "@/lib/api-client";

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
    const res = await apiFetch("/api/purchase/submit", {
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

interface ExtraItemValue { itemName: string; amount: number; quantity: number; url: string }

interface FormValues {
  requestType: string;
  itemName: string;
  amount: number;
  quantity: number;
  totalAmount: number;
  paymentMethod: string;
  supplierName: string;
  inspectorName: string;
  url: string;
  assetUsage: string;
  katanaPo: string;
  hubspotDealId: string;
  budgetNumber: string;
  notes: string;
  extraItems?: ExtraItemValue[];
  allItemsTotal?: number;
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
  if (values.inspectorName) rows.push(["検収者", values.inspectorName]);
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

      {/* 追加品目 */}
      {values.extraItems && values.extraItems.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-sm font-medium text-blue-800 mb-2">追加品目（{values.extraItems.length}件）</p>
          {values.extraItems.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-1 border-b border-blue-100 last:border-0">
              <span>{item.itemName}</span>
              <span className="text-gray-600">
                {formatCurrency(item.amount)} × {item.quantity} = {formatCurrency(item.amount * item.quantity)}
              </span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-blue-200">
            <span>全品目合計</span>
            <span>{formatCurrency(values.allItemsTotal || values.totalAmount)}</span>
          </div>
        </div>
      )}

      {values.requestType !== "購入済" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          この申請は部門長の承認が必要です。{(values.allItemsTotal || values.totalAmount) >= 100000 ? "（10万円以上: 固定資産登録の確認対象）" : ""}
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

  // KATANA POサジェスト
  type KatanaPO = { id: number; poNumber: string; supplierName: string; status: string; total: number };
  const [katanaPOs, setKatanaPOs] = useState<KatanaPO[]>([]);
  const [katanaLoading, setKatanaLoading] = useState(false);
  const [showKatanaSuggest, setShowKatanaSuggest] = useState(false);

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
  const [inspectorName, setInspectorName] = useState("");

  // 追加品目（一括申請用）
  type ExtraItem = { itemName: string; amount: number; amountDisplay: string; quantity: number; url: string };
  const [extraItems, setExtraItems] = useState<ExtraItem[]>([]);

  const addExtraItem = () => {
    setExtraItems([...extraItems, { itemName: "", amount: 0, amountDisplay: "", quantity: 1, url: "" }]);
  };
  const removeExtraItem = (idx: number) => {
    setExtraItems(extraItems.filter((_, i) => i !== idx));
  };
  const updateExtraItem = (idx: number, field: keyof ExtraItem, value: string | number) => {
    setExtraItems(extraItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  // 全品目の合計
  const allItemsTotal = (amount * quantity) + extraItems.reduce((s, e) => s + (e.amount * e.quantity), 0);

  // URL解析
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlResult, setUrlResult] = useState<{
    title: string;
    price: number | null;
    siteName: string;
  } | null>(null);

  // ステップ管理（1: 申請区分, 2: 商品情報, 3: 詳細情報, 4: 確認）
  const [step, setStep] = useState(1);

  // 確認画面
  const [showConfirm, setShowConfirm] = useState(false);

  // 重複チェック
  type Duplicate = { prNumber: string; itemName: string; totalAmount: number; applicationDate: string; applicant: string; status: string };
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [dupChecked, setDupChecked] = useState(false);

  // 過去申請複製
  type PastRequest = { prNumber: string; applicationDate: string; itemName: string; totalAmount: number; unitPrice: number; quantity: number; supplierName: string; supplierUrl: string; paymentMethod: string; purpose: string; approvalStatus: string; orderStatus: string; inspectionStatus: string; voucherStatus: string; slackLink: string };
  const [pastRequests, setPastRequests] = useState<PastRequest[]>([]);
  const [showPastRequests, setShowPastRequests] = useState(false);
  const [pastLoading, setPastLoading] = useState(false);

  // 承認ルートプレビュー
  type ApprovalStep = { role: string; name: string; slackId: string };
  const [approvalSteps, setApprovalSteps] = useState<ApprovalStep[]>([]);
  const [approvalSummary, setApprovalSummary] = useState("");

  // 勘定科目推定
  type AccountEstimation = { account: string; subAccount: string; confidence: "high" | "medium" | "low"; reason: string };
  const [accountEstimation, setAccountEstimation] = useState<AccountEstimation | null>(null);

  // 下書き復元通知
  const [draftRestored, setDraftRestored] = useState(false);

  // 自分の未処理タスク
  type MyTask = { prNumber: string; itemName: string; totalAmount: number; status: string; slackLink: string };
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [myTasksLoading, setMyTasksLoading] = useState(false);

  const isPurchased = requestType === "購入済";
  const totalAmount = amount * quantity;
  const isHighValue = totalAmount >= 100000;

  // 従業員マスタ・購入先一覧を取得
  useEffect(() => {
    apiFetch("/api/employees")
      .then((r) => r.json())
      .then((d: { employees?: Employee[] }) => {
        if (d.employees) setEmployees(d.employees);
      })
      .catch(() => {});
    apiFetch("/api/suppliers")
      .then((r) => r.json())
      .then((d: { suppliers?: string[] }) => {
        if (d.suppliers) setSupplierSuggestions(d.suppliers);
      })
      .catch(() => {});
  }, []);

  // 未処理タスクを取得する共通関数
  const fetchMyTasks = useCallback((name: string) => {
    setMyTasksLoading(true);
    apiFetch(`/api/purchase/recent?applicant=${encodeURIComponent(name)}&limit=50`)
      .then((r) => r.json())
      .then((d: { requests?: PastRequest[] }) => {
        const tasks: MyTask[] = [];
        for (const req of d.requests || []) {
          let status = "";
          if (req.approvalStatus === "差戻し") status = "差戻し";
          else if (req.orderStatus === "未発注" && req.approvalStatus !== "承認待ち") status = "発注待ち";
          else if (req.inspectionStatus === "未検収" && req.orderStatus !== "未発注") status = "検収待ち";
          else if (req.voucherStatus === "要取得" && req.inspectionStatus !== "未検収") status = "証憑待ち";
          if (status) {
            tasks.push({ prNumber: req.prNumber, itemName: req.itemName, totalAmount: req.totalAmount, status, slackLink: req.slackLink });
          }
        }
        setMyTasks(tasks);
      })
      .catch(() => setMyTasks([]))
      .finally(() => setMyTasksLoading(false));
  }, []);

  // ページ読み込み直後: localStorageのキャッシュで即座に取得
  useEffect(() => {
    const cached = localStorage.getItem("purchase_applicant_name");
    if (cached) fetchMyTasks(cached);
  }, [fetchMyTasks]);

  // 申請者が特定されたらキャッシュ更新 & 再取得
  useEffect(() => {
    let applicantName = selectedEmployee?.name;
    if (!applicantName && userId && employees.length > 0) {
      const matched = employees.find((e) => e.slackAliases?.includes(userId));
      if (matched) applicantName = matched.name;
    }
    if (!applicantName) return;
    const cached = localStorage.getItem("purchase_applicant_name");
    localStorage.setItem("purchase_applicant_name", applicantName);
    if (applicantName !== cached) fetchMyTasks(applicantName);
  }, [selectedEmployee, userId, employees, fetchMyTasks]);

  // 承認ルート取得（金額・区分が変わるたび）
  useEffect(() => {
    if (!requestType) return;
    const params = new URLSearchParams({
      amount: String(totalAmount),
      isPurchased: String(isPurchased),
    });
    apiFetch(`/api/purchase/approval-route?${params}`)
      .then((r) => r.json())
      .then((d: { steps?: ApprovalStep[]; summary?: string }) => {
        setApprovalSteps(d.steps || []);
        setApprovalSummary(d.summary || "");
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
      const res = await apiFetch("/api/purchase/recent?limit=20");
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

  // KATANA PO検索
  const searchKatanaPO = useCallback((q: string) => {
    if (!q || q.length < 2) { setKatanaPOs([]); setShowKatanaSuggest(false); return; }
    setKatanaLoading(true);
    fetch(`/api/katana/purchase-orders?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d: { orders?: KatanaPO[] }) => {
        setKatanaPOs(d.orders || []);
        setShowKatanaSuggest((d.orders || []).length > 0);
      })
      .catch(() => { setKatanaPOs([]); setShowKatanaSuggest(false); })
      .finally(() => setKatanaLoading(false));
  }, []);

  // ステップ進行バリデーション
  const canProceedStep1 = requestType !== "" && (userId || selectedEmployee);
  const extraItemsValid = extraItems.every((e) => e.itemName && e.amount > 0);
  const canProceedStep2 = itemName && amount > 0 && supplierName && extraItemsValid;
  const canProceedStep3 = paymentMethod !== "" && (!isHighValue || (assetUsage && notes));

  const goNextStep = () => {
    if (step < 3) {
      setStep(step + 1);
    } else if (step === 3) {
      // Step 3 → 確認画面（Step 4）
      setStep(4);
    }
  };

  const goPrevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  // Step 3→4遷移時に重複チェック + 勘定科目推定を実行
  const goToConfirm = async () => {
    const dupParams = new URLSearchParams({ itemName });
    if (totalAmount > 0) dupParams.set("totalAmount", String(totalAmount));

    const acctParams = new URLSearchParams({
      itemName,
      supplierName,
      totalAmount: String(totalAmount),
    });

    const [dupRes, acctRes] = await Promise.allSettled([
      apiFetch(`/api/purchase/check-duplicate?${dupParams}`).then((r) => r.json()),
      apiFetch(`/api/purchase/estimate-account?${acctParams}`).then((r) => r.json()),
    ]);

    if (dupRes.status === "fulfilled") {
      setDuplicates(dupRes.value.duplicates || []);
    }
    setDupChecked(true);

    if (acctRes.status === "fulfilled" && acctRes.value.account) {
      setAccountEstimation(acctRes.value);
    }

    setShowConfirm(true);
    setStep(4);
  };

  // フォーム送信ハンドラ
  const handleFormAction = (formData: FormData) => {
    if (!showConfirm) {
      // Step 4以外でのsubmitを無視
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

      {/* 未処理タスクサマリ */}
      {myTasks.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-700 font-medium text-sm">未処理のタスクがあります（{myTasks.length}件）</span>
          </div>
          <div className="space-y-1">
            {(() => {
              const grouped = { "発注待ち": [] as MyTask[], "検収待ち": [] as MyTask[], "証憑待ち": [] as MyTask[], "差戻し": [] as MyTask[] };
              for (const t of myTasks) if (t.status in grouped) (grouped as Record<string, MyTask[]>)[t.status].push(t);
              const icons: Record<string, string> = { "発注待ち": "🛒", "検収待ち": "📦", "証憑待ち": "📎", "差戻し": "↩️" };
              return Object.entries(grouped).filter(([, items]) => items.length > 0).map(([status, items]) => (
                <div key={status} className="text-sm text-amber-800">
                  <span>{icons[status]} {status}: {items.length}件</span>
                  <span className="text-amber-600 ml-2">
                    {items.slice(0, 3).map((t) => t.prNumber).join(", ")}
                    {items.length > 3 && ` 他${items.length - 3}件`}
                  </span>
                </div>
              ));
            })()}
          </div>
          <a href="/purchase/my" className="text-xs text-amber-600 hover:text-amber-800 underline mt-1 inline-block">
            マイページで確認
          </a>
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
        <input type="hidden" name="extra_items" value={JSON.stringify(extraItems.filter((e) => e.itemName && e.amount > 0).map((e) => ({ itemName: e.itemName, amount: e.amount, quantity: e.quantity, url: e.url })))} />

        {/* ステップインジケーター */}
        {!state?.ok && (
          <div className="flex items-center justify-between mb-2">
            {["申請区分", "商品情報", "詳細情報", "確認"].map((label, i) => {
              const stepNum = i + 1;
              const isActive = step === stepNum;
              const isDone = step > stepNum;
              return (
                <div key={label} className="flex items-center flex-1">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
                    isActive ? "bg-blue-600 text-white" : isDone ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"
                  }`}>
                    {isDone ? "✓" : stepNum}
                  </div>
                  <span className={`ml-1 text-xs hidden sm:inline ${isActive ? "text-blue-700 font-medium" : "text-gray-400"}`}>
                    {label}
                  </span>
                  {i < 3 && <div className={`flex-1 h-0.5 mx-2 ${isDone ? "bg-green-400" : "bg-gray-200"}`} />}
                </div>
              );
            })}
          </div>
        )}

        {/* Step 4: 確認画面 */}
        {step === 4 && showConfirm ? (
          <>
            {/* 重複警告 */}
            {dupChecked && duplicates.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-4">
                <p className="font-bold text-amber-800 mb-2">
                  ⚠️ 類似の申請が {duplicates.length} 件見つかりました
                </p>
                <ul className="text-sm text-amber-700 space-y-1">
                  {duplicates.map((d) => (
                    <li key={d.prNumber}>
                      {d.prNumber} — {d.itemName}（{d.totalAmount ? `¥${d.totalAmount.toLocaleString()}` : ""}）{d.applicationDate} {d.applicant} [{d.status}]
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 mt-3 text-sm text-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    name="duplicate_confirmed"
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    required
                  />
                  <span>重複ではないことを確認しました</span>
                </label>
              </div>
            )}

            {/* 勘定科目推定 */}
            {accountEstimation && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-green-800">推定勘定科目:</span>
                  <span className="font-bold text-green-900">
                    {accountEstimation.account}
                    {accountEstimation.subAccount && (
                      <span className="font-normal text-green-700 ml-1">/ {accountEstimation.subAccount}</span>
                    )}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    accountEstimation.confidence === "high" ? "bg-green-200 text-green-800" :
                    accountEstimation.confidence === "medium" ? "bg-yellow-200 text-yellow-800" :
                    "bg-gray-200 text-gray-600"
                  }`}>
                    {accountEstimation.confidence === "high" ? "確度高" :
                     accountEstimation.confidence === "medium" ? "確度中" : "確度低"}
                  </span>
                </div>
                <p className="text-xs text-green-600 mt-1">{accountEstimation.reason}</p>
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
              inspectorName,
              url,
              assetUsage,
              katanaPo,
              hubspotDealId,
              budgetNumber,
              notes,
              extraItems: extraItems.filter((e) => e.itemName && e.amount > 0).map((e) => ({
                itemName: e.itemName, amount: e.amount, quantity: e.quantity, url: e.url
              })),
              allItemsTotal,
            }}
            onBack={() => { setShowConfirm(false); setDupChecked(false); setStep(3); }}
            onSubmit={handleConfirmSubmit}
            pending={pending}
          />
          </>
        ) : (
          <>
            {/* Step 1: 申請区分 */}
            {step === 1 && (
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

                {/* 過去申請一覧 */}
                {showPastRequests && pastRequests.length > 0 && (
                  <div className="bg-gray-50 border rounded-lg p-3 max-h-60 overflow-y-auto">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-medium">過去の申請（クリックで入力）</p>
                      <button type="button" onClick={() => setShowPastRequests(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
                    </div>
                    <ul className="space-y-1">
                      {pastRequests.map((req) => (
                        <li key={req.prNumber}>
                          <button
                            type="button"
                            onClick={() => { applyPastRequest(req); setStep(2); }}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-50 text-sm transition-colors"
                          >
                            <span className="font-medium">{req.itemName}</span>
                            <span className="text-gray-500 ml-2">¥{req.totalAmount.toLocaleString()} — {req.supplierName}</span>
                            <span className="text-gray-400 ml-2 text-xs">{req.applicationDate}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {showPastRequests && pastRequests.length === 0 && !pastLoading && (
                  <div className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-500">過去の申請が見つかりませんでした</div>
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

                {/* Step 1 ナビゲーション */}
                <button
                  type="button"
                  disabled={!canProceedStep1}
                  onClick={goNextStep}
                  className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  次へ: 商品情報
                </button>
              </>
            )}

            {/* Step 2: 商品情報 */}
            {step === 2 && (
              <>
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
                <div className="mt-3 rounded-lg px-3 py-2 text-sm bg-blue-50 border border-blue-200">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-blue-700">
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
                <option value="請求書払い（前払い）">請求書払い（前払い）</option>
                <option value="立替">立替</option>
              </select>
            </fieldset>

            {/* 検収者 */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1">
                検収者
              </legend>
              <select
                name="inspector_name"
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 bg-white"
              >
                <option value="">申請者本人（デフォルト）</option>
                {employees
                  .filter((emp) => emp.departmentName)
                  .map((emp) => (
                  <option key={`${emp.name}-${emp.departmentCode}`} value={emp.name}>
                    {emp.name}（{emp.departmentName}）
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                届いた物品を確認する人。別の人が検収する場合に選択してください
              </p>
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

                {/* 追加品目（一括申請） */}
                {extraItems.map((extra, idx) => (
                  <div key={idx} className="border border-dashed border-gray-300 rounded-lg p-3 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-600">追加品目 {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeExtraItem(idx)}
                        className="text-red-400 hover:text-red-600 text-sm"
                      >
                        削除
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="品目名"
                      value={extra.itemName}
                      onChange={(e) => updateExtraItem(idx, "itemName", e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="単価（税込）"
                        value={extra.amountDisplay}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[,，\s¥]/g, "");
                          const num = parseInt(raw) || 0;
                          updateExtraItem(idx, "amount", num);
                          updateExtraItem(idx, "amountDisplay", raw);
                        }}
                        onBlur={() => {
                          if (extra.amount > 0) updateExtraItem(idx, "amountDisplay", extra.amount.toLocaleString());
                        }}
                        className="border rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="数量"
                        value={extra.quantity}
                        onChange={(e) => updateExtraItem(idx, "quantity", parseInt(e.target.value) || 1)}
                        className="border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <input
                      type="url"
                      placeholder="購入先URL（任意）"
                      value={extra.url}
                      onChange={(e) => updateExtraItem(idx, "url", e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    {extra.amount > 0 && (
                      <div className="text-right text-sm text-gray-500">
                        小計: ¥{(extra.amount * extra.quantity).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addExtraItem}
                  className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600 transition-colors text-sm"
                >
                  + 品目を追加（一括申請）
                </button>

                {extraItems.length > 0 && (
                  <div className="text-right font-bold text-lg">
                    全品目合計: ¥{allItemsTotal.toLocaleString()}
                  </div>
                )}

                {/* Step 2 ナビゲーション */}
                <div className="flex gap-3">
                  <button type="button" onClick={goPrevStep} className="flex-1 py-3 px-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50">
                    戻る
                  </button>
                  <button
                    type="button"
                    disabled={!canProceedStep2}
                    onClick={goNextStep}
                    className="flex-1 py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    次へ: 詳細情報
                  </button>
                </div>
              </>
            )}

            {/* Step 3: 詳細情報 */}
            {step === 3 && (
              <>
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

            {/* KATANA PO番号（サジェスト付き） */}
            <fieldset className="relative">
              <legend className="block text-sm font-medium mb-1">
                KATANA PO番号
              </legend>
              <input
                type="text"
                name="katana_po"
                value={katanaPo}
                onChange={(e) => {
                  setKatanaPo(e.target.value);
                  searchKatanaPO(e.target.value);
                }}
                onFocus={() => { if (katanaPOs.length > 0) setShowKatanaSuggest(true); }}
                placeholder="PO番号を入力して検索..."
                className="w-full border rounded-lg px-3 py-2"
                autoComplete="off"
              />
              {katanaLoading && (
                <span className="absolute right-3 top-9 text-xs text-blue-500 animate-pulse">検索中...</span>
              )}
              {showKatanaSuggest && katanaPOs.length > 0 && (
                <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {katanaPOs.map((po) => (
                    <button
                      key={po.id}
                      type="button"
                      onClick={() => {
                        setKatanaPo(po.poNumber);
                        setShowKatanaSuggest(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-0"
                    >
                      <span className="font-medium">{po.poNumber}</span>
                      <span className="text-gray-500 ml-2">{po.supplierName}</span>
                      {po.total > 0 && (
                        <span className="text-gray-400 ml-2">¥{po.total.toLocaleString()}</span>
                      )}
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        po.status === "open" ? "bg-green-100 text-green-700" :
                        po.status === "closed" ? "bg-gray-100 text-gray-500" :
                        "bg-blue-100 text-blue-700"
                      }`}>{po.status}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                製品部品の場合に入力（2文字以上で検索）
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

                {/* Step 3 ナビゲーション */}
                <div className="flex gap-3">
                  <button type="button" onClick={goPrevStep} className="flex-1 py-3 px-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50">
                    戻る
                  </button>
                  <button
                    type="button"
                    disabled={!canProceedStep3}
                    onClick={goToConfirm}
                    className="flex-1 py-3 px-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    確認画面へ
                  </button>
                </div>

                {/* 下書き保存の案内 */}
                <p className="text-xs text-center text-gray-400">
                  入力内容は自動的に下書き保存されます
                </p>
              </>
            )}
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

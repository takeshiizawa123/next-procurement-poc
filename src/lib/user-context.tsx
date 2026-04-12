"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { apiFetch } from "./api-client";

interface UserInfo {
  slackId: string;
  name: string;
  email: string;
  departmentName: string;
  isAdmin: boolean;  // 管理本部 = true
  loaded: boolean;
}

const defaultUser: UserInfo = {
  slackId: "",
  name: "",
  email: "",
  departmentName: "",
  isAdmin: false,
  loaded: false,
};

const UserContext = createContext<UserInfo>(defaultUser);

export function useUser() {
  return useContext(UserContext);
}

interface Employee {
  name: string;
  departmentName: string;
  slackId: string;
  slackAliases: string;
  email?: string;
}

const USER_CACHE_KEY = "purchase_user_info";
const EMPLOYEES_CACHE_KEY = "purchase_employees_cache";
const EMPLOYEES_CACHE_TTL = 10 * 60_000; // 10分

/** localStorageからユーザー情報を即時復元 */
function restoreUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as UserInfo;
    if (cached.name) return { ...cached, loaded: true };
  } catch { /* ignore */ }
  return null;
}

function saveUser(user: UserInfo): void {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

/** 従業員マスタをlocalStorageキャッシュ付きで取得 */
async function fetchEmployeesCached(): Promise<Employee[]> {
  // キャッシュチェック
  try {
    const raw = localStorage.getItem(EMPLOYEES_CACHE_KEY);
    if (raw) {
      const { data, ts } = JSON.parse(raw) as { data: Employee[]; ts: number };
      if (Date.now() - ts < EMPLOYEES_CACHE_TTL && data.length > 0) {
        // stale-while-revalidate: キャッシュを返しつつバックグラウンドで更新
        apiFetch("/api/employees").then((r) => r.json()).then((d: { employees?: Employee[] }) => {
          if (d.employees?.length) {
            localStorage.setItem(EMPLOYEES_CACHE_KEY, JSON.stringify({ data: d.employees, ts: Date.now() }));
          }
        }).catch(() => {});
        return data;
      }
    }
  } catch { /* ignore */ }

  // キャッシュなし or 期限切れ → フェッチ
  const res = await apiFetch("/api/employees");
  const d = await res.json() as { employees?: Employee[] };
  const employees = d.employees || [];
  try {
    localStorage.setItem(EMPLOYEES_CACHE_KEY, JSON.stringify({ data: employees, ts: Date.now() }));
  } catch { /* ignore */ }
  return employees;
}

/** 従業員マスタからユーザーを照合（email優先、次にSlack ID、最後に名前） */
function matchEmployee(employees: Employee[], email?: string | null, slackId?: string): Employee | undefined {
  // 1. Googleメールで照合（最も信頼性が高い）
  if (email) {
    const byEmail = employees.find((e) => e.email === email);
    if (byEmail) return byEmail;
    // emailのローカルパートで名前マッチ（例: taro.yamada@company.com → "山田太郎"は無理なので飛ばす）
  }

  // 2. Slack IDで照合
  if (slackId) {
    const bySlackId = employees.find(
      (e) => e.slackId === slackId || e.slackAliases?.split(/[,、]/).map((s) => s.trim()).includes(slackId)
    );
    if (bySlackId) return bySlackId;
  }

  // 3. localStorageの申請者名でフォールバック
  const cachedName = localStorage.getItem("purchase_applicant_name");
  if (cachedName) {
    return employees.find((e) => e.name === cachedName);
  }
  return undefined;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<UserInfo>(() => {
    // SSR対策: windowがない場合はdefault
    if (typeof window === "undefined") return defaultUser;
    // localStorageから即時復元
    return restoreUser() || defaultUser;
  });

  useEffect(() => {
    // セッション読み込み中はスキップ
    if (status === "loading") return;

    const sessionEmail = session?.user?.email;

    // URL paramsからSlack ID取得（Slackリンク経由のアクセス用）
    const params = new URLSearchParams(window.location.search);
    let slackId = params.get("user_id") || "";
    if (!slackId) {
      slackId = localStorage.getItem("purchase_user_id") || "";
    }
    if (slackId) {
      localStorage.setItem("purchase_user_id", slackId);
    }

    // 従業員マスタとの照合
    fetchEmployeesCached()
      .then((employees) => {
        const matched = matchEmployee(employees, sessionEmail, slackId);
        if (matched) {
          const info: UserInfo = {
            slackId: matched.slackId || slackId,
            name: matched.name,
            email: sessionEmail || "",
            departmentName: matched.departmentName,
            isAdmin: matched.departmentName === "管理本部",
            loaded: true,
          };
          setUser(info);
          saveUser(info);
        } else if (sessionEmail) {
          // 従業員マスタに未登録だがGoogleログインはしている
          const info: UserInfo = {
            slackId,
            name: session?.user?.name || sessionEmail,
            email: sessionEmail,
            departmentName: "",
            isAdmin: false,
            loaded: true,
          };
          setUser(info);
          saveUser(info);
        } else {
          setUser({ ...defaultUser, slackId, loaded: true });
        }
      })
      .catch(() => {
        setUser({ ...defaultUser, slackId, loaded: true });
      });
  }, [session, status]);

  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

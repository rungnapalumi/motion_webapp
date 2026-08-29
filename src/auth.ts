export type AuthUser = {
  username: string;
  remaining: number;
  quota: number;
};

const TOKEN_KEY = "motion_webapp_token";

function authHeaders(): HeadersInit {
  const token = loadToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  if (data && typeof data.error === "string" && data.error.trim()) return data.error;
  return `HTTP ${res.status}`;
}

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (typeof data.token === "string" && data.token) saveToken(data.token);
  return {
    username: String(data.username || username),
    remaining: Number(data.remaining),
    quota: Number(data.quota) || 30,
  };
}

export async function fetchSession(): Promise<AuthUser | null> {
  if (!loadToken()) return null;
  const res = await fetch("/api/me", { headers: authHeaders(), cache: "no-store" });
  if (res.status === 401) {
    clearToken();
    return null;
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return {
    username: String(data.username || ""),
    remaining: Number(data.remaining),
    quota: Number(data.quota) || 30,
  };
}

export async function consumeUpload(): Promise<AuthUser> {
  const res = await fetch("/api/consume", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  return {
    username: String(data.username || ""),
    remaining: Number(data.remaining),
    quota: Number(data.quota) || 30,
  };
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/logout", { method: "POST", headers: authHeaders() });
  } catch {
    /* ignore */
  }
  clearToken();
}

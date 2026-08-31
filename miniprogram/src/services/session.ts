const SESSION_STORAGE_KEY = "digital-family-tree.session.v1";

export interface FamilyMembership {
  familyId: string;
  familyName: string;
  role: string;
  status: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: { id: string; displayName: string | null; status: string };
  families: FamilyMembership[];
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

interface ApiResponse<T> {
  data: T;
}
interface ErrorResponse {
  error?: { code?: string; message?: string; traceId?: string };
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code = "SESSION_REQUEST_FAILED",
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export interface SessionPlatform {
  getStorage(key: string): unknown;
  setStorage(key: string, value: unknown): void;
  removeStorage(key: string): void;
  login(): Promise<string>;
  request<T>(options: {
    path: string;
    data: Record<string, string>;
    idempotencyKey: string;
  }): Promise<T>;
  now(): number;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.accessExpiresAt === "string" &&
    typeof candidate.refreshExpiresAt === "string" &&
    !!candidate.user &&
    Array.isArray(candidate.families)
  );
}

function isFuture(date: string, now: number): boolean {
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && timestamp > now;
}

function idempotencyKey(): string {
  return `mini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function restoreSession(
  platform: SessionPlatform = wechatPlatform,
): Promise<Session | null> {
  const stored = platform.getStorage(SESSION_STORAGE_KEY);
  if (!isSession(stored)) {
    platform.removeStorage(SESSION_STORAGE_KEY);
    return null;
  }
  if (isFuture(stored.accessExpiresAt, platform.now())) return stored;
  if (!isFuture(stored.refreshExpiresAt, platform.now())) {
    platform.removeStorage(SESSION_STORAGE_KEY);
    return null;
  }
  try {
    const tokens = await platform.request<Tokens>({
      path: "/api/v1/auth/refresh",
      data: { refreshToken: stored.refreshToken },
      idempotencyKey: idempotencyKey(),
    });
    const refreshed = { ...stored, ...tokens };
    platform.setStorage(SESSION_STORAGE_KEY, refreshed);
    return refreshed;
  } catch {
    platform.removeStorage(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function loginWithWechat(
  platform: SessionPlatform = wechatPlatform,
): Promise<Session> {
  const code = await platform.login();
  const session = await platform.request<Session>({
    path: "/api/v1/auth/wechat/login",
    data: { code },
    idempotencyKey: idempotencyKey(),
  });
  platform.setStorage(SESSION_STORAGE_KEY, session);
  return session;
}

const API_BASE_URL = "http://127.0.0.1:3000";

interface MiniProgramApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  login(options: {
    success(result: { code: string }): void;
    fail(): void;
  }): void;
  request<T>(options: {
    url: string;
    method: "POST";
    data: Record<string, string>;
    header: Record<string, string>;
    success(result: { statusCode: number; data: T }): void;
    fail(): void;
  }): void;
}

function miniProgramApi(): MiniProgramApi {
  return (globalThis as typeof globalThis & { wx: MiniProgramApi }).wx;
}

const wechatPlatform: SessionPlatform = {
  getStorage: (key) => miniProgramApi().getStorageSync(key),
  setStorage: (key, value) => miniProgramApi().setStorageSync(key, value),
  removeStorage: (key) => miniProgramApi().removeStorageSync(key),
  now: () => Date.now(),
  login: () =>
    new Promise((resolve, reject) => {
      miniProgramApi().login({
        success: ({ code }) =>
          code
            ? resolve(code)
            : reject(new SessionError("未能获取微信登录凭证")),
        fail: () => reject(new SessionError("微信登录未完成，请重试")),
      });
    }),
  request: <T>({
    path,
    data,
    idempotencyKey: key,
  }: {
    path: string;
    data: Record<string, string>;
    idempotencyKey: string;
  }) =>
    new Promise<T>((resolve, reject) => {
      miniProgramApi().request<ApiResponse<T> | ErrorResponse>({
        url: `${API_BASE_URL}${path}`,
        method: "POST",
        data,
        header: { "content-type": "application/json", "Idempotency-Key": key },
        success: ({ statusCode, data: response }) => {
          if (statusCode >= 200 && statusCode < 300 && "data" in response) {
            resolve(response.data);
            return;
          }
          const details = "error" in response ? response.error : undefined;
          reject(
            new SessionError(
              details?.message ?? "服务暂时不可用，请稍后重试",
              details?.code,
              details?.traceId,
            ),
          );
        },
        fail: () => reject(new SessionError("网络连接失败，请检查后重试")),
      });
    }),
};

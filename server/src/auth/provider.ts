import { createHash } from "node:crypto";

export interface WechatIdentity {
  openId: string;
  unionId?: string;
}

export interface WechatLoginProvider {
  exchangeCode(code: string): Promise<WechatIdentity>;
}

export class WechatProviderError extends Error {
  constructor(
    readonly code: "INVALID_CODE" | "UPSTREAM_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "WechatProviderError";
  }
}

export class FakeWechatLoginProvider implements WechatLoginProvider {
  exchangeCode(code: string): Promise<WechatIdentity> {
    if (!/^dev_[A-Za-z0-9_-]{4,128}$/.test(code)) {
      return Promise.reject(
        new WechatProviderError("INVALID_CODE", "Invalid development code"),
      );
    }
    const digest = createHash("sha256").update(code).digest("hex");
    return Promise.resolve({ openId: `fake_${digest.slice(0, 32)}` });
  }
}

interface Code2SessionResponse {
  errcode?: number;
  errmsg?: string;
  openid?: string;
  unionid?: string;
}

export class WechatCode2SessionProvider implements WechatLoginProvider {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new WechatProviderError(
        "UPSTREAM_ERROR",
        "WeChat login service is unavailable",
      );
    }

    if (!response.ok) {
      throw new WechatProviderError(
        "UPSTREAM_ERROR",
        "WeChat login service returned an HTTP error",
      );
    }

    const payload = (await response.json()) as Code2SessionResponse;
    if (payload.errcode !== undefined || !payload.openid) {
      throw new WechatProviderError(
        payload.errcode === 40029 ? "INVALID_CODE" : "UPSTREAM_ERROR",
        "WeChat code exchange failed",
      );
    }

    return {
      openId: payload.openid,
      ...(payload.unionid ? { unionId: payload.unionid } : {}),
    };
  }
}

export function createWechatLoginProvider(
  environment: NodeJS.ProcessEnv = process.env,
): WechatLoginProvider {
  const provider = environment.WECHAT_LOGIN_PROVIDER ?? "fake";
  if (provider === "fake" && environment.NODE_ENV !== "production") {
    return new FakeWechatLoginProvider();
  }
  if (provider !== "wechat") {
    throw new Error("WECHAT_LOGIN_PROVIDER must be 'fake' or 'wechat'");
  }
  if (!environment.WECHAT_APP_ID || !environment.WECHAT_APP_SECRET) {
    throw new Error(
      "WECHAT_APP_ID and WECHAT_APP_SECRET are required for the WeChat provider",
    );
  }
  return new WechatCode2SessionProvider(
    environment.WECHAT_APP_ID,
    environment.WECHAT_APP_SECRET,
  );
}

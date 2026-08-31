import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient, User } from "../generated/prisma/client.js";
import { ApiError } from "../http/errors.js";
import { type WechatLoginProvider, WechatProviderError } from "./provider.js";

export interface AuthUser {
  id: string;
  displayName: string | null;
  status: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface LoginResult extends AuthTokens {
  user: AuthUser;
  families: [];
}

export interface AuthServiceOptions {
  accessTtlMs?: number;
  clock?: () => Date;
  refreshTtlMs?: number;
  tokenGenerator?: () => string;
}

interface IssuedSession extends AuthTokens {
  userId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user: User): AuthUser {
  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
  };
}

export class AuthService {
  private readonly accessTtlMs: number;
  private readonly clock: () => Date;
  private readonly refreshTtlMs: number;
  private readonly tokenGenerator: () => string;

  constructor(
    private readonly database: PrismaClient,
    private readonly provider: WechatLoginProvider,
    options: AuthServiceOptions = {},
  ) {
    this.accessTtlMs = options.accessTtlMs ?? 15 * 60 * 1000;
    this.refreshTtlMs = options.refreshTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.clock = options.clock ?? (() => new Date());
    this.tokenGenerator =
      options.tokenGenerator ?? (() => randomBytes(32).toString("base64url"));
  }

  async login(code: string): Promise<LoginResult> {
    let identity;
    try {
      identity = await this.provider.exchangeCode(code);
    } catch (error) {
      if (error instanceof WechatProviderError) {
        throw new ApiError(
          error.code === "INVALID_CODE" ? 401 : 503,
          error.code === "INVALID_CODE"
            ? "WECHAT_CODE_INVALID"
            : "WECHAT_PROVIDER_UNAVAILABLE",
          error.code === "INVALID_CODE"
            ? "微信登录凭证无效或已过期"
            : "微信登录服务暂时不可用",
        );
      }
      throw error;
    }

    const now = this.clock();
    const result = await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.upsert({
        where: { wechatOpenid: identity.openId },
        create: {
          wechatOpenid: identity.openId,
          ...(identity.unionId ? { wechatUnionid: identity.unionId } : {}),
          lastLoginAt: now,
        },
        update: {
          ...(identity.unionId ? { wechatUnionid: identity.unionId } : {}),
          lastLoginAt: now,
        },
      });

      if (user.status !== "ACTIVE") {
        throw new ApiError(403, "ACCOUNT_DISABLED", "账号已被停用");
      }

      const session = await this.issueSession(transaction, user.id, now);
      return { session, user };
    });

    return {
      ...result.session,
      user: publicUser(result.user),
      families: [],
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const now = this.clock();
    const refreshTokenHash = hashToken(refreshToken);

    return this.database.$transaction(async (transaction) => {
      const current = await transaction.session.findUnique({
        where: { refreshTokenHash },
        include: { user: true },
      });
      if (
        !current ||
        current.revokedAt ||
        current.refreshExpiresAt <= now ||
        current.user.status !== "ACTIVE"
      ) {
        throw new ApiError(
          401,
          "REFRESH_TOKEN_INVALID",
          "刷新凭证无效或已过期",
        );
      }

      const revoked = await transaction.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { lastUsedAt: now, revokedAt: now },
      });
      if (revoked.count !== 1) {
        throw new ApiError(401, "REFRESH_TOKEN_REUSED", "刷新凭证已被使用");
      }

      const next = await this.issueSession(transaction, current.userId, now);
      return {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        accessExpiresAt: next.accessExpiresAt,
        refreshExpiresAt: next.refreshExpiresAt,
      };
    });
  }

  async logout(accessToken: string): Promise<void> {
    const now = this.clock();
    const revoked = await this.database.session.updateMany({
      where: {
        accessTokenHash: hashToken(accessToken),
        accessExpiresAt: { gt: now },
        revokedAt: null,
      },
      data: { lastUsedAt: now, revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw new ApiError(401, "ACCESS_TOKEN_INVALID", "访问凭证无效或已过期");
    }
  }

  async authenticate(accessToken: string): Promise<AuthUser> {
    const now = this.clock();
    const session = await this.database.session.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.accessExpiresAt <= now ||
      session.user.status !== "ACTIVE"
    ) {
      throw new ApiError(401, "ACCESS_TOKEN_INVALID", "访问凭证无效或已过期");
    }

    await this.database.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
    return publicUser(session.user);
  }

  private async issueSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<IssuedSession> {
    const accessToken = this.tokenGenerator();
    const refreshToken = this.tokenGenerator();
    const accessExpiresAt = new Date(now.getTime() + this.accessTtlMs);
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTtlMs);

    await transaction.session.create({
      data: {
        userId,
        accessTokenHash: hashToken(accessToken),
        refreshTokenHash: hashToken(refreshToken),
        accessExpiresAt,
        refreshExpiresAt,
      },
    });

    return {
      userId,
      accessToken,
      refreshToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }
}

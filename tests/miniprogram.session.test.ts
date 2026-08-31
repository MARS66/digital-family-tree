import { describe, expect, it, vi } from "vitest";

import {
  loginWithWechat,
  restoreSession,
  type Session,
  type SessionPlatform,
} from "../miniprogram/src/services/session.js";

const now = Date.parse("2026-08-31T08:00:00.000Z");
const session: Session = {
  accessToken: "access-old",
  refreshToken: "refresh-old",
  accessExpiresAt: "2026-08-31T09:00:00.000Z",
  refreshExpiresAt: "2026-09-30T08:00:00.000Z",
  user: { id: "user-1", displayName: "小林", status: "ACTIVE" },
  families: [],
};

function platform(stored: unknown): SessionPlatform & {
  request: ReturnType<typeof vi.fn>;
  setStorage: ReturnType<typeof vi.fn>;
  removeStorage: ReturnType<typeof vi.fn>;
} {
  return {
    getStorage: vi.fn(() => stored),
    setStorage: vi.fn(),
    removeStorage: vi.fn(),
    login: vi.fn(() => Promise.resolve("wechat-code")),
    request: vi.fn(),
    now: () => now,
  };
}

describe("miniprogram session flow", () => {
  it("restores an unexpired session without a network request", async () => {
    const mock = platform(session);
    await expect(restoreSession(mock)).resolves.toEqual(session);
    expect(mock.request.mock.calls).toHaveLength(0);
  });

  it("rotates tokens while preserving the user and family context", async () => {
    const expired = { ...session, accessExpiresAt: "2026-08-31T07:00:00.000Z" };
    const mock = platform(expired);
    mock.request.mockResolvedValue({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      accessExpiresAt: "2026-08-31T10:00:00.000Z",
      refreshExpiresAt: "2026-10-01T08:00:00.000Z",
    });

    const restored = await restoreSession(mock);

    expect(restored).toMatchObject({
      accessToken: "access-new",
      user: session.user,
      families: [],
    });
    expect(mock.setStorage.mock.calls).toContainEqual([
      expect.any(String),
      restored,
    ]);
  });

  it("clears an unusable session when refresh fails", async () => {
    const expired = { ...session, accessExpiresAt: "2026-08-31T07:00:00.000Z" };
    const mock = platform(expired);
    mock.request.mockRejectedValue(new Error("offline"));

    await expect(restoreSession(mock)).resolves.toBeNull();
    expect(mock.removeStorage.mock.calls).toHaveLength(1);
  });

  it("exchanges a fresh WeChat code and persists the login result", async () => {
    const mock = platform(undefined);
    mock.request.mockResolvedValue(session);

    await expect(loginWithWechat(mock)).resolves.toEqual(session);
    expect(mock.request.mock.calls).toContainEqual([
      expect.objectContaining({
        path: "/api/v1/auth/wechat/login",
        data: { code: "wechat-code" },
      }),
    ]);
    expect(mock.setStorage.mock.calls).toContainEqual([
      expect.any(String),
      session,
    ]);
  });
});

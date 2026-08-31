import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("T021 onboarding flow", () => {
  it("offers login, create-family and join-family paths from the startup page", () => {
    const page = source("miniprogram/src/pages/bootstrap/index.wxml");
    expect(page).toContain("微信登录");
    expect(page).toContain("创建家族");
    expect(page).toContain("使用邀请码加入");
  });

  it("routes a new user to a registered create-family page", () => {
    const logic = source("miniprogram/src/pages/bootstrap/index.ts");
    const config = source("miniprogram/src/app.json");
    expect(logic).toContain(
      'wx.navigateTo({ url: "/pages/family-create/index" })',
    );
    expect(config).toContain('"pages/family-create/index"');
  });

  it("persists invite and create-family drafts across retry and reload", () => {
    const startup = source("miniprogram/src/pages/bootstrap/index.ts");
    const creation = source("miniprogram/src/pages/family-create/index.ts");
    expect(startup).toContain("INVITE_DRAFT_KEY");
    expect(startup).toContain(
      "wx.setStorageSync(INVITE_DRAFT_KEY, inviteCode)",
    );
    expect(creation).toContain("readDraft()");
    expect(creation).toContain("wx.setStorageSync(DRAFT_KEY, this.data)");
  });
});

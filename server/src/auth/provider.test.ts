import { describe, expect, it } from "vitest";

import { FakeWechatLoginProvider, WechatProviderError } from "./provider.js";

describe("WeChat login provider contract", () => {
  const provider = new FakeWechatLoginProvider();

  it("returns the same identity for the same valid code", async () => {
    const first = await provider.exchangeCode("dev_member_001");
    const second = await provider.exchangeCode("dev_member_001");

    expect(first).toEqual(second);
    expect(first.openId).toMatch(/^fake_[0-9a-f]{32}$/);
  });

  it("rejects malformed development codes", async () => {
    await expect(provider.exchangeCode("invalid")).rejects.toEqual(
      expect.objectContaining<Partial<WechatProviderError>>({
        code: "INVALID_CODE",
      }),
    );
  });
});

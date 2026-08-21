import { describe, expect, it } from "vitest";

import { CONTRACTS_PACKAGE_NAME } from "../packages/contracts/src/index.js";
import { MINIPROGRAM_RUNTIME } from "../miniprogram/src/index.js";
import { SERVER_RUNTIME } from "../server/src/index.js";

describe("workspace smoke test", () => {
  it("loads every TypeScript workspace", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@digital-family-tree/contracts");
    expect(MINIPROGRAM_RUNTIME).toBe("wechat");
    expect(SERVER_RUNTIME).toBe("node");
  });
});

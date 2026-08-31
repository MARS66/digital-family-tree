import { describe, expect, it } from "vitest";

import { CONTRACTS_PACKAGE_NAME } from "../packages/contracts/src/index.js";
import { createHttpServer } from "../server/src/http/server.js";

describe("workspace smoke test", () => {
  it("loads every TypeScript workspace", async () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@digital-family-tree/contracts");
    const server = await createHttpServer({ logger: false });
    expect(server.hasRoute({ method: "GET", url: "/health" })).toBe(true);
    await server.close();
  });
});

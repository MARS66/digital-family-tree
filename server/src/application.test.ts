import { describe, expect, it, vi } from "vitest";

import { createApplication } from "./application.js";

describe("application lifecycle", () => {
  it("starts and stops idempotently", async () => {
    const listen = vi.fn(() => Promise.resolve("http://127.0.0.1:40000"));
    const close = vi.fn(() => Promise.resolve());
    const server = { listen, close };
    const application = await createApplication({ port: 0, server });

    const firstAddress = await application.start();
    const secondAddress = await application.start();
    expect(application.isRunning).toBe(true);
    expect(secondAddress).toBe(firstAddress);
    expect(listen).toHaveBeenCalledTimes(1);

    await application.stop();
    await application.stop();
    expect(application.isRunning).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

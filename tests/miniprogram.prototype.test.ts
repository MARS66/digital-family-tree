import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const appConfig = JSON.parse(
  readFileSync(resolve(root, "miniprogram/src/app.json"), "utf8"),
) as {
  pages: string[];
};

describe("miniprogram UI prototype", () => {
  it("registers exactly the five requested prototype pages", () => {
    expect(appConfig.pages).toEqual([
      "pages/family-home/index",
      "pages/family-tree/index",
      "pages/person-detail/index",
      "pages/family-entry/index",
      "pages/review-center/index",
    ]);
  });

  it.each(appConfig.pages)("provides a complete page bundle for %s", (page) => {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      expect(
        readFileSync(
          resolve(root, `miniprogram/src/${page}.${extension}`),
          "utf8",
        ).length,
      ).toBeGreaterThan(2);
    }
  });

  it("keeps candidate and formal data visually distinct in the prototype", () => {
    const detail = readFileSync(
      resolve(root, "miniprogram/src/pages/person-detail/index.wxml"),
      "utf8",
    );
    const entry = readFileSync(
      resolve(root, "miniprogram/src/pages/family-entry/index.wxml"),
      "utf8",
    );
    expect(detail).toContain("尚未进入正式家谱");
    expect(entry).toContain("审核通过前，不会出现在正式家谱中");
  });

  it("provides populated ancestor and descendant panels", () => {
    const tree = readFileSync(
      resolve(root, "miniprogram/src/pages/family-tree/index.wxml"),
      "utf8",
    );
    expect(tree).toContain("第三代 · 曾祖辈");
    expect(tree).toContain("继续向上展开第四代");
    expect(tree).toContain("张禾分支");
    expect(tree).toContain("张屿分支");
  });
});

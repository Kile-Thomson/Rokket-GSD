// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildItems } from "../slash-menu";

describe("slash-menu buildItems", () => {
  it("includes 'gsd update' with sendOnSelect: true", () => {
    const items = buildItems();
    const update = items.find((i) => i.name === "gsd update");
    expect(update).toBeDefined();
    expect(update!.description).toBe("Update GSD to the latest version");
    expect(update!.sendOnSelect).toBe(true);
  });

  it("includes 'gsd export' without sendOnSelect", () => {
    const items = buildItems();
    const exp = items.find((i) => i.name === "gsd export");
    expect(exp).toBeDefined();
    expect(exp!.description).toBe("Export milestone report as HTML (via gsd-pi)");
    expect(exp!.sendOnSelect).toBeUndefined();
  });
});

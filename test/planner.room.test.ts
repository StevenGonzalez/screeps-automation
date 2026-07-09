import { describe, it, expect } from "vitest";
import { shouldUseFallbackForStampCell } from "../src/planning/planner.room";

describe("shouldUseFallbackForStampCell", () => {
  it("allows tower cells to fall back to a nearby buildable tile", () => {
    expect(shouldUseFallbackForStampCell({ dx: 0, dy: 0, type: "tower", minRcl: 3 })).toBe(true);
    expect(shouldUseFallbackForStampCell({ dx: 0, dy: 0, type: "storage", minRcl: 4, critical: true })).toBe(true);
    expect(shouldUseFallbackForStampCell({ dx: 0, dy: 0, type: "extension", minRcl: 1 })).toBe(false);
  });
});

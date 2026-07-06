import { describe, it, expect } from "vitest";
import { resolveChain, REACTION_RECIPES } from "../src/services/services.labs";

const NO_STORAGE = null;

function compounds(chain: { compound: string; amount: number }[]): string[] {
  return chain.map((c) => c.compound);
}

describe("resolveChain", () => {
  it("returns an empty chain for a base mineral (no reaction)", () => {
    expect(resolveChain("H", 1000, NO_STORAGE)).toEqual([]);
    expect(resolveChain("X", 1000, NO_STORAGE)).toEqual([]);
  });

  it("expands a tier-4 compound into its full reaction chain", () => {
    const chain = resolveChain("XUH2O", 3000, NO_STORAGE);
    const names = compounds(chain);
    expect(new Set(names)).toEqual(new Set(["OH", "UH", "UH2O", "XUH2O"]));
    for (const n of names) expect(REACTION_RECIPES[n]).toBeDefined();
  });

  it("orders every ingredient before the compound that consumes it", () => {
    const names = compounds(resolveChain("XUH2O", 3000, NO_STORAGE));
    const idx = (c: string) => names.indexOf(c);
    expect(idx("OH")).toBeLessThan(idx("UH2O"));
    expect(idx("UH")).toBeLessThan(idx("UH2O"));
    expect(idx("UH2O")).toBeLessThan(idx("XUH2O"));
  });

  it("requests the target amount at every step when nothing is in stock", () => {
    const chain = resolveChain("XUH2O", 3000, NO_STORAGE);
    for (const step of chain) expect(step.amount).toBe(3000);
  });

  it("does not double-count stock for a shared intermediate (synthetic recipe)", () => {
    const recipes: Record<string, [string, string]> = {
      R: ["A", "B"],
      A: ["M", "x"],
      B: ["M", "y"],
      M: ["p", "q"],
    };
    const saved: Record<string, [string, string]> = {};
    for (const k of Object.keys(recipes)) {
      if (REACTION_RECIPES[k]) saved[k] = REACTION_RECIPES[k];
      REACTION_RECIPES[k] = recipes[k];
    }
    try {
      const chain = resolveChain("R", 100, NO_STORAGE);
      const m = chain.find((c) => c.compound === "M");
      expect(m).toBeDefined();
      expect(m!.amount).toBe(200);
    } finally {
      for (const k of Object.keys(recipes)) {
        if (saved[k]) REACTION_RECIPES[k] = saved[k];
        else delete REACTION_RECIPES[k];
      }
    }
  });
});

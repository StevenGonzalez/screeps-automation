import { describe, it, expect } from "vitest";
import { shouldPlanDefensivePerimeter } from "../src/planning/planner.rampart";

describe("shouldPlanDefensivePerimeter", () => {
  it("waits for towers at RCL 3 before planning the perimeter", () => {
    expect(shouldPlanDefensivePerimeter(1)).toBe(false);
    expect(shouldPlanDefensivePerimeter(2)).toBe(false);
    expect(shouldPlanDefensivePerimeter(3)).toBe(true);
  });
});

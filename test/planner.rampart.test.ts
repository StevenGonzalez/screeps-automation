import { describe, it, expect } from "vitest";
import { shouldPlanDefensivePerimeter } from "../src/planning/planner.rampart";

describe("shouldPlanDefensivePerimeter", () => {
  it("starts early enough to shelter the first core at RCL 2 and 3", () => {
    expect(shouldPlanDefensivePerimeter(1)).toBe(false);
    expect(shouldPlanDefensivePerimeter(2)).toBe(true);
    expect(shouldPlanDefensivePerimeter(3)).toBe(true);
  });
});

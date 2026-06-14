import { describe, it, expect } from "vitest";
import { isSourceKeeperRoom, formationOffset } from "../src/services/services.combat";

describe("isSourceKeeperRoom", () => {
  it("flags the full 3×3 keeper cluster (coords 4–6), including the coord-6 rooms", () => {
    for (const name of ["W4N4", "W5N4", "W6N4", "W4N5", "W6N5", "W4N6", "W5N6", "W6N6"]) {
      expect(isSourceKeeperRoom(name)).toBe(true);
    }
  });

  it("excludes the sector centre (5,5), which is the central/portal room", () => {
    expect(isSourceKeeperRoom("W5N5")).toBe(false);
    expect(isSourceKeeperRoom("E15N25")).toBe(false); // 15%10=5, 25%10=5
  });

  it("excludes normal and highway rooms", () => {
    expect(isSourceKeeperRoom("W1N1")).toBe(false);
    expect(isSourceKeeperRoom("W10N10")).toBe(false); // 0,0 → highway
    expect(isSourceKeeperRoom("W0N0")).toBe(false);
  });

  it("returns false for malformed names", () => {
    expect(isSourceKeeperRoom("not-a-room")).toBe(false);
    expect(isSourceKeeperRoom("")).toBe(false);
  });
});

describe("formationOffset", () => {
  it("puts the leader (slot 0) at the origin for every formation", () => {
    for (const f of ["line", "box", "wedge", "scatter"] as const) {
      expect(formationOffset(f, 0)).toEqual([0, 0]);
    }
  });

  it("stacks members beyond the template further back so large squads still cohere", () => {
    const box = formationOffset("box", 9); // first slot past the 9-entry box template
    expect(box[1]).toBeGreaterThanOrEqual(3);
  });
});

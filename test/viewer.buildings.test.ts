import { describe, expect, it } from "vitest";
import type { TownPlan } from "../viewer/shared/protocol";
import type { RoomObjects } from "../viewer/shared/realm";
import { campTiles, E, N, planRoom, ringMask, S, tileOf, W } from "../viewer/client/buildings-plan";

function objects(...list: Array<[string, number, number]>): RoomObjects {
  const out: RoomObjects = {};
  list.forEach(([type, x, y], n) => (out[`${type}${n}`] = { _id: `${type}${n}`, type, x, y }));
  return out;
}

const TOWN: TownPlan = {
  posts: ["30,30"],
  square: [],
  fountain: "20,20",
  cottages: [{ x: 10, y: 10, door: "12,14", name: "Hearth" }],
};

describe("viewer buildings plan", () => {
  it("tells the curtain from a cottage's walls and the fountain's", () => {
    const plan = planRoom(objects(["constructedWall", 11, 11], ["constructedWall", 20, 20], ["constructedWall", 40, 5]), TOWN);
    expect([...plan.curtain]).toEqual([tileOf(40, 5)]);
    expect(plan.house.get(tileOf(11, 11))).toBe(0);
    expect(plan.fountain).toBe(tileOf(20, 20));
  });

  it("reads each rampart by where it stands", () => {
    const plan = planRoom(
      objects(
        ["rampart", 12, 14],
        ["rampart", 30, 30],
        ["rampart", 25, 25],
        ["spawn", 25, 25],
        ["constructedWall", 40, 5],
        ["rampart", 41, 5],
        ["rampart", 44, 44],
        ["road", 44, 44],
      ),
      TOWN,
    );
    expect(plan.ramparts.get(tileOf(12, 14))).toBe("house");
    expect(plan.ramparts.get(tileOf(30, 30))).toBe("post");
    expect(plan.ramparts.get(tileOf(25, 25))).toBe("plinth");
    expect(plan.ramparts.get(tileOf(41, 5))).toBe("gate");
    expect(plan.ramparts.get(tileOf(44, 44))).toBe("battlement");
    expect(plan.roads.has(tileOf(44, 44))).toBe(true);
  });

  it("leaves creeps off the plan", () => {
    const plan = planRoom(objects(["creep", 5, 5]), null);
    expect(plan.at.size).toBe(0);
  });

  it("joins the ring through gates and battlements but not plinths", () => {
    const plan = planRoom(
      objects(["constructedWall", 10, 9], ["rampart", 11, 10], ["constructedWall", 10, 11], ["rampart", 9, 10], ["extension", 9, 10]),
      null,
    );
    expect(ringMask(plan, 10, 10)).toBe(N | E | S);
    expect(ringMask(plan, 10, 10) & W).toBe(0);
  });

  it("pitches the camp's fire first and up to three tents on open ground inside the room", () => {
    const plain = "0".repeat(2500);
    expect(campTiles(25, 25, plain)).toEqual({ fire: [25, 27], tents: [[23, 27], [27, 27], [23, 25]] });

    // A wall on the fire's first tile moves it along the ring.
    const walled = plain.slice(0, tileOf(25, 27)) + "1" + plain.slice(tileOf(25, 27) + 1);
    expect(campTiles(25, 25, walled)?.fire).toEqual([23, 27]);

    // Against the room's edge only the tiles inside it are used.
    expect(campTiles(1, 47, plain)).toEqual({ fire: [3, 47], tents: [[1, 45], [3, 45]] });
    expect(campTiles(25, 25, "1".repeat(2500))).toBeNull();
  });
});

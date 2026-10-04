import { describe, expect, it } from "vitest";
import {
  applyDiff,
  foreignUsers,
  gclLevel,
  mapVisualRooms,
  parseVisual,
  roomCoords,
  roomFromCoords,
  roomKey,
  splitKey,
} from "../viewer/shared/realm";
import { roomOrigin, shardPlane } from "../viewer/client/camera";
import { parseFont } from "../viewer/client/draw-visual";
import { fly } from "../viewer/client/director";

describe("viewer room names", () => {
  it("places rooms either side of the meridians with no gap", () => {
    expect(roomCoords("E0S0")).toEqual({ x: 0, y: 0 });
    expect(roomCoords("W0N0")).toEqual({ x: -1, y: -1 });
    expect(roomCoords("W48S8")).toEqual({ x: -49, y: 8 });
    expect(roomCoords("sim")).toBeUndefined();
  });

  it("turns coordinates back into the same names", () => {
    for (const name of ["E0S0", "W0N0", "W48S8", "E12N3"]) {
      const c = roomCoords(name)!;
      expect(roomFromCoords(c.x, c.y)).toBe(name);
    }
  });

  it("keys rooms by shard", () => {
    expect(splitKey(roomKey("shard1", "W48S8"))).toEqual({ shard: "shard1", room: "W48S8" });
  });

  it("sets each shard on its own plane so rooms of two shards never overlap", () => {
    expect(roomOrigin("shard1/E0S0")).toEqual({ x: shardPlane("shard1"), y: 0 });
    expect(roomOrigin("shard1/W0S0")!.x).toBe(shardPlane("shard1") - 50);
    expect(Math.abs(shardPlane("shard2") - shardPlane("shard1"))).toBeGreaterThan(60 * 2 * 50);
  });
});

describe("viewer applyDiff", () => {
  it("adds, changes, and removes objects and fields as the server's diffs say", () => {
    const objects: Record<string, any> = {
      a: { type: "creep", x: 1, y: 1, store: { energy: 50 } },
      b: { type: "road", x: 2, y: 2 },
    };
    applyDiff(objects, {
      a: { x: 2, store: { energy: null }, actionLog: { harvest: { x: 3, y: 3 } } },
      b: null,
      c: { type: "spawn", x: 5, y: 5 },
    });
    expect(objects).toEqual({
      a: { type: "creep", x: 2, y: 1, store: {}, actionLog: { harvest: { x: 3, y: 3 } } },
      c: { type: "spawn", x: 5, y: 5 },
    });
  });

  it("replaces arrays whole and does not share them with the diff", () => {
    const objects: Record<string, any> = { a: { body: [1, 2, 3] } };
    const diff = { a: { body: [4] } };
    applyDiff(objects, diff);
    diff.a.body.push(5);
    expect(objects.a.body).toEqual([4]);
  });
});

describe("viewer overlays", () => {
  it("reads one primitive per line and drops torn lines", () => {
    const items = parseVisual('{"t":"c","x":1,"y":2}\n{"t":"t","te\n\n{"t":"l","x1":0,"y1":0,"x2":1,"y2":1}');
    expect(items.map((v) => v.t)).toEqual(["c", "l"]);
    expect(parseVisual("")).toEqual([]);
    expect(parseVisual(null)).toEqual([]);
  });

  it("finds every room a map visual draws in", () => {
    const rooms = mapVisualRooms(
      parseVisual(
        [
          '{"t":"c","n":"W48S8","x":25,"y":25}',
          '{"t":"l","n1":"W48S8","x1":0,"y1":0,"n2":"W47S8","x2":1,"y2":1}',
          '{"t":"p","points":[{"n":"W46S8","x":1,"y":1},{"n":"W48S9","x":2,"y":2}]}',
        ].join("\n"),
      ),
    );
    expect([...rooms].sort()).toEqual(["W46S8", "W47S8", "W48S8", "W48S9"]);
  });

  it("reads RoomVisual fonts as tiles unless given in pixels", () => {
    expect(parseFont(undefined, 20)).toEqual({ css: "10px sans-serif", px: 10 });
    expect(parseFont(0.8, 20)).toEqual({ css: "16px sans-serif", px: 16 });
    expect(parseFont("italic 0.5 serif", 20)).toEqual({ css: "italic 10px serif", px: 10 });
    expect(parseFont("bold 14px Arial", 20)).toEqual({ css: "bold 14px Arial", px: 14 });
  });
});

describe("viewer map view", () => {
  it("counts other players and Invaders as foreign, but not us, Source Keepers, or map features", () => {
    const view = { w: [[1, 1]], s: [[2, 2]], me: [[3, 3]], "2": [[4, 4]], "3": [[5, 5]], rival: [[6, 6]], gone: [] };
    expect(foreignUsers(view, "me").sort()).toEqual(["2", "rival"]);
    expect(foreignUsers(undefined, "me")).toEqual([]);
  });

  it("works out GCL from control points", () => {
    expect(gclLevel(0)).toBe(1);
    expect(gclLevel(1_000_000)).toBe(2);
    expect(gclLevel(Math.pow(2, 2.4) * 1_000_000 + 1)).toBe(3);
  });
});

describe("viewer camera flights", () => {
  const a = { x: 0, y: 0, scale: 20 };
  const b = { x: 500, y: 100, scale: 16 };

  it("starts and ends on the two shots", () => {
    for (const [t, shot] of [[0, a], [1, b]] as const) {
      const v = fly(a, b, t, 2);
      expect(v.x).toBeCloseTo(shot.x);
      expect(v.y).toBeCloseTo(shot.y);
      expect(v.scale).toBeCloseTo(shot.scale);
    }
  });

  it("pulls back to the peak halfway", () => {
    expect(fly(a, b, 0.5, 2).scale).toBeCloseTo(2);
  });
});

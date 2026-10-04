import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_SOURCES = 105;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.TERRAIN_MASK_WALL = 1;
g.STRUCTURE_KEEPER_LAIR = "keeperLair";

const { findUnclaimedMinerAssignment } = await import("../src/services/services.creep.room");

const ROOM = "W1N1";
let clock = 1_000;

function at(x: number, y: number) {
  return { x, y, roomName: ROOM, getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) };
}

function miner(work: number, post?: string): Creep {
  return {
    name: `miner${Math.random()}`,
    room: { name: ROOM },
    body: Array(work).fill({ type: "work" }),
    memory: { role: "miner", assignedContainerId: post },
  } as unknown as Creep;
}

// Source s1 at 10,10 can be dug from three tiles, its post c1 at 11,10. Source
// s2 at 30,30 from one, its post c2 at 31,30.
function keep(creeps: Creep[]): Room {
  const open = new Set(["11,10", "9,9", "9,11", "31,30"]);
  const room = {
    name: ROOM,
    memory: {},
    getTerrain: () => ({ get: (x: number, y: number) => (open.has(`${x},${y}`) ? 0 : 1) }),
  } as Record<string, unknown>;
  const sources = [
    { id: "s1", pos: at(10, 10), room, energyCapacity: 3000 },
    { id: "s2", pos: at(30, 30), room, energyCapacity: 3000 },
  ];
  const containers = [
    { id: "c1", structureType: "container", pos: at(11, 10) },
    { id: "c2", structureType: "container", pos: at(31, 30) },
  ];
  room.find = (type: number) => (type === g.FIND_SOURCES ? sources : type === g.FIND_STRUCTURES ? containers : []);
  g.Game = { time: clock++, creeps: Object.fromEntries(creeps.map((c) => [c.name, c])) };
  g.Memory = { creeps: {}, rooms: {} };
  return room as unknown as Room;
}

describe("a miner with every post taken", () => {
  it("joins the post whose miners dig least, if its source has a tile to spare", () => {
    // c2's miners dig less, but its one tile is taken.
    const room = keep([miner(1, "c1"), miner(2, "c1"), miner(2, "c2")]);
    expect(findUnclaimedMinerAssignment(room)?.container.id).toBe("c1");
  });

  it("leaves alone a post whose miners already dig all its source gives", () => {
    const room = keep([miner(5, "c1"), miner(2, "c2")]);
    expect(findUnclaimedMinerAssignment(room)).toBeNull();
  });
});

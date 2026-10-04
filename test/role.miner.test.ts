import { describe, it, expect, vi } from "vitest";

const sourcePos = { x: 20, y: 16 };
const containerPos = { x: 21, y: 15 };

vi.mock("../src/services/services.creep", () => ({
  getSafeSources: () => [],
  harvestFromSource: vi.fn(),
  findUnclaimedMinerAssignment: () => null,
  isSourceSafe: () => true,
}));
vi.mock("../src/orchestrators/orchestrator.links", () => ({ sourceLinksHaveOutlet: () => false }));

const g = globalThis as Record<string, unknown>;
g.OK = 0;

const { runMiner } = await import("../src/roles/role.miner");

// A miner beside the source at 21,16, with another already on the container tile.
function coMiner(carried: number) {
  const calls: string[] = [];
  const source = { id: "src", pos: sourcePos };
  const container = { id: "box", pos: { ...containerPos, lookFor: () => [{}] } };
  g.Game = { getObjectById: (id: string) => ({ src: source, box: container })[id] ?? null };
  const creep = {
    room: { name: "W1N1" },
    memory: { role: "miner", assignedSourceId: "src", assignedContainerId: "box" },
    pos: {
      isEqualTo: () => false,
      isNearTo: (t: unknown) => t === source || t === container,
    },
    store: { energy: carried, getFreeCapacity: () => 50 - carried },
    getActiveBodyparts: () => 2,
    moveTo: () => 0,
    harvest: () => { calls.push("harvest"); return 0; },
    transfer: (t: { id: string }) => { calls.push(`transfer ${t.id}`); return 0; },
  };
  return { creep: creep as unknown as Creep, calls };
}

class Pos {
  constructor(public x: number, public y: number, public roomName = "W1N1") {}
  isEqualTo(p: { x: number; y: number }) {
    return p.x === this.x && p.y === this.y;
  }
  isNearTo(t: { x: number; y: number } | { pos: { x: number; y: number } }) {
    const p = "pos" in t ? t.pos : t;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y)) <= 1;
  }
  lookFor(type: string) {
    return type === "creep" && held.has(`${this.x},${this.y}`) ? [{}] : [];
  }
}
g.RoomPosition = Pos;
g.LOOK_CREEPS = "creep";
g.LOOK_STRUCTURES = "structure";
g.TERRAIN_MASK_WALL = 1;
g.OBSTACLE_OBJECT_TYPES = [];
// Tiles with a creep on them, and the open tiles around the source at 20,16.
let held = new Set<string>();
const open = new Set(["21,15", "21,16", "19,17", "20,15"]);

// A miner come to share the post, standing at 22,16: beside the container, out
// of the source's reach.
function newcomer(at = new Pos(22, 16)) {
  const moves: Array<{ x: number; y: number }> = [];
  const room = { name: "W1N1", getTerrain: () => ({ get: (x: number, y: number) => (open.has(`${x},${y}`) ? 0 : 1) }) };
  const source = { id: "src", pos: new Pos(sourcePos.x, sourcePos.y), room };
  const container = { id: "box", pos: new Pos(containerPos.x, containerPos.y) };
  g.Game = { getObjectById: (id: string) => ({ src: source, box: container })[id] ?? null };
  const creep = {
    room,
    memory: { role: "miner", assignedSourceId: "src", assignedContainerId: "box" },
    pos: at,
    store: { energy: 0, getFreeCapacity: () => 50 },
    getActiveBodyparts: () => 3,
    moveTo: (t: { x: number; y: number }) => { moves.push({ x: t.x, y: t.y }); return 0; },
    harvest: () => 0,
    transfer: () => 0,
  };
  return { creep: creep as unknown as Creep, moves };
}

describe("a miner come to share a post", () => {
  it("takes a free tile beside the source and the container while both are held", () => {
    held = new Set(["21,15", "21,16"]);
    const { creep, moves } = newcomer();
    runMiner(creep);
    expect(moves).toEqual([{ x: 20, y: 15 }]);
  });

  it("walks onto the container once its tile is free", () => {
    held = new Set(["21,16"]);
    const { creep, moves } = newcomer();
    runMiner(creep);
    expect(moves).toEqual([{ x: 21, y: 15 }]);
  });

  it("keeps its seat beside the source while the container's tile is held", () => {
    held = new Set(["21,15", "21,16"]);
    const { creep, moves } = newcomer(new Pos(21, 16));
    runMiner(creep);
    expect(moves).toEqual([]);
  });
});

describe("a second miner at a post", () => {
  it("hands its gold in to the container before the next dig would spill it", () => {
    const { creep, calls } = coMiner(48);
    runMiner(creep);
    expect(calls).toEqual(["transfer box", "harvest"]);
  });

  it("only digs while the next dig still fits", () => {
    const { creep, calls } = coMiner(46);
    runMiner(creep);
    expect(calls).toEqual(["harvest"]);
  });
});

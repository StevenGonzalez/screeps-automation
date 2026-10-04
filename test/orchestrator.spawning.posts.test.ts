import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;

g.FIND_MY_SPAWNS = 108;
g.TERRAIN_MASK_WALL = 1;

const { shouldSpawnHauler, shouldSpawnMiner } = await import("../src/orchestrators/orchestrator.spawning.economy");
const { ROLE_MINER, ROLE_HAULER } = await import("../src/config/config.roles");

const ROOM = "W1N1";
let clock = 1_000;

function creep(role: string, work: number, carry: number, containerId?: string, sourceId?: string): Creep {
  const body = [
    ...Array(work).fill({ type: "work" }),
    ...Array(carry).fill({ type: "carry" }),
    { type: "move" },
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    ticksToLive: 1400,
    room: { name: ROOM },
    body,
    memory: { role, homeRoom: ROOM, assignedContainerId: containerId, assignedSourceId: sourceId },
  } as unknown as Creep;
}

// A keep with two source containers ten steps from its barracks. Given
// `seats`, its source s1 can be dug from that many tiles.
function keep(capacity: number, creeps: Creep[], seats?: number): Room {
  const spawn = { id: "spawn1", spawning: null, pos: { x: 25, y: 25 } };
  const containers = ["c1", "c2"].map((id) => ({ id, pos: { x: 25, y: 15 }, store: { energy: 50 } }));
  const source = { id: "s1", pos: { x: 24, y: 15 } };
  const around = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [24 + dx, 15 + dy])).filter(([x, y]) => x !== 24 || y !== 15);
  const open = new Set(around.slice(0, seats ?? 0).map(([x, y]) => `${x},${y}`));
  const room = {
    name: ROOM,
    energyAvailable: capacity,
    energyCapacityAvailable: capacity,
    memory: { spawnId: "spawn1", containerIds: ["c1", "c2"], minerContainerIds: ["c1", "c2"] },
    find: (type: number) => (type === g.FIND_MY_SPAWNS ? [spawn] : []),
    getTerrain: () => ({ get: (x: number, y: number) => (open.has(`${x},${y}`) ? 0 : 1) }),
  } as unknown as Room;
  g.Game = {
    time: clock++,
    creeps: Object.fromEntries(creeps.map((c) => [c.name, c])),
    rooms: { [ROOM]: room },
    getObjectById: (id: string) =>
      id === "spawn1" ? spawn : id === "s1" && seats !== undefined ? source : containers.find((c) => c.id === id) ?? null,
  };
  g.Memory = { creeps: {}, rooms: { [ROOM]: room.memory } };
  g.PathFinder = { search: () => ({ incomplete: false, path: new Array(10).fill({ x: 0, y: 0 }) }) };
  return room;
}

describe("porters for a young keep", () => {
  it("plans for what two-WORK miners dig, not the sources' full yield", () => {
    const room = keep(350, [
      creep(ROLE_MINER, 2, 1, "c1"),
      creep(ROLE_MINER, 2, 1, "c2"),
      creep(ROLE_HAULER, 0, 4),
      creep(ROLE_HAULER, 0, 4),
    ]);
    expect(shouldSpawnHauler(room)).toBe(false);
  });

  it("counts every miner digging at a post", () => {
    const room = keep(350, [
      creep(ROLE_MINER, 2, 1, "c1"),
      creep(ROLE_MINER, 2, 1, "c1"),
      creep(ROLE_MINER, 1, 0, "c1"),
      creep(ROLE_MINER, 2, 1, "c2"),
      creep(ROLE_HAULER, 0, 4),
      creep(ROLE_HAULER, 0, 4),
    ]);
    expect(shouldSpawnHauler(room)).toBe(true);
  });
});

describe("miners for a young keep", () => {
  // At 400 capacity a new miner has three WORK.
  it("mans a post whose miners together dig as much as a new one", () => {
    const room = keep(400, [
      creep(ROLE_MINER, 1, 0, "c1"),
      creep(ROLE_MINER, 2, 1, "c1"),
      creep(ROLE_MINER, 2, 1, "c2"),
      creep(ROLE_MINER, 2, 1, "c2"),
    ]);
    expect(shouldSpawnMiner(room)).toBe(false);
  });

  it("sends a bigger miner to a post its runt alone holds", () => {
    const room = keep(400, [
      creep(ROLE_MINER, 1, 0, "c1"),
      creep(ROLE_MINER, 2, 1, "c1"),
      creep(ROLE_MINER, 2, 1, "c2"),
    ]);
    expect(shouldSpawnMiner(room)).toBe(true);
  });

  it("mans a post whose miners fill every tile its source is dug from", () => {
    const miners = () => [
      creep(ROLE_MINER, 1, 0, "c1", "s1"),
      creep(ROLE_MINER, 1, 0, "c1", "s1"),
      creep(ROLE_MINER, 3, 1, "c2", "s2"),
    ];
    expect(shouldSpawnMiner(keep(400, miners(), 2))).toBe(false);
    expect(shouldSpawnMiner(keep(400, miners(), 3))).toBe(true);
  });
});

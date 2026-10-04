import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;

g.FIND_MY_SPAWNS = 108;
g.TERRAIN_MASK_WALL = 1;

const { buildMinerBody, shouldSpawnHauler, shouldSpawnMiner } = await import("../src/orchestrators/orchestrator.spawning.economy");
const { ROLE_MINER, ROLE_HAULER } = await import("../src/config/config.roles");

const ROOM = "W1N1";
let clock = 1_000;

function creep(role: string, work: number, carry: number, containerId?: string, sourceId?: string, ttl = 1400): Creep {
  const body = [
    ...Array(work).fill({ type: "work" }),
    ...Array(carry).fill({ type: "carry" }),
    { type: "move" },
  ];
  return {
    name: `${role}${Math.random()}`,
    spawning: false,
    ticksToLive: ttl,
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

describe("a miner's replacement", () => {
  // At 2300 capacity the barracks can be held 138 ticks by a 46-part body, on
  // top of the new miner's own 21 ticks in the spawn and 10 on the road: a
  // lead of 169.
  const miners = (ttl: number) => [creep(ROLE_MINER, 5, 1, "c1", undefined, ttl), creep(ROLE_MINER, 5, 1, "c2")];

  it("is raised early enough to outlast the longest body the barracks may be spawning", () => {
    expect(shouldSpawnMiner(keep(2300, miners(169)))).toBe(true);
  });

  it("waits while the miner has longer left than that", () => {
    expect(shouldSpawnMiner(keep(2300, miners(170)))).toBe(false);
  });

  it("keeps a young keep's margin to the small bodies it can afford", () => {
    // At 550 the longest body is eleven parts, 33 ticks, and the miner's own
    // six parts take 18: a lead of 61.
    expect(shouldSpawnMiner(keep(550, miners(61)))).toBe(true);
    expect(shouldSpawnMiner(keep(550, miners(62)))).toBe(false);
  });
});

describe("a miner's body", () => {
  const parts = (body: BodyPartConstant[]) => body.join(",");

  it("drops its CARRY for a fifth WORK when that is all the gold allows", () => {
    expect(parts(buildMinerBody(550))).toBe("work,work,work,work,work,move");
  });

  it("keeps its CARRY once the gold covers it as well", () => {
    expect(parts(buildMinerBody(600))).toBe("work,work,work,work,work,carry,move");
  });

  it("keeps its CARRY while five WORK are out of reach anyway", () => {
    expect(parts(buildMinerBody(500))).toBe("work,work,work,work,carry,move");
  });
});

import { describe, it, expect, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_HOSTILE_CREEPS = 103;
g.STRUCTURE_WALL = "constructedWall";
g.RESOURCE_ENERGY = "energy";
g.ATTACK = "attack";
g.RANGED_ATTACK = "ranged_attack";
g.STRUCTURE_KEEPER_LAIR = "keeperLair";
g.FIND_CONSTRUCTION_SITES = 111;
g.STRUCTURE_STORAGE = "storage";

import {
  barrierTargetFn,
  findMostCriticalRepairTarget,
  findTowerDefenseRepairTarget,
  findTowerRepairTarget,
  clearRemotePlayerHostile,
  markRemotePlayerHostile,
} from "../src/services/services.creep";

let tick = 1000;

function rampart(id: string, x: number, y: number, hits: number) {
  return {
    id,
    structureType: "rampart",
    pos: {
      x,
      y,
      getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)),
    },
    hits,
    hitsMax: 300_000_000,
  } as unknown as AnyStructure;
}

function makeRoom(opts: {
  level: number;
  structures: AnyStructure[];
  planned?: Record<string, string[]>;
  perimeter?: string[];
  storageEnergy?: number;
  hostiles?: unknown[];
  sites?: unknown[];
}): Room {
  return {
    name: "W1N1",
    controller: { level: opts.level },
    storage: opts.storageEnergy === undefined ? undefined : { store: { energy: opts.storageEnergy } },
    memory: { plannedStructures: opts.planned ?? {}, perimeterTiles: opts.perimeter },
    find: (type: number) => {
      if (type === g.FIND_STRUCTURES) return opts.structures;
      if (type === g.FIND_HOSTILE_CREEPS) return opts.hostiles ?? [];
      if (type === g.FIND_CONSTRUCTION_SITES) return opts.sites ?? [];
      return [];
    },
    lookForAt: () => [],
  } as unknown as Room;
}

function repairFor(room: Room): AnyStructure | null {
  return findMostCriticalRepairTarget({ room } as unknown as Creep);
}

describe("findMostCriticalRepairTarget ramparts", () => {
  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
    g.Memory = {};
  });

  it("leaves a bare rampart off the stored ring alone, even when decaying", () => {
    const stale = rampart("stale", 5, 5, 500);
    const room = makeRoom({ level: 8, structures: [stale], perimeter: ["20,20"] });
    expect(repairFor(room)).toBeNull();
  });

  it("gives a wall off the stored ring no goal, and the perimeter's until a ring is stored", () => {
    const wall = { ...rampart("wall", 5, 5, 500), structureType: "constructedWall" } as AnyStructure;
    const onRing = { ...rampart("ring", 20, 20, 500), structureType: "constructedWall" } as AnyStructure;
    const ringed = barrierTargetFn(makeRoom({ level: 8, structures: [], perimeter: ["20,20"] }));
    expect(ringed(wall)).toBe(0);
    expect(ringed(onRing)).toBeGreaterThan(0);
    expect(barrierTargetFn(makeRoom({ level: 8, structures: [] }))(wall)).toBe(ringed(onRing));
  });

  it("repairs every bare rampart as perimeter until a ring is stored", () => {
    const bare = rampart("bare", 5, 5, 500);
    const room = makeRoom({ level: 8, structures: [bare] });
    expect(repairFor(room)?.id).toBe("bare");
  });

  it("keeps repairing built perimeter ramparts after the plan drops their tiles", () => {
    // The planner prunes built tiles from stamp_ramparts; the stored ring is what counts.
    const built = rampart("built", 20, 20, 500);
    const room = makeRoom({
      level: 8,
      structures: [built],
      planned: { stamp_ramparts: [] },
      perimeter: ["20,20"],
    });
    expect(repairFor(room)?.id).toBe("built");
  });

  it("stops on-top ramparts at their lower target", () => {
    const onTop = rampart("onTop", 10, 10, 400_000);
    const spawn = { id: "spawn", structureType: "spawn", pos: { x: 10, y: 10 }, hits: 5000, hitsMax: 5000 };
    const room = makeRoom({
      level: 8,
      structures: [onTop, spawn as unknown as AnyStructure],
      perimeter: ["20,20"],
      storageEnergy: 500_000,
    });
    expect(repairFor(room)).toBeNull();
  });

  it("works the nearest of the ramparts about as weak as the weakest", () => {
    // A ring all within a few thousand hits: one tick of repair lifts a rampart
    // past the next weakest, which can be on the far side of the base.
    const far = rampart("far", 40, 30, 15_100);
    const near = rampart("near", 10, 10, 15_500);
    const room = makeRoom({ level: 6, structures: [far, near], perimeter: ["40,30", "10,10"] });
    const smith = { room, pos: { getRangeTo: (t: AnyStructure) => t.pos.getRangeTo({ x: 9, y: 10 } as RoomPosition) } };
    expect(findMostCriticalRepairTarget(smith as unknown as Creep)?.id).toBe("near");
  });

  it("still goes to a rampart left far weaker than the rest", () => {
    const far = rampart("far", 40, 30, 2_500);
    const near = rampart("near", 10, 10, 40_000);
    const room = makeRoom({ level: 6, structures: [far, near], perimeter: ["40,30", "10,10"] });
    const smith = { room, pos: { getRangeTo: (t: AnyStructure) => t.pos.getRangeTo({ x: 9, y: 10 } as RoomPosition) } };
    expect(findMostCriticalRepairTarget(smith as unknown as Creep)?.id).toBe("far");
  });

  it("leaves raising the walls while the castle saves for a keep", () => {
    (g.Memory as Memory).expansionSavings = { room: "W1N1", target: "W1N2" };
    const wall = rampart("perim", 20, 20, 15_000);
    const saving = makeRoom({ level: 6, structures: [wall], perimeter: ["20,20"], storageEnergy: 30_000 });
    expect(repairFor(saving)).toBeNull();

    tick++;
    g.Game = { time: tick };
    const saved = makeRoom({ level: 6, structures: [wall], perimeter: ["20,20"], storageEnergy: 50_000 });
    expect(repairFor(saved)?.id).toBe("perim");
  });

  // Thornbarrow's two blacksmiths raised its ramparts on the gold by the throne
  // while its masons stood at drained containers with the storage unbuilt.
  it("leaves raising the walls while the castle builds its storage", () => {
    const wall = rampart("perim", 20, 20, 15_000);
    const plain = makeRoom({ level: 4, structures: [wall], perimeter: ["20,20"] });
    expect(repairFor(plain)?.id).toBe("perim");

    tick++;
    g.Game = { time: tick };
    const building = makeRoom({
      level: 4,
      structures: [wall],
      perimeter: ["20,20"],
      sites: [{ structureType: "extension" }, { structureType: "storage" }],
    });
    expect(repairFor(building)).toBeNull();
  });

  it("raises the walls under attack whatever the treasury holds", () => {
    (g.Memory as Memory).expansionSavings = { room: "W1N1", target: "W1N2" };
    const wall = rampart("perim", 20, 20, 15_000);
    const raider = { pos: { x: 25, y: 25 }, getActiveBodyparts: (t: string) => (t === g.ATTACK ? 4 : 0) };
    const room = makeRoom({
      level: 6,
      structures: [wall],
      perimeter: ["20,20"],
      storageEnergy: 30_000,
      hostiles: [raider],
    });
    expect(repairFor(room)?.id).toBe("perim");
  });

  it("keeps a decaying rampart standing whatever the treasury holds", () => {
    (g.Memory as Memory).expansionSavings = { room: "W1N1", target: "W1N2" };
    const wall = rampart("perim", 20, 20, 1_500);
    const room = makeRoom({ level: 6, structures: [wall], perimeter: ["20,20"], storageEnergy: 30_000 });
    expect(repairFor(room)?.id).toBe("perim");
  });

  it("counts a rampart within a band of its goal as standing", () => {
    // Grimford's ramparts stood at their 50K goal, each decaying a few hits a
    // tick, and its two blacksmiths crossed the keep to top up whichever had
    // slipped under it, a tick of work a trip.
    const slipped = rampart("slipped", 20, 20, 45_000);
    const standing = makeRoom({ level: 4, structures: [slipped], perimeter: ["20,20"] });
    expect(repairFor(standing)).toBeNull();

    tick++;
    g.Game = { time: tick };
    const fallen = rampart("fallen", 20, 20, 39_000);
    const low = makeRoom({ level: 4, structures: [fallen], perimeter: ["20,20"] });
    expect(repairFor(low)?.id).toBe("fallen");
  });

  it("holds the perimeter at 1M until storage has energy to spare", () => {
    const wall = rampart("perim", 20, 20, 1_500_000);
    const poor = makeRoom({
      level: 8,
      structures: [wall],
      perimeter: ["20,20"],
      storageEnergy: 50_000,
    });
    expect(repairFor(poor)).toBeNull();

    tick++;
    g.Game = { time: tick };
    const rich = makeRoom({
      level: 8,
      structures: [wall],
      perimeter: ["20,20"],
      storageEnergy: 500_000,
    });
    expect(repairFor(rich)?.id).toBe("perim");
  });
});

describe("findMostCriticalRepairTarget upkeep", () => {
  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
    g.Memory = {};
  });

  function container(id: string, x: number, y: number, hits: number) {
    return {
      id,
      structureType: "container",
      pos: {
        x,
        y,
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)),
      },
      hits,
      hitsMax: 250_000,
    } as unknown as AnyStructure;
  }

  function road(id: string, x: number, y: number, hits: number) {
    return {
      id,
      structureType: "road",
      pos: {
        x,
        y,
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)),
      },
      hits,
      hitsMax: 5000,
    } as unknown as AnyStructure;
  }

  function smithAt(room: Room, x: number, y: number): Creep {
    return { room, pos: { getRangeTo: (t: AnyStructure) => t.pos.getRangeTo({ x, y } as RoomPosition) } } as unknown as Creep;
  }

  it("lets a worn road wait while the walls are raised", () => {
    // Grimford's two blacksmiths left their rampart for a road 25 tiles off,
    // gave it a tick of work and walked 32 tiles back to the walls.
    const worn = road("road", 10, 10, 3000);
    const wall = rampart("wall", 40, 40, 100_000);
    const room = makeRoom({ level: 6, structures: [worn, wall], perimeter: ["40,40"] });
    expect(findMostCriticalRepairTarget(smithAt(room, 10, 11))?.id).toBe("wall");
  });

  it("mends a worn road once the walls stand or wait on the treasury", () => {
    const worn = road("road", 10, 10, 3000);
    const whole = rampart("wall", 40, 40, 300_000);
    const standing = makeRoom({ level: 6, structures: [worn, whole], perimeter: ["40,40"] });
    expect(findMostCriticalRepairTarget(smithAt(standing, 40, 41))?.id).toBe("road");

    tick++;
    g.Game = { time: tick };
    const low = rampart("wall", 40, 40, 100_000);
    const building = makeRoom({
      level: 4,
      structures: [worn, low],
      perimeter: ["40,40"],
      sites: [{ structureType: "storage" }],
    });
    expect(findMostCriticalRepairTarget(smithAt(building, 40, 41))?.id).toBe("road");
  });

  it("mends a worn container before raising the walls", () => {
    const worn = container("box", 10, 10, 150_000);
    const wall = rampart("wall", 40, 40, 100_000);
    const room = makeRoom({ level: 6, structures: [worn, wall], perimeter: ["40,40"] });
    expect(findMostCriticalRepairTarget(smithAt(room, 40, 41))?.id).toBe("box");
  });

  it("mends the nearest worn container rather than the most worn", () => {
    // Two containers across the keep, one a little more worn. A tick of repair
    // made the other the more worn, and both blacksmiths turned round and
    // crossed the keep to it, back and forth, spending nothing.
    const far = container("far", 10, 6, 182_500);
    const near = container("near", 12, 38, 187_500);
    const room = makeRoom({ level: 6, structures: [far, near] });
    const smith = { room, pos: { getRangeTo: (t: AnyStructure) => t.pos.getRangeTo({ x: 13, y: 36 } as RoomPosition) } };
    expect(findMostCriticalRepairTarget(smith as unknown as Creep)?.id).toBe("near");
  });
});

describe("findTowerDefenseRepairTarget", () => {
  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
  });

  it("prefers the barrier a breaker is standing at over the weakest one", () => {
    const far = rampart("far", 5, 5, 1_000);
    const near = rampart("near", 30, 30, 50_000);
    const breaker = {
      pos: {
        getRangeTo: (p: { x: number; y: number }) => Math.max(Math.abs(p.x - 31), Math.abs(p.y - 30)),
      },
      body: [{ type: "work", hits: 100 }],
    };
    const room = makeRoom({ level: 8, structures: [far, near], hostiles: [breaker] });
    expect(findTowerDefenseRepairTarget(room)?.id).toBe("near");
  });

  it("falls back to the weakest barrier when nothing is threatening one", () => {
    const far = rampart("far", 5, 5, 1_000);
    const near = rampart("near", 30, 30, 50_000);
    const room = makeRoom({ level: 8, structures: [far, near] });
    expect(findTowerDefenseRepairTarget(room)?.id).toBe("far");
  });
});

describe("remote player strikes", () => {
  function entry(): RemoteRoomData {
    return { roomName: "W2N1", sources: [], lastSeen: 0, hostile: false };
  }

  beforeEach(() => {
    g.Memory = {};
  });

  it("escalates across visits instead of resetting on the first clean look", () => {
    const e = entry();
    g.Game = { time: 10_000 };
    markRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(1);

    g.Game = { time: 10_100 };
    clearRemotePlayerHostile(e);
    expect(e.hostile).toBe(false);
    expect(e.hostileStrikes).toBe(1);

    g.Game = { time: 10_500 };
    markRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(2);
    expect(e.hostileUntil).toBe(10_500 + 4000);
  });

  it("writes one chronicle line for a player who keeps coming back", () => {
    const e = entry();
    g.Game = { time: 10_000 };
    markRemotePlayerHostile(e, "Rival");

    g.Game = { time: 10_100 };
    clearRemotePlayerHostile(e);
    g.Game = { time: 10_500 };
    markRemotePlayerHostile(e, "Rival");

    const log = (g.Memory as Memory).chronicle ?? [];
    expect(log.map((l) => l.text)).toEqual(["The men of Rival the Fair hold the Shadow March. The vendors keep away."]);
  });

  it("remembers who holds the remote for the realm map until it is clear again", () => {
    const e = entry();
    g.Game = { time: 10_000 };
    markRemotePlayerHostile(e, "Rival");
    expect(e.rival).toBe("Rival");
    // A later sighting with no name to give keeps the one already known.
    markRemotePlayerHostile(e);
    expect(e.rival).toBe("Rival");

    g.Game = { time: 10_100 };
    clearRemotePlayerHostile(e);
    expect(e.rival).toBeUndefined();
  });

  it("forgives one strike per clean window", () => {
    // Three strikes, the last window having ended at tick 1000.
    const e = { ...entry(), hostile: true, hostileStrikes: 3, hostileUntil: 1000 };

    g.Game = { time: 1000 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(3);

    g.Game = { time: 5100 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(1);
    expect(e.hostileUntil).toBeLessThanOrEqual(5100);

    g.Game = { time: 7100 };
    clearRemotePlayerHostile(e);
    expect(e.hostileStrikes).toBe(0);
    expect(e.hostileUntil).toBeUndefined();
  });
});

describe("road upkeep under a blueprint", () => {
  function road(id: string, x: number, y: number, hits: number) {
    return { id, structureType: "road", pos: { x, y }, hits, hitsMax: 5000 } as unknown as AnyStructure;
  }

  function plannedRoom(structures: AnyStructure[], lanes: Array<"top" | "left"> = []): Room {
    const room = makeRoom({ level: 6, structures });
    // Blueprint roads at 10,10; the top exit road runs through 10,2.
    room.memory.blueprint = { v: 1, at: tick, anchor: { x: 10, y: 12 }, hub: { x: 10, y: 11 }, s: "R10,10,2", exits: { top: "10,2" }, lanes };
    return room;
  }

  beforeEach(() => {
    tick++;
    g.Game = { time: tick };
  });

  it("lets a road off the plan decay", () => {
    const room = plannedRoom([road("stray", 30, 30, 100)]);
    expect(repairFor(room)).toBeNull();
    expect(findTowerRepairTarget(room)).toBeNull();
  });

  it("keeps up the plan's roads and the exit roads in use", () => {
    // Repair targets are cached for the tick, so each room gets a tick of its own.
    const next = () => (g.Game = { time: ++tick });
    expect(repairFor(plannedRoom([road("kept", 10, 10, 100)]))?.id).toBe("kept");
    next();
    expect(repairFor(plannedRoom([road("lane", 10, 2, 100)], ["top"]))?.id).toBe("lane");
    next();
    expect(repairFor(plannedRoom([road("idle", 10, 2, 100)]))).toBeNull();
  });
});

describe("tower upkeep", () => {
  function road(id: string, hits: number) {
    return { id, structureType: "road", pos: { x: 20, y: 20 }, hits, hitsMax: 5000 } as unknown as AnyStructure;
  }

  it("looks over the keep again only some ticks after finding nothing to mend", () => {
    const structures = [road("road", 5000)];
    let looks = 0;
    const room = makeRoom({ level: 6, structures });
    room.name = `W1N1-towers-${tick}`;
    const find = room.find.bind(room);
    room.find = ((type: number) => {
      if (type === g.FIND_STRUCTURES) looks++;
      return find(type);
    }) as Room["find"];

    g.Game = { time: ++tick };
    expect(findTowerRepairTarget(room)).toBeNull();
    const first = looks;

    (structures[0] as { hits: number }).hits = 1000;
    g.Game = { time: ++tick };
    expect(findTowerRepairTarget(room)).toBeNull();
    expect(looks).toBe(first);

    tick += 10;
    g.Game = { time: tick };
    expect(findTowerRepairTarget(room)?.id).toBe("road");
  });
});

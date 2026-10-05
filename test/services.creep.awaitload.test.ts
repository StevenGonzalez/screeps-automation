import { describe, it, expect } from "vitest";

const g = globalThis as Record<string, unknown>;
g.FIND_STRUCTURES = 107;
g.FIND_MY_CREEPS = 102;
g.FIND_DROPPED_RESOURCES = 106;
g.FIND_TOMBSTONES = 118;
g.FIND_SOURCES = 105;
g.STRUCTURE_CONTAINER = "container";
g.STRUCTURE_STORAGE = "storage";
g.ERR_NOT_IN_RANGE = -9;
g.OK = 0;

import { acquireEnergy, findFullestMinerContainer } from "../src/services/services.creep";
import { runRepairer } from "../src/roles/role.repairer";
import { ROLE_BUILDER, ROLE_HAULER, ROLE_MINER, ROLE_REPAIRER } from "../src/config/config.roles";

let clock = 7000;

type Opts = {
  energy: number;
  role?: string;
  creepFree?: number;
  containerFree?: number;
  sourceEnergy?: number;
  minerSpawning?: boolean;
  near?: boolean;
  dropped?: boolean;
};

// A worker at Grimford, which has no storage, beside the container its miner
// digs into ten gold a tick, with a porter further down the road.
function scenario(o: Opts) {
  clock++;
  const near = o.near ?? true;
  const container = {
    id: "cont",
    structureType: "container",
    pos: { x: 10, y: 21 },
    store: { energy: o.energy, getFreeCapacity: () => o.containerFree ?? 2000 - o.energy },
  };
  const source = { id: "src", energy: o.sourceEnergy ?? 3000 };
  const miner = {
    name: "Miner Odo",
    spawning: !!o.minerSpawning,
    memory: { role: ROLE_MINER, assignedContainerId: "cont", assignedSourceId: "src" },
  };
  const pile = { id: "pile", resourceType: "energy", amount: 40 };
  const room = {
    name: `W48S7-${clock}`,
    memory: { minerContainerIds: ["cont"] },
    find: (type: number) => {
      if (type === g.FIND_STRUCTURES) return [container];
      if (type === g.FIND_MY_CREEPS) return [miner];
      return [];
    },
  };
  const withdrawn: string[] = [];
  const picked: string[] = [];
  const creep = {
    name: "Mason Hamo",
    room,
    memory: { role: o.role ?? ROLE_BUILDER } as CreepMemory,
    pos: {
      isNearTo: () => near,
      getRangeTo: () => (near ? 1 : 10),
      findInRange: () => (o.dropped ? [pile] : []),
      findClosestByPath: (t: unknown[] | number) => (Array.isArray(t) ? t[0] ?? null : null),
    },
    store: { energy: 0, getFreeCapacity: () => o.creepFree ?? 300 },
    withdraw: (t: { id: string }) => (withdrawn.push(t.id), near ? g.OK : g.ERR_NOT_IN_RANGE),
    pickup: (t: { id: string }) => (picked.push(t.id), g.OK),
    moveTo: () => g.OK,
  };
  const porter = {
    name: "Porter Bo",
    room,
    memory: { role: ROLE_HAULER } as CreepMemory,
    pos: { getRangeTo: () => 8 },
    store: { energy: 0, getFreeCapacity: () => 400 },
  };
  g.Game = {
    time: clock,
    creeps: { [creep.name]: creep, [porter.name]: porter },
    getObjectById: (id: string) => ({ cont: container, src: source } as Record<string, unknown>)[id] ?? null,
  };
  g.Memory = { creeps: {}, rooms: {} };
  return {
    creep: creep as unknown as Creep,
    porter: porter as unknown as Creep,
    withdrawn,
    picked,
  };
}

describe("a worker at a miner container", () => {
  it("waits beside it while its load gathers, and claims the gold", () => {
    const { creep, withdrawn } = scenario({ energy: 100 });
    expect(acquireEnergy(creep)).toBe(true);
    expect(withdrawn).toEqual([]);
    expect(creep.memory.haulFromId).toBe("cont");
    expect(creep.memory.energySourceId).toBe("cont");
  });

  it("keeps waiting for the container it chose", () => {
    const { creep, withdrawn } = scenario({ energy: 100 });
    creep.memory.energySourceId = "cont" as Id<AnyStoreStructure>;
    expect(acquireEnergy(creep)).toBe(true);
    expect(withdrawn).toEqual([]);
    expect(creep.memory.energySourceId).toBe("cont");
  });

  it("draws once the container holds a full load, and lets the claim go", () => {
    const { creep, withdrawn } = scenario({ energy: 300 });
    creep.memory.haulFromId = "cont" as Id<StructureContainer>;
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
    expect(creep.memory.haulFromId).toBeUndefined();
  });

  it("draws what there is once the container is full", () => {
    const { creep, withdrawn } = scenario({ energy: 2000, creepFree: 2500, containerFree: 0 });
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
  });

  it("draws what there is when the source is dug out", () => {
    const { creep, withdrawn } = scenario({ energy: 100, sourceEnergy: 0 });
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
  });

  it("draws what there is while the miner is still being born", () => {
    const { creep, withdrawn } = scenario({ energy: 100, minerSpawning: true });
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
  });

  it("walks to the container rather than waiting from afar", () => {
    const { creep, withdrawn } = scenario({ energy: 100, near: false });
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
    expect(creep.memory.haulFromId).toBeUndefined();
  });

  it("lets its claim go when it turns to other gold", () => {
    const { creep, picked } = scenario({ energy: 100, dropped: true });
    creep.memory.haulFromId = "cont" as Id<StructureContainer>;
    acquireEnergy(creep);
    expect(picked).toEqual(["pile"]);
    expect(creep.memory.haulFromId).toBeUndefined();
  });

  it("is left the gold it waits for by a porter further off", () => {
    const { creep, porter } = scenario({ energy: 250 });
    expect(findFullestMinerContainer(porter, 100)?.id).toBe("cont");
    acquireEnergy(creep);
    expect(findFullestMinerContainer(porter, 100)).toBeNull();
  });

  it("does not hold up a porter, which keeps its own claims", () => {
    const { creep, withdrawn } = scenario({ energy: 100, role: ROLE_HAULER });
    acquireEnergy(creep);
    expect(withdrawn).toEqual(["cont"]);
  });

  it("waits likewise when it is a blacksmith in a keep with no storage", () => {
    const { creep, withdrawn } = scenario({ energy: 100, role: ROLE_REPAIRER });
    runRepairer(creep);
    expect(withdrawn).toEqual([]);
    expect(creep.memory.haulFromId).toBe("cont");

    const full = scenario({ energy: 300, role: ROLE_REPAIRER });
    full.creep.memory.haulFromId = "cont" as Id<StructureContainer>;
    runRepairer(full.creep);
    expect(full.withdrawn).toEqual(["cont"]);
    expect(full.creep.memory.haulFromId).toBeUndefined();
  });
});

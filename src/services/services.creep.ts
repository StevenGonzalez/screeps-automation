import { ENERGY_DEPOSIT_PRIORITY } from "../config/config.roles";

export function findClosestSource(creep: Creep): Source | null {
  return creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
}

export function findEnergyDepositTarget(
  creep: Creep,
  role: string
): Structure | null {
  const priorityList = ENERGY_DEPOSIT_PRIORITY[role] || [];

  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (structure): structure is AnyStoreStructure => {
      return (
        priorityList.includes(structure.structureType) &&
        "store" in structure &&
        structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      );
    },
  });

  if (targets.length > 0) {
    return creep.pos.findClosestByPath(targets);
  }
  return null;
}

export function getClosestSpawn(
  room: Room,
  pos: RoomPosition
): StructureSpawn | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;
  return pos.findClosestByPath(spawns);
}

export function getSources(room: Room, ttl: number = 100): Source[] {
  if (!Memory.sources) Memory.sources = {};
  if (!Memory.sourcesLastScan) Memory.sourcesLastScan = {};
  const lastScan = Memory.sourcesLastScan[room.name] || 0;
  if (!Memory.sources[room.name] || Game.time - lastScan > ttl) {
    Memory.sources[room.name] = room.find(FIND_SOURCES).map((s) => s.id);
    Memory.sourcesLastScan[room.name] = Game.time;
  }
  const sourceIds: Id<Source>[] = Memory.sources[room.name];
  return sourceIds
    .map((id) => Game.getObjectById(id))
    .filter(Boolean) as Source[];
}

export function harvestFromSource(creep: Creep, source: Source): void {
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source);
  }
}

export function acquireEnergy(creep: Creep): boolean {
  const storeTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0,
  });
  if (storeTargets.length > 0) {
    const target = creep.pos.findClosestByPath(
      storeTargets
    ) as AnyStoreStructure;
    if (!target) return false;
    const res = creep.withdraw(target, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
      return true;
    }
    return res === OK;
  }

  const links = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_LINK && (s as StructureLink).energy > 0,
  }) as StructureLink[];
  if (links.length > 0) {
    const link = creep.pos.findClosestByPath(links)!;
    if (link) {
      const res = creep.withdraw(link, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(link);
        return true;
      }
      return res === OK;
    }
  }

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
    filter: (t) => t.store && t.store[RESOURCE_ENERGY] > 0,
  }) as Tombstone | null;
  if (tomb) {
    const res = creep.withdraw(tomb, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(tomb);
      return true;
    }
    return res === OK;
  }

  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY,
  }) as Resource | null;
  if (dropped) {
    const res = creep.pickup(dropped);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped);
      return true;
    }
    return res === OK;
  }

  const source = creep.pos.findClosestByPath(
    FIND_SOURCES_ACTIVE
  ) as Source | null;
  if (source) {
    const res = creep.harvest(source);
    if (res === ERR_NOT_IN_RANGE) {
      creep.moveTo(source);
      return true;
    }
    return res === OK;
  }

  return false;
}

export function isCreepEmpty(creep: Creep): boolean {
  return creep.store[RESOURCE_ENERGY] === 0;
}

export function isCreepFull(creep: Creep): boolean {
  return creep.store.getFreeCapacity() === 0;
}

export function transferEnergyTo(creep: Creep, target: Structure): void {
  if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  }
}

export function findClosestConstructionSite(
  creep: Creep
): ConstructionSite | null {
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[];
  if (!sites || sites.length === 0) return null;
  return creep.pos.findClosestByPath(sites) || null;
}

export function findClosestRepairTarget(creep: Creep): AnyStructure | null {
  const repairTargets = creep.room.find(FIND_STRUCTURES, {
    filter: (s) => {
      const hasHits =
        (s as any).hits !== undefined && (s as any).hitsMax !== undefined;
      if (!hasHits) return false;
      if (
        s.structureType === STRUCTURE_WALL ||
        s.structureType === STRUCTURE_RAMPART
      )
        return false;
      return (s as any).hits < (s as any).hitsMax;
    },
  }) as AnyStructure[];
  if (repairTargets.length === 0) return null;
  return creep.pos.findClosestByPath(repairTargets) || null;
}

export function findClosestDamagedRampart(
  creep: Creep
): StructureRampart | null {
  const ramp = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_RAMPART &&
      (s as StructureRampart).hits < (s as StructureRampart).hitsMax,
  }) as StructureRampart | null;
  return ramp;
}

export function findMostCriticalRepairTarget(
  creep: Creep
): AnyStructure | null {
  const damaged = creep.room.find(FIND_STRUCTURES, {
    filter: (s) => {
      const hasHits =
        (s as any).hits !== undefined && (s as any).hitsMax !== undefined;
      if (!hasHits) return false;
      if (s.structureType === STRUCTURE_WALL) return false;
      return (s as any).hits < (s as any).hitsMax;
    },
  }) as AnyStructure[];

  if (damaged.length === 0) return null;

  const ramparts = damaged.filter(
    (s) => s.structureType === STRUCTURE_RAMPART
  ) as StructureRampart[];
  if (ramparts.length > 0) {
    return ramparts.reduce((a, b) => (a.hits < b.hits ? a : b));
  }

  return damaged.reduce((best, cur) => {
    const bestRatio = best.hits / (best.hitsMax || 1);
    const curRatio = cur.hits / (cur.hitsMax || 1);
    return curRatio < bestRatio ? cur : best;
  });
}

export function getClosestContainerOrStorage(creep: Creep): Structure | null {
  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is AnyStoreStructure =>
      (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      "store" in s &&
      s.store[RESOURCE_ENERGY] > 0,
  });
  if (targets.length === 0) return null;
  return creep.pos.findClosestByPath(targets) as Structure | null;
}

export function upgradeController(creep: Creep): void {
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller);
    }
  }
}

export function buildAtConstructionSite(
  creep: Creep,
  site: ConstructionSite
): number {
  const res = creep.build(site);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(site);
  return res;
}

export function repairStructure(creep: Creep, target: AnyStructure): number {
  const res = creep.repair(target as AnyStructure);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(target.pos.x, target.pos.y);
  return res;
}

export function findContainersForSource(
  room: Room,
  source: Source
): StructureContainer[] {
  return room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.pos.getRangeTo(source.pos) <= 1,
  });
}

export function findUnclaimedMinerAssignment(
  room: Room
): { source: Source; container: StructureContainer } | null {
  const sources = getSources(room);
  for (const source of sources) {
    const containers = findContainersForSource(room, source);
    for (const container of containers) {
      const taken = Object.values(Game.creeps).some(
        (c) =>
          c.memory.role === "miner" &&
          c.memory.assignedContainerId === container.id
      );
      if (!taken) {
        return { source, container };
      }
    }
  }
  return null;
}

export function findUnclaimedHaulerAssignment(
  room: Room
): StructureContainer | null {
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER,
  });
  for (const container of containers) {
    const taken = Object.values(Game.creeps).some(
      (c) =>
        c.memory.role === "hauler" &&
        c.memory.assignedContainerId === container.id
    );
    if (!taken) {
      return container;
    }
  }
  return null;
}

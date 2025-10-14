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

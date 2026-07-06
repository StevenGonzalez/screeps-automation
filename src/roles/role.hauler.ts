import {
  acquireEnergy,
  transferEnergyTo,
  findUnclaimedHaulerAssignment,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestMinerContainerWithEnergy,
  findDepositTargetExcludingMiner,
  findEmptiestTower,
  findCoreFillTarget,
  putSurplusEnergyToWork,
} from "../services/services.creep";
import { getThreatInfo, seekBoost } from "../services/services.combat";
import { ROLE_FILLER } from "../config/config.roles";

let fillerCheckTick = -1;
const roomHasFiller: Record<string, boolean> = {};
function hasActiveFiller(room: Room): boolean {
  if (fillerCheckTick !== Game.time) {
    fillerCheckTick = Game.time;
    for (const k in roomHasFiller) delete roomHasFiller[k];
  }
  if (!(room.name in roomHasFiller)) {
    roomHasFiller[room.name] = room
      .find(FIND_MY_CREEPS)
      .some((c) => c.memory.role === ROLE_FILLER && !c.spawning);
  }
  return roomHasFiller[room.name];
}

export function runHauler(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  if (!creep.memory.assignedContainerId) {
    const assignment = findUnclaimedHaulerAssignment(creep.room);
    if (assignment) {
      creep.memory.assignedContainerId = assignment.id;
    }
  }

  const storageModel = !!creep.room.storage && hasActiveFiller(creep.room);

  if (creep.memory.working === undefined) creep.memory.working = false;
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
  if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    creep.memory.fillTargetId = undefined;
    if (collectEnergy(creep, storageModel)) return;
    if (creep.store[RESOURCE_ENERGY] === 0) return;
    creep.memory.working = true;
  }

  if (getThreatInfo(creep.room).hostiles.length > 0) {
    const tower = findEmptiestTower(creep.room);
    if (tower) {
      creep.memory.fillTargetId = tower.id;
      transferEnergyTo(creep, tower);
      return;
    }
  }

  if (!storageModel) {
    if (creep.memory.fillTargetId) {
      const cached = Game.getObjectById(creep.memory.fillTargetId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
      if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        transferEnergyTo(creep, cached as Structure);
        return;
      }
      creep.memory.fillTargetId = undefined;
    }

    const coreTarget = findCoreFillTarget(creep);
    if (coreTarget) {
      creep.memory.fillTargetId = coreTarget.id;
      transferEnergyTo(creep, coreTarget);
      return;
    }
  }

  const pending = creep.room.memory.pendingSend;
  if (pending && pending.resource === RESOURCE_ENERGY) {
    const termId = creep.room.memory.terminalId;
    const terminal = termId ? (Game.getObjectById(termId) as StructureTerminal | null) : null;
    if (terminal && (terminal.store[RESOURCE_ENERGY] ?? 0) < pending.loadTarget) {
      creep.memory.fillTargetId = terminal.id;
      transferEnergyTo(creep, terminal);
      return;
    }
  }

  const depositTarget = findDepositTargetExcludingMiner(creep);
  if (depositTarget) {
    creep.memory.fillTargetId = depositTarget.id;
    if (Memory.debugHaulers === creep.room.name) debugDeposit(creep, depositTarget);
    transferEnergyTo(creep, depositTarget);
    return;
  }

  putSurplusEnergyToWork(creep);
}

function debugDeposit(creep: Creep, target: Structure): void {
  const terrain = creep.room.getTerrain();
  const ring: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = target.pos.x + dx;
      const y = target.pos.y + dy;
      if (x < 0 || x > 49 || y < 0 || y > 49) {
        ring.push("x");
        continue;
      }
      const occupant = creep.room
        .lookForAt(LOOK_CREEPS, x, y)
        .find((c) => c.my);
      if (occupant) ring.push(occupant.memory.role[0]);
      else if (terrain.get(x, y) === TERRAIN_MASK_WALL) ring.push("#");
      else ring.push(".");
    }
  }

  const search = PathFinder.search(
    creep.pos,
    { pos: target.pos, range: 1 },
    { plainCost: 2, swampCost: 10, maxOps: 500 }
  );
  const step = search.path[0];
  let stepInfo = "none";
  if (step) {
    const onStep = creep.room.lookForAt(LOOK_CREEPS, step.x, step.y).find((c) => c.my);
    stepInfo = `${step.x},${step.y}:${onStep ? onStep.memory.role[0] : "free"}`;
  }

  const t = target as Structure & { structureType: string };
  console.log(
    `[H ${creep.name}] pos=${creep.pos.x},${creep.pos.y} st=${creep.store[RESOURCE_ENERGY]} ` +
      `-> ${t.structureType}@${target.pos.x},${target.pos.y} range=${creep.pos.getRangeTo(target)} ` +
      `next=${stepInfo} ring=[${ring.join("")}]`
  );
}

const DIVERT_RANGE = 10;

function collectEnergy(creep: Creep, storageModel: boolean): boolean {
  const carried = creep.store[RESOURCE_ENERGY];
  const nearbyOnly = carried > 0;

  const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
  }) as Resource[];
  if (dropped.length > 0) {
    const pile = creep.pos.findClosestByRange(dropped) as Resource;
    if (!nearbyOnly || creep.pos.getRangeTo(pile) <= DIVERT_RANGE) {
      pickupDroppedResource(creep, pile);
      return true;
    }
  }

  let container: StructureContainer | null = null;
  const assignedId = creep.memory.assignedContainerId;
  if (assignedId) {
    const assigned = Game.getObjectById(assignedId as Id<StructureContainer>) as StructureContainer | null;
    if (assigned && assigned.store[RESOURCE_ENERGY] >= 100) container = assigned;
  }
  if (!container) container = findClosestMinerContainerWithEnergy(creep);
  if (
    container &&
    container.store[RESOURCE_ENERGY] >= 100 &&
    (!nearbyOnly || creep.pos.getRangeTo(container) <= DIVERT_RANGE)
  ) {
    withdrawFromContainer(creep, container);
    return true;
  }

  if (carried === 0 && !storageModel) {
    const storage = creep.room.storage;
    const baseNeedsEnergy = creep.room.energyAvailable < creep.room.energyCapacityAvailable;
    if (storage && baseNeedsEnergy && storage.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 20 });
      }
      return true;
    }
    if (baseNeedsEnergy) {
      acquireEnergy(creep);
      return true;
    }
  }

  return false;
}

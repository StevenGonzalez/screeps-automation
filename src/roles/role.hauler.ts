import { parkIdle } from "../services/services.town";
import {
  acquireEnergy,
  transferEnergyTo,
  findUnclaimedHaulerAssignment,
  pickupDroppedResource,
  withdrawFromContainer,
  findFullestMinerContainer,
  findDepositTargetExcludingMiner,
  findEmptiestTower,
  findCoreFillTarget,
  buildAtConstructionSite,
  findSmartEnergyFallbackTarget,
  repairStructure,
  upgradeController,
  getMinerContainerIds,
} from "../services/services.creep";
import { getThreatInfo, seekBoost } from "../services/services.combat";
import { ROLE_FILLER } from "../config/config.roles";
import { energyLeftFor, findHandoffTarget, setFillTarget, setHaulFrom } from "../services/services.coordination";

// How far a hauler detours to hand energy to a worker before banking it.
const HANDOFF_RANGE = 10;

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

  // Drop an assignment whose container is gone or is no longer a miner
  // container, so the hauler picks up the replacement.
  const assignedId = creep.memory.assignedContainerId;
  if (
    assignedId &&
    (!Game.getObjectById(assignedId) || !getMinerContainerIds(creep.room).includes(assignedId))
  ) {
    creep.memory.assignedContainerId = undefined;
  }
  if (!creep.memory.assignedContainerId) {
    const assignment = findUnclaimedHaulerAssignment(creep.room);
    if (assignment) {
      creep.memory.assignedContainerId = assignment.id;
    }
  }

  const storageModel = !!creep.room.storage && hasActiveFiller(creep.room);

  if (creep.memory.working === undefined) creep.memory.working = false;
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
    creep.memory.coreRelief = undefined;
  }
  if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    setFillTarget(creep, undefined);
    if (collectEnergy(creep, storageModel)) return;
    if (creep.store[RESOURCE_ENERGY] === 0) return;
    creep.memory.working = true;
  }

  if (getThreatInfo(creep.room).hostiles.length > 0) {
    const tower = findEmptiestTower(creep.room);
    if (tower) {
      setFillTarget(creep, tower.id);
      transferEnergyTo(creep, tower);
      return;
    }
  }

  if (!storageModel || creep.memory.coreRelief) {
    if (creep.memory.fillTargetId) {
      const cached = Game.getObjectById(creep.memory.fillTargetId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
      // A cached worker handoff is re-checked below, not here.
      if (
        cached &&
        "structureType" in cached &&
        "store" in cached &&
        cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        transferEnergyTo(creep, cached as Structure);
        return;
      }
      setFillTarget(creep, undefined);
    }

    const coreTarget = findCoreFillTarget(creep);
    if (coreTarget) {
      setFillTarget(creep, coreTarget.id);
      transferEnergyTo(creep, coreTarget);
      return;
    }
  }

  const pending = creep.room.memory.pendingSend;
  if (pending && pending.resource === RESOURCE_ENERGY) {
    const termId = creep.room.memory.terminalId;
    const terminal = termId ? (Game.getObjectById(termId) as StructureTerminal | null) : null;
    if (terminal && (terminal.store[RESOURCE_ENERGY] ?? 0) < pending.loadTarget) {
      setFillTarget(creep, terminal.id);
      transferEnergyTo(creep, terminal);
      return;
    }
  }

  // A builder or repairer out of energy close by gets it straight from us,
  // saving it the walk to storage and back.
  const handoff = findHandoffTarget(creep, HANDOFF_RANGE);
  if (handoff) {
    setFillTarget(creep, handoff.id);
    transferEnergyTo(creep, handoff);
    return;
  }

  const depositTarget = findDepositTargetExcludingMiner(creep);
  if (depositTarget) {
    setFillTarget(creep, depositTarget.id);
    if (Memory.debugHaulers === creep.room.name) debugDeposit(creep, depositTarget);
    transferEnergyTo(creep, depositTarget);
    return;
  }

  // Nothing to deposit, so any worker in the room that needs energy is worth
  // the walk.
  const farHandoff = findHandoffTarget(creep, Infinity);
  if (farHandoff) {
    setFillTarget(creep, farHandoff.id);
    transferEnergyTo(creep, farHandoff);
    return;
  }

  // Nothing to deposit. A hauler carries no WORK part, so the fallback below
  // yields nothing and it stays parked by the core holding the energy, ready to
  // top off a drained spawn/extension without waiting for a round trip.
  const fallback = findSmartEnergyFallbackTarget(creep);
  if (fallback) {
    if (fallback.kind === "build") {
      buildAtConstructionSite(creep, fallback.target as ConstructionSite);
      return;
    }
    if (fallback.kind === "repair") {
      repairStructure(creep, fallback.target as AnyStructure);
      return;
    }
    upgradeController(creep);
    return;
  }

  parkNearCore(creep);
}

// Wait on the market square when the room has one, out of the core's lanes;
// otherwise beside storage.
function parkNearCore(creep: Creep): void {
  if (parkIdle(creep, "square")) return;
  const anchor = creep.room.storage ?? creep.room.find(FIND_MY_SPAWNS)[0];
  if (anchor && !creep.pos.inRangeTo(anchor, 1)) {
    creep.moveTo(anchor, { reusePath: 20, range: 1 });
  }
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
      setHaulFrom(creep, undefined);
      pickupDroppedResource(creep, pile);
      return true;
    }
  }

  // A porter keeps to the container it set out for while there is still a
  // load there for it. Picking afresh each tick turned it round on the road
  // whenever another container filled a little faster.
  const enough = (id: string | undefined) => {
    const c = id ? (Game.getObjectById(id as Id<StructureContainer>) as StructureContainer | null) : null;
    return c && energyLeftFor(creep, c) >= 100 ? c : null;
  };
  const container =
    enough(creep.memory.haulFromId) ??
    enough(creep.memory.assignedContainerId) ??
    findFullestMinerContainer(creep, 100, nearbyOnly ? DIVERT_RANGE : Infinity);
  if (container && (!nearbyOnly || creep.pos.getRangeTo(container) <= DIVERT_RANGE)) {
    setHaulFrom(creep, container.id);
    withdrawFromContainer(creep, container);
    return true;
  }
  setHaulFrom(creep, undefined);

  if (carried === 0) {
    const storage = creep.room.storage;
    const baseNeedsEnergy = creep.room.energyAvailable < creep.room.energyCapacityAvailable;
    if (storage && baseNeedsEnergy && storage.store[RESOURCE_ENERGY] > 0) {
      // Under the storage model the filler owns storage -> spawn/extensions, so
      // a hauler normally leaves this leg alone. We only get here with nothing
      // to haul, though, and deferring then means parking beside empty
      // extensions: one filler cannot always keep the core fed, and a starved
      // core is what stops the room spawning. Take the run and mark it, so the
      // delivery leg fills the core instead of putting it back in storage.
      if (storageModel) creep.memory.coreRelief = true;
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 20 });
      }
      return true;
    }
    if (storageModel) return false;
    if (baseNeedsEnergy) {
      acquireEnergy(creep);
      return true;
    }
  }

  return false;
}

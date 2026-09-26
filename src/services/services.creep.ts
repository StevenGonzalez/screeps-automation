import { pickSignature } from "../config/signatures";
import { PLANNER_KEYS } from "../config/config.structures";
import { invaderStrength } from "./services.combat";
import { getRoomBuildTarget, findClosestRepairTarget } from "./services.creep.maintenance";

export {
  getRoomStructures,
  findClosestSource,
  findBalancedSource,
  getClosestSpawn,
  getSources,
  harvestFromSource,
  isPositionSafe,
  isSourceSafe,
  getSafeSources,
  getMinerContainerIds,
  findContainersForSource,
  findUnclaimedMinerAssignment,
  findUnclaimedHaulerAssignment,
} from "./services.creep.room";
export {
  findEnergyDepositTarget,
  acquireEnergy,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestContainerWithFreeCapacity,
  withdrawFromControllerContainer,
  mayBorrowHauler,
  isCreepEmpty,
  isCreepFull,
  transferEnergyTo,
  getClosestContainerOrStorage,
  findClosestMinerContainerWithEnergy,
  findDepositTargetExcludingMiner,
  findEmptiestTower,
  findCoreFillTarget,
} from "./services.creep.energy";
export {
  findClosestConstructionSite,
  isEnergyEmergency,
  getRoomBuildTarget,
  getRampartTargetHP,
  barrierTargetFn,
  findClosestRepairTarget,
  findClosestDamagedRampart,
  findCriticalDefenseTarget,
  getNukeRampartTarget,
  findMostCriticalRepairTarget,
  findTowerRepairTarget,
  findTowerDefenseRepairTarget,
} from "./services.creep.maintenance";

export function upgradeController(creep: Creep): void {
  const controller = creep.room.controller;
  if (!controller) return;

  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { reusePath: 50 });
    return;
  }

  signControllerIfNeeded(creep, controller);
}

const SIGN_RECHECK_INTERVAL = 5000;

export function signControllerIfNeeded(
  creep: Creep,
  controller: StructureController
): boolean {
  const lastSigned = creep.room.memory.lastSigned;
  if (lastSigned !== undefined && Game.time - lastSigned < SIGN_RECHECK_INTERVAL) return false;

  const desiredSignature = pickSignature(creep.room.name);

  const currentSign = controller.sign;

  if (currentSign?.username === "Screeps") return false;

  const myUsername = controller.owner?.username;
  const needsSign =
    !currentSign ||
    currentSign.username !== myUsername ||
    currentSign.text !== desiredSignature;
  if (!needsSign) return false;

  if (creep.pos.getRangeTo(controller.pos) > 1) {
    creep.moveTo(controller, { range: 1, reusePath: 5 });
    return true;
  }

  creep.signController(controller, desiredSignature);
  creep.room.memory.lastSigned = Game.time;
  return true;
}

export function buildAtConstructionSite(
  creep: Creep,
  site: ConstructionSite
): number {
  const res = creep.build(site);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(site, { reusePath: 50 });
  return res;
}

export function repairStructure(creep: Creep, target: AnyStructure): number {
  const res = creep.repair(target);
  if (res === ERR_NOT_IN_RANGE) return creep.moveTo(target, { reusePath: 50 });
  return res;
}

export function findSmartEnergyFallbackTarget(
  creep: Creep
): { kind: "build" | "repair" | "upgrade"; target: ConstructionSite | AnyStructure | StructureController } | null {
  // Build, repair and upgrade all need a WORK part. Offering any of them to a
  // WORK-less creep (hauler, remote hauler) makes it stall holding its energy
  // instead of falling through to whatever it can actually do.
  if (creep.getActiveBodyparts(WORK) === 0) return null;

  const site = getRoomBuildTarget(creep.room);
  if (site) return { kind: "build", target: site };

  const repairTarget = findClosestRepairTarget(creep);
  if (repairTarget) return { kind: "repair", target: repairTarget };

  const controller = creep.room.controller;
  if (controller && controller.my) return { kind: "upgrade", target: controller };

  return null;
}

export function performSmartEnergyFallback(creep: Creep): boolean {
  const fallback = findSmartEnergyFallbackTarget(creep);
  if (!fallback) return false;

  if (fallback.kind === "build") {
    const res = buildAtConstructionSite(creep, fallback.target as ConstructionSite);
    if (res === ERR_NOT_ENOUGH_RESOURCES) return false;
    return true;
  }

  if (fallback.kind === "repair") {
    const res = repairStructure(creep, fallback.target as AnyStructure);
    if (res === ERR_NOT_ENOUGH_RESOURCES) return false;
    return true;
  }

  upgradeController(creep);
  return true;
}

export function putSurplusEnergyToWork(creep: Creep): void {
  if (performSmartEnergyFallback(creep)) return;
  upgradeController(creep);
}

const REMOTE_INVADER_WINDOW = 1500;

const REMOTE_PLAYER_WINDOW = 2000;

const REMOTE_PLAYER_WINDOW_MAX = 20000;

function assignedRemoteEntry(creep: Creep): RemoteRoomData | undefined {
  const home = creep.memory.homeRoom;
  const target = creep.memory.targetRoom;
  if (!home || !target) return undefined;
  return Memory.rooms[home]?.remoteRooms?.find((r) => r.roomName === target);
}

export function isAssignedRemoteContested(creep: Creep): boolean {
  const entry = assignedRemoteEntry(creep);
  if (!entry) return false;
  if (entry.hostile) return true;
  return entry.invaderUntil !== undefined && entry.invaderUntil > Game.time;
}

export function flagRemoteInvader(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry) markRemoteInvader(entry, creep.room);
}

// `room` is the remote itself, seen this tick.
export function markRemoteInvader(entry: RemoteRoomData, room: Room): void {
  entry.invaderUntil = Game.time + REMOTE_INVADER_WINDOW;
  entry.invaderStrength = invaderStrength(room);
}

export function flagRemotePlayer(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry) markRemotePlayerHostile(entry);
}

export function markRemotePlayerHostile(entry: RemoteRoomData): void {
  const avoided =
    entry.hostile && entry.hostileUntil !== undefined && entry.hostileUntil > Game.time;
  if (!avoided) entry.hostileStrikes = (entry.hostileStrikes ?? 0) + 1;
  const window = Math.min(
    REMOTE_PLAYER_WINDOW * 2 ** ((entry.hostileStrikes ?? 1) - 1),
    REMOTE_PLAYER_WINDOW_MAX
  );
  entry.hostile = true;
  entry.hostileUntil = Game.time + window;
}

export function clearRemotePlayerHostile(entry: RemoteRoomData): void {
  entry.hostile = false;
  // Forgive one strike per clean window rather than all of them on the first
  // clean look, so a player who keeps coming back still escalates the backoff.
  // While strikes remain, hostileUntil (never left in the future) marks where
  // the current clean window started.
  let strikes = entry.hostileStrikes ?? 0;
  let since = Math.min(entry.hostileUntil ?? Game.time, Game.time);
  while (strikes > 0 && Game.time - since >= REMOTE_PLAYER_WINDOW) {
    strikes--;
    since += REMOTE_PLAYER_WINDOW;
  }
  entry.hostileStrikes = strikes;
  entry.hostileUntil = strikes > 0 ? since : undefined;
}

export function clearRemoteInvader(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry && entry.invaderUntil !== undefined) entry.invaderUntil = undefined;
  if (entry) delete entry.invaderStrength;
}

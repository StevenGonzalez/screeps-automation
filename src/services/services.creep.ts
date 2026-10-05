import { keepSignature, remoteSignature } from "../config/signatures";
import { findInvaderCore, invaderStrength, isPlayerCreep, isSourceKeeperRoom } from "./services.combat";
import { WARBAND_BOUNTY_RAIDS, lordName, ordinal, raiseWarband, tally, wildsName, warbandIn } from "./services.chronicle";
import { spreadWord } from "./services.herald";
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
  countOpenTilesAround,
} from "./services.creep.room";
export {
  findEnergyDepositTarget,
  acquireEnergy,
  awaitLoad,
  pickupDroppedResource,
  withdrawFromContainer,
  findClosestContainerWithFreeCapacity,
  withdrawFromControllerContainer,
  mayBorrowHauler,
  isCreepEmpty,
  isCreepFull,
  transferEnergyTo,
  getClosestContainerOrStorage,
  findFullestMinerContainer,
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
  keptUp,
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

  const home = creep.memory.homeRoom;
  const desiredSignature =
    controller.my || !home ? keepSignature(creep.room.name) : remoteSignature(creep.room.name, home);

  const currentSign = controller.sign;

  if (currentSign?.username === "Screeps") return false;

  // A reserved remote has no owner, so compare against the signing creep.
  const myUsername = creep.owner.username;
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

// A player who keeps walking in and out of a remote stays one line in the
// chronicle while they come back within this many ticks.
const RIVAL_CHRONICLE_WINDOW = 5000;

// A remote next to two castles is in both their lists, and each list is marked
// and cleared on its own, in the same tick. The chronicle tells of a raid, and
// of its end, once: the Crow Glen's raid was told twice in one tick.
const RAID_CHRONICLE_WINDOW = 10;

function assignedRemoteEntry(creep: Creep): RemoteRoomData | undefined {
  const home = creep.memory.homeRoom;
  const target = creep.memory.targetRoom;
  if (!home || !target) return undefined;
  return Memory.rooms[home]?.remoteRooms?.find((r) => r.roomName === target);
}

// How long a remote creep took to reach its post, as the ticks of its life it
// spent on the walk. Its relief is ordered that much ahead of its death
// (orchestrator.spawning.remote), since a path counts tiles and not the ticks a
// body takes over them: a peddler with fewer MOVE than other parts takes two
// ticks a tile off the road and ten in a swamp. Grimford's peddlers reached the
// Bleak Vale some seventy ticks after their path said, and the source they
// relieved lay idle meanwhile.
export function noteWalk(creep: Creep, lifeTime: number): void {
  if (creep.memory.walk !== undefined || creep.ticksToLive === undefined) return;
  creep.memory.walk = lifeTime - creep.ticksToLive;
}

// Whether a remote creep sent off to wait out trouble stands in the room it
// was sent to. A creep left standing on an exit tile is carried into the next
// room at the end of the tick, so one that stopped on the tile it reached home
// by was carried back into the remote it fled, and bounced between the two
// every tick. In the Crow Glen a raider walked up to the edge and cut down
// three that way.
export function standsIn(creep: Creep, roomName: string): boolean {
  const { x, y } = creep.pos;
  return creep.room.name === roomName && x !== 0 && y !== 0 && x !== 49 && y !== 49;
}

// Whether a remote creep can wait out a raid in a room: one of our own, or one
// scouted as nobody's, with no towers, no other player's reservation and no
// raid of ours going on in it. Lair keepers and rooms never scouted are not.
export function isSafeRefuge(roomName: string, me: string): boolean {
  if (Game.rooms[roomName]?.controller?.my) return true;
  if (isSourceKeeperRoom(roomName)) return false;
  const intel = Memory.intel?.[roomName];
  if (!intel || intel.owner || intel.towers > 0) return false;
  if (intel.reservedBy && intel.reservedBy !== me) return false;
  for (const home in Memory.rooms) {
    for (const r of Memory.rooms[home].remoteRooms ?? []) {
      if (r.roomName === roomName && (r.hostile || (r.invaderUntil ?? 0) > Game.time)) return false;
    }
  }
  return true;
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
  const fresh = entry.invaderUntil === undefined || entry.invaderUntil <= Game.time;
  entry.invaderUntil = Game.time + REMOTE_INVADER_WINDOW;
  entry.invaderStrength = invaderStrength(room);
  if (!fresh) return;
  const text = findInvaderCore(room)
    ? `Invaders raised a stronghold in the ${wildsName(entry.roomName)}. The vendors flee the road.`
    : raidLine(entry.roomName);
  tally(`raid:${entry.roomName}`, 0, () => text, RAID_CHRONICLE_WINDOW);
}

function raidLine(roomName: string): string {
  const band = raiseWarband(roomName);
  const wilds = wildsName(roomName);
  if (band.raids === 1) return `Raiders under ${band.name} fell upon the vendors in the ${wilds}.`;
  const back = `${band.name} comes back to the ${wilds} for a ${ordinal(band.raids)} raid on the vendors.`;
  if (band.raids !== WARBAND_BOUNTY_RAIDS) return back;
  spreadWord("a bounty!");
  return `${back} The Crown puts a price on the warlord's head.`;
}

// Damage taken in the assigned remote. Only a player there earns a strike;
// Invaders get a knight instead, and a strike for them would escalate the
// player backoff every time one visits.
export function flagRemoteDamage(creep: Creep): void {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.some(isPlayerCreep)) flagRemotePlayer(creep);
  else flagRemoteInvader(creep);
}

export function flagRemotePlayer(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (!entry) return;
  const player = creep.room.find(FIND_HOSTILE_CREEPS).find(isPlayerCreep);
  markRemotePlayerHostile(entry, player?.owner.username);
}

// `who` is the player whose creeps or reservation made the remote hostile.
export function markRemotePlayerHostile(entry: RemoteRoomData, who?: string): void {
  const avoided =
    entry.hostile && entry.hostileUntil !== undefined && entry.hostileUntil > Game.time;
  if (!avoided) {
    entry.hostileStrikes = (entry.hostileStrikes ?? 0) + 1;
    const text = `${who ? `The men of ${lordName(who)}` : "Strangers"} hold the ${wildsName(entry.roomName)}. The vendors keep away.`;
    tally(`rival:${entry.roomName}`, 1, () => text, RIVAL_CHRONICLE_WINDOW);
  }
  const window = Math.min(
    REMOTE_PLAYER_WINDOW * 2 ** ((entry.hostileStrikes ?? 1) - 1),
    REMOTE_PLAYER_WINDOW_MAX
  );
  entry.hostile = true;
  entry.hostileUntil = Game.time + window;
  if (who) entry.rival = who;
}

export function clearRemotePlayerHostile(entry: RemoteRoomData): void {
  // Rewrites the line that told of the rival's men holding the remote, so a
  // player who comes and goes leaves one line saying how things stand.
  if (entry.hostile && entry.rival) {
    const text = `The men of ${lordName(entry.rival)} have left the ${wildsName(entry.roomName)}. The vendors take to the road again.`;
    tally(`rival:${entry.roomName}`, 0, () => text, RIVAL_CHRONICLE_WINDOW);
  }
  entry.hostile = false;
  delete entry.rival;
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

// Invaders only: a remote a player made hostile is avoided, not fought over.
export function isAssignedRemoteInvaded(creep: Creep): boolean {
  const until = assignedRemoteEntry(creep)?.invaderUntil;
  return until !== undefined && until > Game.time;
}

export function clearRemoteInvader(creep: Creep): void {
  const entry = assignedRemoteEntry(creep);
  if (entry) clearRemoteInvaderEntry(entry);
}

// `entry` is a remote seen clear of invaders this tick.
export function clearRemoteInvaderEntry(entry: RemoteRoomData): void {
  if (entry.invaderUntil !== undefined) {
    if (entry.invaderUntil > Game.time) {
      const band = warbandIn(entry.roomName);
      const text = band
        ? `The ${wildsName(entry.roomName)} is rid of ${band}'s raiders. The vendors take to the road.`
        : `The ${wildsName(entry.roomName)} is safe again. The vendors take to the road.`;
      tally(`safe:${entry.roomName}`, 0, () => text, RAID_CHRONICLE_WINDOW);
    }
    entry.invaderUntil = undefined;
  }
  delete entry.invaderStrength;
}

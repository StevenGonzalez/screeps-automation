import { getStockForCompound } from "../services/services.labs";
import { BODY_PATTERNS, MAX_BODY_PART_COUNT } from "../config/config.spawning";
import { getRoomMemory } from "../services/services.memory";
import { ROLE_TITLES } from "../config/config.roles";
import { recordSpend } from "../services/services.exchequer";

export function buildScaledBody(
  role: string,
  availableEnergy: number
): BodyPartConstant[] {
  const pattern = BODY_PATTERNS[role] ?? [WORK, CARRY, MOVE];
  const patternCost = calculateBodyPartCost(pattern);
  const maxByParts = Math.floor(MAX_BODY_PART_COUNT / pattern.length);
  const maxByEnergy = Math.floor(availableEnergy / patternCost);
  const repeats = Math.max(1, Math.min(maxByParts, maxByEnergy));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) body.push(...pattern);
  return body;
}

export function calculateBodyPartCost(parts: BodyPartConstant[]): number {
  return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

let creepCacheTick = -1;

const creepsByRoleCache: Record<string, Creep[]> = {};

function rebuildCreepCache(): void {
  if (creepCacheTick === Game.time) return;
  creepCacheTick = Game.time;
  for (const key of Object.keys(creepsByRoleCache)) delete creepsByRoleCache[key];
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep.memory.role;
    if (role) {
      if (!creepsByRoleCache[role]) creepsByRoleCache[role] = [];
      creepsByRoleCache[role].push(creep);
    }
  }
}

export function getCreepsByRole(role: string): Creep[] {
  rebuildCreepCache();
  return creepsByRoleCache[role] ?? [];
}

export function getCreepsByRoleInRoom(role: string, room: Room): Creep[] {
  return getCreepsByRole(role).filter((creep) => creep.room.name === room.name);
}

let spawningCacheTick = -1;

const spawningCache: Record<string, Record<string, number>> = {};

// A spawnCreep order only shows up on the spawn and in Game.creeps next tick, so
// another idle spawn deciding in the same tick has to count these orders itself.
let issuedTick = -1;

const issuedThisTick: Record<string, Record<string, number>> = {};

const issuedNames = new Set<string>();

function freshIssued(): void {
  if (issuedTick === Game.time) return;
  issuedTick = Game.time;
  issuedNames.clear();
  for (const k of Object.keys(issuedThisTick)) delete issuedThisTick[k];
}

function getIssuedCount(room: Room, role: string): number {
  freshIssued();
  return issuedThisTick[room.name]?.[role] ?? 0;
}

export function getRoomSpawningCount(room: Room, role: string): number {
  if (spawningCacheTick !== Game.time) {
    spawningCacheTick = Game.time;
    for (const k of Object.keys(spawningCache)) delete spawningCache[k];
  }
  if (!spawningCache[room.name]) {
    const counts: Record<string, number> = {};
    const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
    for (const s of spawns) {
      if (!s.spawning) continue;
      const mem = Memory.creeps[s.spawning.name];
      if (!mem?.role) continue;
      const r = mem.role;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    spawningCache[room.name] = counts;
  }
  return (spawningCache[room.name][role] ?? 0) + getIssuedCount(room, role);
}

const GIVEN_NAMES = [
  "Aldric", "Agnes", "Bertram", "Beatrix", "Brannoc", "Cedric", "Cecily", "Corvin",
  "Dunstan", "Edith", "Edric", "Fulk", "Gareth", "Gisela", "Godric", "Hild",
  "Isolde", "Ivo", "Jocelin", "Kenric", "Leofric", "Lucan", "Maud", "Merek",
  "Mordred", "Morwen", "Osric", "Percival", "Roderick", "Rowena", "Sigmund", "Sybil",
  "Thorne", "Tristan", "Ulric", "Wulfric", "Ysolde", "Varian",
];

// A creep is named for its role and a given name: "Mason Aldric". A name worn
// by a live creep, still in Memory, or handed out this tick is skipped, so
// names come free again only once their bearer is dead and buried.
export function creepName(role: string): string {
  freshIssued();
  const title = ROLE_TITLES[role] ?? role;
  const start = Game.time % GIVEN_NAMES.length;
  for (let i = 0; i < GIVEN_NAMES.length; i++) {
    const name = `${title} ${GIVEN_NAMES[(start + i) % GIVEN_NAMES.length]}`;
    if (!Game.creeps[name] && !Memory.creeps[name] && !issuedNames.has(name)) return name;
  }
  return `${title} ${Game.time}`;
}

// At most one order per role per room per tick: roles matched by memory (remote
// source, scout target, squad slot) cannot see a same-tick order, so a second idle
// spawn would duplicate it.
export function trackedSpawn(
  room: Room,
  spawn: StructureSpawn,
  body: BodyPartConstant[],
  opts: SpawnOptions & { memory: CreepMemory }
): ScreepsReturnCode {
  const role = opts.memory.role;
  if (getIssuedCount(room, role) > 0) return ERR_BUSY;
  const name = creepName(role);
  const res = spawn.spawnCreep(body, name, opts);
  if (res === OK) {
    issuedNames.add(name);
    const byRole = issuedThisTick[room.name] ?? (issuedThisTick[room.name] = {});
    byRole[role] = (byRole[role] ?? 0) + 1;
    recordSpend(room.name, "recruits", calculateBodyPartCost(body));
  }
  return res;
}

export function countByRoleInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter((c) => !c.spawning).length;
  return present + getRoomSpawningCount(room, role);
}

// A role that is saving up for a full-size body blocks the spawn tick so the
// roles below it cannot spend the savings on a runt. That hold has to be able
// to expire: while it is held nothing else in the room spawns, so a target the
// room never reaches costs it every upgrader, builder, repairer and defender.
const SPAWN_HOLD_LIMIT = 100;

export function holdSpawnFor(room: Room, role: string): boolean {
  const memory = getRoomMemory(room);
  const hold = memory.spawnHold;
  // A room with two idle spawns asks twice in the same tick, so treat both the
  // current tick and the previous one as the same unbroken hold.
  const continuing =
    hold !== undefined && hold.role === role && Game.time - hold.lastTick <= 1;
  const since = continuing ? hold!.since : Game.time;
  memory.spawnHold = { role, since, lastTick: Game.time };
  return Game.time - since < SPAWN_HOLD_LIMIT;
}

// How much a body may cost, and it depends on which number the caller is
// working from.
//
// An "available" budget is energy already sitting in the spawn and extensions
// this tick. Nothing else draws on it - towers hold their own store, and every
// other consumer takes from storage or a container - so it is all spendable,
// and the 10% that used to be shaved off it bought nothing. It just made every
// creep in the empire a tenth smaller for its whole life.
//
// A "capacity" budget is different: it is a target the room still has to climb
// to, and the callers that use it hold the spawn while they wait. Aiming at the
// last few energy of capacity means waiting for a number a working room rarely
// lands on exactly, so that one keeps a margin.
const CAPACITY_TARGET_MARGIN = 0.1;

export function bodyBudget(room: Room, basis: "available" | "capacity"): number {
  return basis === "available"
    ? room.energyAvailable
    : Math.floor(room.energyCapacityAvailable * (1 - CAPACITY_TARGET_MARGIN));
}

// A replacement takes CREEP_SPAWN_TIME ticks per body part to build and then has
// to walk to its post. Ordering it only once the creep it replaces is already
// gone leaves that post - and the source worked from it - idle for the whole
// lead time, every life cycle.
export function spawnLeadTicks(bodyParts: number, travelTicks: number): number {
  return bodyParts * CREEP_SPAWN_TIME + travelTicks;
}

export function isRetiring(creep: Creep, lead: number): boolean {
  const ttl = creep.ticksToLive;
  return ttl !== undefined && ttl <= lead;
}

// Bodies are sized from room.energyAvailable, so one spawned during a dip in the
// core commits the room to an undersized creep for its whole 1500-tick life.
// Wait for the extensions to refill first. Unlike holdSpawnFor this does not
// block the roles below it in the chain, and it gives up so that a room that
// simply never reaches the ratio still gets its creep, just a smaller one.
const FULL_BODY_ENERGY_RATIO = 0.9;

const FULL_BODY_MAX_WAIT = 40;

// The wait only runs while the role is actually short. Timing it on ticks when
// nothing was needed would use up the wait before the real need arrived. Giving
// up clears the timer, so the next creep of a role still short several gets its
// own wait instead of spawning as a runt straight away.
//
// The wait is timed from the last tick the extensions gained energy, not from
// when it began: the roles below spawn while it holds and empty the extensions,
// and a fixed wait then ran out mid-refill and sent out a runt. Only a room
// whose energy has stopped rising is one that will not reach the mark.
export function waitForFullBody(room: Room, role: string, needed: boolean): boolean {
  const memory = getRoomMemory(room);
  if (!needed || room.energyAvailable >= room.energyCapacityAvailable * FULL_BODY_ENERGY_RATIO) {
    if (memory.bodyWait) delete memory.bodyWait[role];
    return false;
  }
  if (!memory.bodyWait) memory.bodyWait = {};
  const wait = memory.bodyWait[role];
  const energy = room.energyAvailable;
  // A bare number is a wait started before waits tracked energy.
  if (typeof wait !== "object" || energy > wait.energy) {
    memory.bodyWait[role] = { since: Game.time, energy };
    return true;
  }
  wait.energy = energy;
  if (Game.time - wait.since < FULL_BODY_MAX_WAIT) return true;
  delete memory.bodyWait[role];
  return false;
}

type RoomPhase = "bootstrap" | "developing" | "established" | "powerhouse";

export function getRoomPhase(room: Room): RoomPhase {
  const rcl = room.controller?.level ?? 0;
  if (rcl <= 2) return "bootstrap";
  if (rcl <= 4) return "developing";
  if (rcl <= 6) return "established";
  return "powerhouse";
}

const BOOST_CANDIDATES: Record<string, string[]> = {
  melee:   ['XUH2O', 'UH2O', 'UH'],
  ranged:  ['XKHO2', 'KHO2', 'KO'],
  healer:  ['XLHO2', 'LHO2', 'LO'],
  drainer: ['XLHO2', 'LHO2', 'LO'],
  siege:   ['XZH2O', 'ZH2O', 'ZH'],
  tough:   ['XGHO2', 'GHO2', 'GO'],
  move:    ['XZHO2', 'ZHO2', 'ZO'],
  upgrader: ['XGH2O', 'GH2O', 'GH'],
};

function pickBoostCompound(room: Room, roleKey: string, boostParts: number): string | undefined {
  const candidates = BOOST_CANDIDATES[roleKey];
  if (!candidates) return undefined;
  const minRequired = boostParts * 30 + 300;
  for (const compound of candidates) {
    if (getStockForCompound(compound, room) >= minRequired) return compound;
  }
  return undefined;
}

export function buildBoostQueue(
  room: Room,
  roleKey: string,
  primaryParts: number,
  toughParts: number,
  moveParts = 0
): string[] {
  const queue: string[] = [];
  const primary = pickBoostCompound(room, roleKey, primaryParts);
  if (primary) queue.push(primary);
  if (toughParts > 0) {
    const tough = pickBoostCompound(room, "tough", toughParts);
    if (tough) queue.push(tough);
  }
  if (moveParts > 0) {
    const move = pickBoostCompound(room, "move", moveParts);
    if (move) queue.push(move);
  }
  return queue;
}

export function boostMemory(queue: string[]): { boostCompound?: string; boostQueue?: string[] } {
  if (queue.length === 0) return {};
  return {
    boostCompound: queue[0],
    ...(queue.length > 1 ? { boostQueue: queue.slice(1) } : {}),
  };
}

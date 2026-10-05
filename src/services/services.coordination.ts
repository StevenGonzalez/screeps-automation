import { ROLE_BUILDER, ROLE_REPAIRER } from "../config/config.roles";

// Energy each creep is carrying toward a target, keyed by target id then creep
// name. Built from memory once a tick, so a creep that picked its target on an
// earlier tick still counts before it runs this tick.
let claimTick = -1;
const claims = new Map<string, Map<string, number>>();

function claimIndex(): Map<string, Map<string, number>> {
  if (claimTick !== Game.time) {
    claimTick = Game.time;
    claims.clear();
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      const id = c.memory.fillTargetId;
      if (id) addClaim(id, name, c.store[RESOURCE_ENERGY] ?? 0);
    }
  }
  return claims;
}

function addClaim(targetId: string, creepName: string, amount: number): void {
  let byCreep = claims.get(targetId);
  if (!byCreep) {
    byCreep = new Map();
    claims.set(targetId, byCreep);
  }
  byCreep.set(creepName, amount);
}

/** Sets the creep's fill target and keeps this tick's claims in step with it. */
export function setFillTarget(creep: Creep, targetId: string | undefined): void {
  const index = claimIndex();
  const old = creep.memory.fillTargetId;
  if (old) index.get(old)?.delete(creep.name);
  creep.memory.fillTargetId = targetId;
  if (targetId) addClaim(targetId, creep.name, creep.store[RESOURCE_ENERGY] ?? 0);
}

/** Energy other creeps are already bringing to this target. */
export function energyClaimedByOthers(targetId: string, creep: Creep): number {
  const byCreep = claimIndex().get(targetId);
  if (!byCreep) return 0;
  let total = 0;
  for (const [name, amount] of byCreep) if (name !== creep.name) total += amount;
  return total;
}

// Creeps on their way to load at each container, keyed by container id. Built
// from memory once a tick like the fill claims above; a creep that has filled
// up and turned to deliver no longer counts.
let haulTick = -1;
const haulClaims = new Map<string, Set<string>>();

function haulIndex(): Map<string, Set<string>> {
  if (haulTick !== Game.time) {
    haulTick = Game.time;
    haulClaims.clear();
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      const id = c.memory.haulFromId;
      if (id && !c.memory.working) addHaulClaim(id, name);
    }
  }
  return haulClaims;
}

function addHaulClaim(containerId: string, creepName: string): void {
  let names = haulClaims.get(containerId);
  if (!names) {
    names = new Set();
    haulClaims.set(containerId, names);
  }
  names.add(creepName);
}

/** Sets the container a creep is on its way to load at. */
export function setHaulFrom(creep: Creep, id: Id<StructureContainer> | undefined): void {
  const old = creep.memory.haulFromId;
  if (old === id) return;
  const index = haulIndex();
  if (old) index.get(old)?.delete(creep.name);
  creep.memory.haulFromId = id;
  if (id) addHaulClaim(id, creep.name);
}

/**
 * Energy in a container once the creeps bound for it that will reach it before
 * this one have filled up. The nearer creep loads first, so a farther one
 * leaves it to them instead of walking there for nothing.
 */
export function energyLeftFor(creep: Creep, container: StructureContainer): number {
  let left = container.store[RESOURCE_ENERGY];
  const names = haulIndex().get(container.id);
  if (!names) return left;
  const mine = creep.pos.getRangeTo(container);
  for (const name of names) {
    const other = Game.creeps[name];
    if (!other || name === creep.name) continue;
    const range = other.pos.getRangeTo(container);
    if (range < mine || (range === mine && name < creep.name)) {
      left -= other.store.getFreeCapacity(RESOURCE_ENERGY);
    }
  }
  return left;
}

// Workers a hauler may hand energy to directly. Upgraders are left out: they
// draw from their own link and container, and a handoff would slip past the
// storage floor they keep.
const HANDOFF_ROLES = new Set<string>([ROLE_BUILDER, ROLE_REPAIRER]);

function wantsHandoff(c: Creep): boolean {
  return (
    HANDOFF_ROLES.has(c.memory.role) &&
    !c.spawning &&
    !c.memory.working &&
    c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
}

/**
 * The closest builder or repairer within `maxRange` that is out of energy and
 * not already covered by another hauler.
 */
export function findHandoffTarget(creep: Creep, maxRange: number): Creep | null {
  const candidates = creep.room.find(FIND_MY_CREEPS, {
    filter: (c) =>
      c.name !== creep.name &&
      wantsHandoff(c) &&
      creep.pos.getRangeTo(c) <= maxRange &&
      energyClaimedByOthers(c.id, creep) < c.store.getFreeCapacity(RESOURCE_ENERGY),
  });
  if (candidates.length === 0) return null;
  return creep.pos.findClosestByRange(candidates);
}

/**
 * A worker a hauler is bringing energy to walks to meet it instead of going
 * for energy itself. Returns true when the worker spent its tick on that.
 */
export function meetIncomingHandoff(creep: Creep): boolean {
  const byCreep = claimIndex().get(creep.id);
  if (!byCreep) return false;
  let carrier: Creep | null = null;
  for (const name of byCreep.keys()) {
    const c = Game.creeps[name];
    if (!c || c.room.name !== creep.room.name || (c.store[RESOURCE_ENERGY] ?? 0) === 0) continue;
    if (!carrier || creep.pos.getRangeTo(c) < creep.pos.getRangeTo(carrier)) carrier = c;
  }
  if (!carrier) return false;
  if (!creep.pos.isNearTo(carrier)) creep.moveTo(carrier, { range: 1, reusePath: 5 });
  return true;
}

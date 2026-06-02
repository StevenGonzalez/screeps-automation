/**
 * Power creep (Operator) management. Maintains a single Operator that boosts the
 * empire's economy with its powers: instantly refilling extensions, accelerating
 * spawns, powering the factory for commodity production, and speeding lab reactions.
 * It auto-creates itself once GPL allows, auto-pours power levels into a sensible
 * priority, spawns/renews at a Power Spawn, and generates the `ops` that fuel its
 * own powers.
 */

// Order power levels are invested as GPL grows, and the order powers are applied.
const POWER_PRIORITY: PowerConstant[] = [
  PWR_GENERATE_OPS,
  PWR_OPERATE_EXTENSION,
  PWR_OPERATE_SPAWN,
  PWR_OPERATE_FACTORY,
  PWR_OPERATE_LAB,
];

const RENEW_TTL = 300;       // renew at a power spawn below this TTL

export function loop(): void {
  ensureOperatorExists();
  for (const name in Game.powerCreeps) {
    const pc = Game.powerCreeps[name];
    autoUpgrade(pc);
    if (pc.ticksToLive === undefined) {
      trySpawn(pc); // not currently spawned into a room
      continue;
    }
    runOperator(pc);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function ensureOperatorExists(): void {
  if (Object.keys(Game.powerCreeps).length > 0) return;
  if (Game.gpl.level < 1) return;
  const name = `Operator${Game.time}`;
  const res = PowerCreep.create(name, POWER_CLASS.OPERATOR);
  if (res === OK) console.log(`[Power] Created Operator power creep "${name}"`);
}

// Invest one spare power level per tick into the highest-priority power that still
// has room to grow. The API rejects illegal upgrades, so we just walk the list.
function autoUpgrade(pc: PowerCreep): void {
  for (const power of POWER_PRIORITY) {
    const res = pc.upgrade(power);
    if (res === OK) {
      console.log(`[Power] Upgraded power ${power} on ${pc.name}`);
      return;
    }
    if (res === ERR_NOT_ENOUGH_RESOURCES) return; // no spare GPL levels
    // ERR_FULL / ERR_INVALID_ARGS (maxed or not yet unlockable) → try next power
  }
}

function trySpawn(pc: PowerCreep): void {
  if (pc.spawnCooldownTime && Game.time < pc.spawnCooldownTime) return;
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my || !room.memory.powerSpawnId) continue;
    const ps = Game.getObjectById(room.memory.powerSpawnId) as StructurePowerSpawn | null;
    if (!ps) continue;
    if (pc.spawn(ps) === OK) {
      pc.memory.homeRoom = room.name;
      console.log(`[Power] Spawned ${pc.name} at ${room.name}`);
      return;
    }
  }
}

// ── Behaviour ───────────────────────────────────────────────────────────────────

function runOperator(pc: PowerCreep): void {
  const room = pc.room;
  if (!room) return;

  // Powers must be enabled in a room before any can be used there.
  if (room.controller && !room.controller.isPowerEnabled) {
    if (pc.enableRoom(room.controller) === ERR_NOT_IN_RANGE) {
      pc.moveTo(room.controller, { reusePath: 10 });
    }
    return;
  }

  // Renew at the home Power Spawn when the clock runs low.
  if ((pc.ticksToLive ?? 0) < RENEW_TTL) {
    const ps = getHomePowerSpawn(pc);
    if (ps) {
      if (pc.renew(ps) === ERR_NOT_IN_RANGE) pc.moveTo(ps, { reusePath: 10 });
      return;
    }
  }

  // A power creep may use only ONE power per tick. Apply the highest-priority operate
  // power when one is ready and useful; otherwise spend the tick generating ops, which
  // refuels during the operate powers' cooldowns.
  const usedPower = applyBestPower(pc, room);
  if (
    !usedPower &&
    hasPower(pc, PWR_GENERATE_OPS) &&
    offCooldown(pc, PWR_GENERATE_OPS) &&
    (pc.store.getUsedCapacity(RESOURCE_OPS) ?? 0) < (pc.store.getCapacity(RESOURCE_OPS) ?? 0)
  ) {
    pc.usePower(PWR_GENERATE_OPS);
  }
}

// Returns true only when a power was actually used this tick (so the caller knows not
// to also generate ops). Moving toward a target or idling returns false.
function applyBestPower(pc: PowerCreep, room: Room): boolean {
  for (const power of POWER_PRIORITY) {
    if (power === PWR_GENERATE_OPS) continue;
    if (!hasPower(pc, power) || !offCooldown(pc, power)) continue;
    if (!canAffordOps(pc, power)) continue;

    const target = pickTarget(power, room);
    if (!target) continue;

    const range = (POWER_INFO[power] as { range?: number }).range ?? 3;
    if (pc.pos.getRangeTo(target) > range) {
      pc.moveTo(target, { range, reusePath: 10 });
      return false; // moving — still free to generate ops this tick
    }
    return pc.usePower(power, target) === OK;
  }

  // Nothing to do — idle near the home storage so powers are quick to reach.
  const anchor = room.storage ?? getHomePowerSpawn(pc);
  if (anchor && !pc.pos.inRangeTo(anchor, 3)) pc.moveTo(anchor, { range: 3, reusePath: 20 });
  return false;
}

// Chooses the structure a given power should act on this tick, or null if it would
// have no useful effect right now.
function pickTarget(power: PowerConstant, room: Room): Structure | null {
  switch (power) {
    case PWR_OPERATE_EXTENSION: {
      // Refill extensions from storage only when there's a meaningful gap to close.
      const storage = room.storage;
      if (!storage || (storage.store[RESOURCE_ENERGY] ?? 0) < 1000) return null;
      if (room.energyAvailable >= room.energyCapacityAvailable * 0.5) return null;
      return storage;
    }
    case PWR_OPERATE_SPAWN: {
      const spawn = room.find(FIND_MY_SPAWNS, { filter: (s) => !!s.spawning })[0];
      return spawn ?? null;
    }
    case PWR_OPERATE_FACTORY: {
      const factory = room
        .find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_FACTORY })[0] as
        | StructureFactory
        | undefined;
      if (!factory) return null;
      // Skip if the operate effect is already active on it.
      const active = factory.effects?.some((e) => e.effect === PWR_OPERATE_FACTORY);
      return active ? null : factory;
    }
    case PWR_OPERATE_LAB: {
      const ls = room.memory.labSystem;
      if (!ls?.activeCompound || !ls.inputLabIds?.length) return null;
      const lab = ls.inputLabIds
        .map((id) => Game.getObjectById(id) as StructureLab | null)
        .find((l): l is StructureLab => {
          if (!l) return false;
          return !l.effects?.some((e) => e.effect === PWR_OPERATE_LAB);
        });
      return lab ?? null;
    }
    default:
      return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasPower(pc: PowerCreep, power: PowerConstant): boolean {
  return (pc.powers[power]?.level ?? 0) > 0;
}

function offCooldown(pc: PowerCreep, power: PowerConstant): boolean {
  return (pc.powers[power]?.cooldown ?? 0) === 0;
}

function canAffordOps(pc: PowerCreep, power: PowerConstant): boolean {
  const cost = (POWER_INFO[power] as { ops?: number }).ops ?? 0;
  if (cost === 0) return true;
  return (pc.store.getUsedCapacity(RESOURCE_OPS) ?? 0) >= cost;
}

function getHomePowerSpawn(pc: PowerCreep): StructurePowerSpawn | null {
  const home = pc.memory.homeRoom ? Game.rooms[pc.memory.homeRoom] : pc.room;
  const id = home?.memory.powerSpawnId;
  return id ? (Game.getObjectById(id) as StructurePowerSpawn | null) : null;
}

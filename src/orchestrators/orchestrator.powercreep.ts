/**
 * Power creep (Operator) management. Maintains ONE Operator per owned room that has a
 * Power Spawn, each homed to and spawned at its room's Power Spawn. Operators boost the
 * empire with their powers: regenerating sources, instantly refilling extensions,
 * accelerating spawns, powering the factory for commodity production, speeding lab
 * reactions, boosting storage/terminal capacity, hardening towers on defence, and
 * speeding the power spawn. They auto-create as GPL allows, pour power levels into a
 * sensible priority, spawn/renew at a Power Spawn, and generate the `ops` that fuel
 * their own powers.
 */

// Order power levels are invested as GPL grows, and the order powers are applied.
// Rationale: GENERATE_OPS first so ops exist to spend; REGEN_SOURCE next — it is the
// single biggest sustained-energy win (extra energy regen on each source); then the
// spawn/extension economy; then factory/lab/storage throughput; OPERATE_TOWER and the
// remaining utility powers (terminal, power-spawn) come last but are still usable.
const POWER_PRIORITY: PowerConstant[] = [
  PWR_GENERATE_OPS,
  PWR_REGEN_SOURCE,
  PWR_OPERATE_SPAWN,
  PWR_OPERATE_EXTENSION,
  PWR_OPERATE_FACTORY,
  PWR_OPERATE_LAB,
  PWR_OPERATE_STORAGE,
  PWR_OPERATE_TOWER,
  PWR_OPERATE_TERMINAL,
  PWR_OPERATE_POWER,
];

const RENEW_TTL = 300;       // renew at a power spawn below this TTL

export function loop(): void {
  ensureOperatorsExist();
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

// Run one Operator per owned room with a Power Spawn. We only mint a new power creep
// when GPL budget allows (Game.gpl.level must exceed the current power creep count, so
// each creep can reach at least level 1) and there's a power spawn not yet served by an
// existing (or homed) Operator. Idempotent: a room already covered is skipped.
function ensureOperatorsExist(): void {
  const existing = Object.values(Game.powerCreeps);
  if (Game.gpl.level <= existing.length) return; // no spare GPL level for a new creep

  // Rooms already claimed by an Operator (by its persisted homeRoom).
  const claimed = new Set<string>();
  for (const pc of existing) {
    if (pc.memory.homeRoom) claimed.add(pc.memory.homeRoom);
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my || !room.memory.powerSpawnId) continue;
    if (claimed.has(room.name)) continue;
    const ps = Game.getObjectById(room.memory.powerSpawnId);
    if (!ps) continue;

    const name = `Operator_${room.name}_${Game.time}`;
    const res = PowerCreep.create(name, POWER_CLASS.OPERATOR);
    if (res === OK) {
      // Persist the home room immediately so we don't double-claim it next tick. The
      // creep spawns into this room in trySpawn().
      Game.powerCreeps[name].memory.homeRoom = room.name;
      console.log(`[Power] Created Operator "${name}" for ${room.name}`);
    }
    return; // create at most one per tick to keep GPL accounting simple
  }
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

// Spawn an unspawned creep at its home room's Power Spawn (falling back to any owned
// room with a free spawn if its home is somehow unavailable).
function trySpawn(pc: PowerCreep): void {
  if (pc.spawnCooldownTime && Game.time < pc.spawnCooldownTime) return;

  // Prefer the persisted home room's power spawn.
  const home = pc.memory.homeRoom ? Game.rooms[pc.memory.homeRoom] : undefined;
  if (home?.controller?.my && home.memory.powerSpawnId) {
    const ps = Game.getObjectById(home.memory.powerSpawnId);
    if (ps && pc.spawn(ps) === OK) {
      console.log(`[Power] Spawned ${pc.name} at ${home.name}`);
      return;
    }
  }

  // Fallback: any owned room with a power spawn not already claimed by another creep.
  const claimed = new Set<string>();
  for (const other of Object.values(Game.powerCreeps)) {
    if (other.name !== pc.name && other.memory.homeRoom) claimed.add(other.memory.homeRoom);
  }
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my || !room.memory.powerSpawnId || claimed.has(room.name)) continue;
    const ps = Game.getObjectById(room.memory.powerSpawnId);
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

  // Powers must be enabled in a room before any can be used there. Each Operator keeps
  // its own home room enabled.
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
  // REGEN_SOURCE targets a source, every other operate power targets a structure.
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

// Chooses the source/structure a given power should act on this tick, or null if it
// would have no useful effect right now (already-active effect, nothing to do, etc.).
function pickTarget(power: PowerConstant, room: Room): Source | Structure | null {
  switch (power) {
    case PWR_REGEN_SOURCE: {
      // Apply to a source that is on regen cooldown and not already boosted, preferring
      // the one most depleted so the extra energy lands where it's wanted.
      const sources = room.find(FIND_SOURCES, {
        filter: (s) => !s.effects?.some((e) => e.effect === PWR_REGEN_SOURCE),
      });
      if (sources.length === 0) return null;
      return sources.reduce((best, s) => (s.energy < best.energy ? s : best));
    }
    case PWR_OPERATE_EXTENSION: {
      // Refill extensions from storage only when there's a meaningful gap to close.
      const storage = room.storage;
      if (!storage || (storage.store[RESOURCE_ENERGY] ?? 0) < 1000) return null;
      if (room.energyAvailable >= room.energyCapacityAvailable * 0.5) return null;
      return storage;
    }
    case PWR_OPERATE_SPAWN: {
      const spawn = room.find(FIND_MY_SPAWNS, {
        filter: (s) => !!s.spawning && !s.effects?.some((e) => e.effect === PWR_OPERATE_SPAWN),
      })[0];
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
        .map((id) => Game.getObjectById(id))
        .find((l): l is StructureLab => {
          if (!l) return false;
          return !l.effects?.some((e) => e.effect === PWR_OPERATE_LAB);
        });
      return lab ?? null;
    }
    case PWR_OPERATE_STORAGE: {
      // Boost storage capacity only when it is genuinely full, and not already boosted.
      const storage = room.storage;
      if (!storage) return null;
      if (storage.store.getFreeCapacity() > 50000) return null;
      const active = storage.effects?.some((e) => e.effect === PWR_OPERATE_STORAGE);
      return active ? null : storage;
    }
    case PWR_OPERATE_TOWER: {
      // Defensive: only worth spending when the room is actually under threat.
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      if (hostiles.length === 0) return null;
      const tower = room
        .find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER })
        .find((t) => !t.effects?.some((e) => e.effect === PWR_OPERATE_TOWER));
      return tower ?? null;
    }
    case PWR_OPERATE_TERMINAL: {
      // Boost terminal send capacity only when it's near full and not already boosted.
      const terminal = room.terminal;
      if (!terminal) return null;
      if (terminal.store.getFreeCapacity() > 50000) return null;
      const active = terminal.effects?.some((e) => e.effect === PWR_OPERATE_TERMINAL);
      return active ? null : terminal;
    }
    case PWR_OPERATE_POWER: {
      // Speed up the power spawn while it has power to process and isn't already boosted.
      const id = room.memory.powerSpawnId;
      const ps = id ? Game.getObjectById(id) : null;
      if (!ps) return null;
      if ((ps.store[RESOURCE_POWER] ?? 0) === 0) return null;
      const active = ps.effects?.some((e) => e.effect === PWR_OPERATE_POWER);
      return active ? null : ps;
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
  return id ? Game.getObjectById(id) : null;
}

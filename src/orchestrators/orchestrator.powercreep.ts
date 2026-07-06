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

const RENEW_TTL = 300;

export function loop(): void {
  ensureOperatorsExist();
  for (const name in Game.powerCreeps) {
    const pc = Game.powerCreeps[name];
    autoUpgrade(pc);
    if (pc.ticksToLive === undefined) {
      trySpawn(pc);
      continue;
    }
    runOperator(pc);
  }
}

function ensureOperatorsExist(): void {
  const existing = Object.values(Game.powerCreeps);
  if (Game.gpl.level <= existing.length) return;

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
      Game.powerCreeps[name].memory.homeRoom = room.name;
      console.log(`[Power] Created Operator "${name}" for ${room.name}`);
    }
    return;
  }
}

function autoUpgrade(pc: PowerCreep): void {
  for (const power of POWER_PRIORITY) {
    const res = pc.upgrade(power);
    if (res === OK) {
      console.log(`[Power] Upgraded power ${power} on ${pc.name}`);
      return;
    }
    if (res === ERR_NOT_ENOUGH_RESOURCES) return;
  }
}

function trySpawn(pc: PowerCreep): void {
  if (pc.spawnCooldownTime && Game.time < pc.spawnCooldownTime) return;

  const home = pc.memory.homeRoom ? Game.rooms[pc.memory.homeRoom] : undefined;
  if (home?.controller?.my && home.memory.powerSpawnId) {
    const ps = Game.getObjectById(home.memory.powerSpawnId);
    if (ps && pc.spawn(ps) === OK) {
      console.log(`[Power] Spawned ${pc.name} at ${home.name}`);
      return;
    }
  }

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

function runOperator(pc: PowerCreep): void {
  const room = pc.room;
  if (!room) return;

  if (room.controller && !room.controller.isPowerEnabled) {
    if (pc.enableRoom(room.controller) === ERR_NOT_IN_RANGE) {
      pc.moveTo(room.controller, { reusePath: 10 });
    }
    return;
  }

  if ((pc.ticksToLive ?? 0) < RENEW_TTL) {
    const ps = getHomePowerSpawn(pc);
    if (ps) {
      if (pc.renew(ps) === ERR_NOT_IN_RANGE) pc.moveTo(ps, { reusePath: 10 });
      return;
    }
  }

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
      return false;
    }
    return pc.usePower(power, target) === OK;
  }

  const anchor = room.storage ?? getHomePowerSpawn(pc);
  if (anchor && !pc.pos.inRangeTo(anchor, 3)) pc.moveTo(anchor, { range: 3, reusePath: 20 });
  return false;
}

function pickTarget(power: PowerConstant, room: Room): Source | Structure | null {
  switch (power) {
    case PWR_REGEN_SOURCE: {
      const sources = room.find(FIND_SOURCES, {
        filter: (s) => !s.effects?.some((e) => e.effect === PWR_REGEN_SOURCE),
      });
      if (sources.length === 0) return null;
      return sources.reduce((best, s) => (s.energy < best.energy ? s : best));
    }
    case PWR_OPERATE_EXTENSION: {
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
      const storage = room.storage;
      if (!storage) return null;
      if (storage.store.getFreeCapacity() > 50000) return null;
      const active = storage.effects?.some((e) => e.effect === PWR_OPERATE_STORAGE);
      return active ? null : storage;
    }
    case PWR_OPERATE_TOWER: {
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      if (hostiles.length === 0) return null;
      const tower = room
        .find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER })
        .find((t) => !t.effects?.some((e) => e.effect === PWR_OPERATE_TOWER));
      return tower ?? null;
    }
    case PWR_OPERATE_TERMINAL: {
      const terminal = room.terminal;
      if (!terminal) return null;
      if (terminal.store.getFreeCapacity() > 50000) return null;
      const active = terminal.effects?.some((e) => e.effect === PWR_OPERATE_TERMINAL);
      return active ? null : terminal;
    }
    case PWR_OPERATE_POWER: {
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

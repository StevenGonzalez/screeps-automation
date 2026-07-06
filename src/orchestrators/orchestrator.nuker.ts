import { ROLE_HAULER } from "../config/config.roles";

export const NUKER_GHODIUM_RESERVE = NUKER_GHODIUM_CAPACITY;

const STORAGE_ENERGY_SURPLUS = 250_000;

const MAX_FILL_PER_TICK = 1_000;

declare global {
  interface NukerSystemMemory {
    nukerId?: Id<StructureNuker>;
    courierName?: string;
  }
  interface RoomMemory {
    nukerSystem?: NukerSystemMemory;
  }
}

export function loop(): void {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    processNuker(room);
  }
}

function processNuker(room: Room): void {
  const nuker = resolveNuker(room);
  if (!nuker) return;

  const job = findFillJob(room, nuker);
  if (!job) {
    releaseCourier(room);
    return;
  }
  commandCourier(room, nuker, job);
}

function resolveNuker(room: Room): StructureNuker | null {
  if (!room.memory.nukerSystem) room.memory.nukerSystem = {};
  const ns = room.memory.nukerSystem;

  if (ns.nukerId) {
    const cached = Game.getObjectById(ns.nukerId);
    if (cached) return cached;
    delete ns.nukerId;
  }

  const nuker = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureNuker => s.structureType === STRUCTURE_NUKER,
  })[0] as StructureNuker | undefined;

  if (!nuker) return null;
  ns.nukerId = nuker.id;
  return nuker;
}

interface FillJob {
  resource: RESOURCE_ENERGY | RESOURCE_GHODIUM;
  source: StructureStorage | StructureTerminal;
  amount: number;
}

function findFillJob(room: Room, nuker: StructureNuker): FillJob | null {
  return findGhodiumJob(room, nuker) ?? findEnergyJob(room, nuker);
}

function findGhodiumJob(room: Room, nuker: StructureNuker): FillJob | null {
  const need = NUKER_GHODIUM_CAPACITY - (nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0);
  if (need <= 0) return null;

  for (const src of [room.storage, room.terminal]) {
    if (!src) continue;
    const avail = src.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0;
    if (avail <= 0) continue;
    return {
      resource: RESOURCE_GHODIUM,
      source: src,
      amount: Math.min(need, avail, MAX_FILL_PER_TICK),
    };
  }
  return null;
}

function findEnergyJob(room: Room, nuker: StructureNuker): FillJob | null {
  const need = NUKER_ENERGY_CAPACITY - (nuker.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0);
  if (need <= 0) return null;

  const storage = room.storage;
  if (!storage) return null;
  const storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (storageEnergy <= STORAGE_ENERGY_SURPLUS) return null;

  const spendable = storageEnergy - STORAGE_ENERGY_SURPLUS;
  const amount = Math.min(need, spendable, MAX_FILL_PER_TICK);
  if (amount <= 0) return null;
  return { resource: RESOURCE_ENERGY, source: storage, amount };
}

function commandCourier(room: Room, nuker: StructureNuker, job: FillJob): void {
  const storage = room.storage;
  if (!storage) return;

  const courier = acquireCourier(room);
  if (!courier) return;

  const carried = (Object.keys(courier.store) as ResourceConstant[]).filter(
    (r) => (courier.store.getUsedCapacity(r) ?? 0) > 0
  );

  if (carried.length > 0) {
    const r = carried[0];
    const carriedAmount = courier.store.getUsedCapacity(r) ?? 0;
    if (r === job.resource && carriedAmount > 0) {
      if (courier.transfer(nuker, r, Math.min(carriedAmount, job.amount)) === ERR_NOT_IN_RANGE) {
        courier.moveTo(nuker, { reusePath: 5 });
      }
    } else {
      if (courier.transfer(storage, r) === ERR_NOT_IN_RANGE) courier.moveTo(storage, { reusePath: 5 });
    }
    return;
  }

  const amount = Math.min(courier.store.getFreeCapacity() ?? 0, job.amount);
  if (amount <= 0) return;
  if (courier.withdraw(job.source, job.resource, amount) === ERR_NOT_IN_RANGE) {
    courier.moveTo(job.source, { reusePath: 5 });
  }
}

function acquireCourier(room: Room): Creep | null {
  const ns = room.memory.nukerSystem!;

  if (ns.courierName) {
    const existing = Game.creeps[ns.courierName];
    if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
      return existing;
    }
    delete ns.courierName;
  }

  const nuker = ns.nukerId ? Game.getObjectById(ns.nukerId) : null;
  const haulers = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === ROLE_HAULER && c.spawning !== true,
  });
  if (haulers.length === 0) return null;

  const empty = haulers.filter((c) => (c.store.getUsedCapacity() ?? 0) === 0);
  const pool = empty.length > 0 ? empty : haulers;

  const chosen = nuker
    ? pool.reduce((best, c) => (c.pos.getRangeTo(nuker) < best.pos.getRangeTo(nuker) ? c : best))
    : pool[0];

  ns.courierName = chosen.name;
  return chosen;
}

function releaseCourier(room: Room): void {
  const ns = room.memory.nukerSystem;
  if (ns) delete ns.courierName;
}

export interface NukerStatus {
  room: string;
  energy: number;
  energyCapacity: number;
  ghodium: number;
  ghodiumCapacity: number;
  cooldown: number;
  ready: boolean;
}

function statusFor(room: Room): NukerStatus | null {
  const ns = room.memory.nukerSystem;
  const nuker = ns?.nukerId
    ? (Game.getObjectById(ns.nukerId) as StructureNuker | null)
    : (room.find(FIND_MY_STRUCTURES, {
        filter: (s): s is StructureNuker => s.structureType === STRUCTURE_NUKER,
      })[0] as StructureNuker | undefined) ?? null;
  if (!nuker) return null;

  const energy = nuker.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const ghodium = nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0;
  return {
    room: room.name,
    energy,
    energyCapacity: NUKER_ENERGY_CAPACITY,
    ghodium,
    ghodiumCapacity: NUKER_GHODIUM_CAPACITY,
    cooldown: nuker.cooldown,
    ready:
      nuker.cooldown === 0 &&
      energy >= NUKER_ENERGY_CAPACITY &&
      ghodium >= NUKER_GHODIUM_CAPACITY,
  };
}

export function describeNukers(): NukerStatus[] {
  const out: NukerStatus[] = [];
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const s = statusFor(room);
    if (s) out.push(s);
  }
  return out;
}

export function launchNukeFrom(fromRoom: string, target: RoomPosition): string | null {
  const room = Game.rooms[fromRoom];
  if (!room?.controller?.my) return `${fromRoom} is not a room you own`;

  const nuker = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureNuker => s.structureType === STRUCTURE_NUKER,
  })[0] as StructureNuker | undefined;
  if (!nuker) return `${fromRoom} has no nuker (built at RCL 8)`;

  if (nuker.cooldown > 0) return `nuker on cooldown for ${nuker.cooldown} more ticks`;

  const energy = nuker.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const ghodium = nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0;
  if (energy < NUKER_ENERGY_CAPACITY) {
    return `nuker not fully loaded: energy ${energy}/${NUKER_ENERGY_CAPACITY}`;
  }
  if (ghodium < NUKER_GHODIUM_CAPACITY) {
    return `nuker not fully loaded: ghodium ${ghodium}/${NUKER_GHODIUM_CAPACITY}`;
  }

  const dist = Game.map.getRoomLinearDistance(fromRoom, target.roomName);
  if (dist > NUKE_RANGE) {
    return `target ${target.roomName} is ${dist} rooms away - nuker range is ${NUKE_RANGE}`;
  }

  const res = nuker.launchNuke(target);
  if (res !== OK) return `launchNuke failed with code ${res}`;
  return null;
}

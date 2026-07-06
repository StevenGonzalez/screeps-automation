/**
 * Nuker Orchestrator (OFFENSIVE side)
 *
 * The nuker is built at RCL 8. orchestrator.nukes.ts handles DEFENSE against incoming
 * nukes — this file is the OFFENSIVE half: it keeps our own nuker loaded so we can launch.
 *
 * Per owned room with a StructureNuker it:
 *   1. caches the nuker id;
 *   2. keeps it filled to capacity — energy (NUKER_ENERGY_CAPACITY, 300k) and ghodium
 *      (NUKER_GHODIUM_CAPACITY, 5k) — by commandeering an idle `bagman` (hauler) each tick
 *      and driving it to withdraw from storage/terminal and transfer into the nuker. This
 *      mirrors how orchestrator.factory borrows a courier (role dispatch lives in
 *      orchestrator.creep.ts, owned by another agent, so we cannot add a dedicated role).
 *   3. gates ENERGY filling on a storage-energy surplus so the colony economy is never
 *      starved; ghodium is precious and filled whenever any is available in stores.
 *
 * main.ts runs this AFTER orchestrator.creep, so our withdraw/transfer/move intents
 * override whatever the borrowed hauler queued for itself this tick.
 *
 * Ghodium acquisition (market buy + inter-room transfer) lives in orchestrator.terminal.ts,
 * which reads NUKER_GHODIUM_RESERVE below to know how much G the empire must keep on hand.
 *
 * Launching is NEVER automatic — it only happens via Game.arca.launchNuke(...) (console.ts).
 */

import { ROLE_HAULER } from "../config/config.roles";

// How much ghodium the empire keeps available per nuker. The terminal acquires/balances G
// up to this reserve so a nuker can always be topped off. Exported so the terminal and
// console can agree on the figure without a magic number.
export const NUKER_GHODIUM_RESERVE = NUKER_GHODIUM_CAPACITY; // 5_000

// Only siphon energy into the nuker while storage holds a comfortable surplus, so a 300k
// fill never starves spawns/upgrade. Above this, energy is spare enough to bank in a nuker.
const STORAGE_ENERGY_SURPLUS = 250_000;

// Cap a single withdraw so one fill tick doesn't strand the hauler with a huge load it
// can't carry — getFreeCapacity already bounds it, this just keeps the math obvious.
const MAX_FILL_PER_TICK = 1_000;

// Module augmentation — nuker state lives on RoomMemory, fully owned by this system.
declare global {
  interface NukerSystemMemory {
    nukerId?: Id<StructureNuker>;
    /** Name of the bagman currently borrowed to load the nuker. */
    courierName?: string;
  }
  interface RoomMemory {
    nukerSystem?: NukerSystemMemory;
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

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

  // Decide what (if anything) still needs loading, then drive a borrowed courier to do it.
  const job = findFillJob(room, nuker);
  if (!job) {
    releaseCourier(room);
    return;
  }
  commandCourier(room, nuker, job);
}

// ── Nuker resolution / caching ────────────────────────────────────────────────

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

// ── Fill planning ─────────────────────────────────────────────────────────────

interface FillJob {
  resource: RESOURCE_ENERGY | RESOURCE_GHODIUM;
  source: StructureStorage | StructureTerminal;
  amount: number;
}

// The single resource the nuker is short on this tick, paired with a store to pull it
// from. Ghodium takes priority over energy: G is the scarce ingredient and a nuke needs
// both, so loading G first avoids parking 300k energy in a nuker that can never fire.
function findFillJob(room: Room, nuker: StructureNuker): FillJob | null {
  return findGhodiumJob(room, nuker) ?? findEnergyJob(room, nuker);
}

function findGhodiumJob(room: Room, nuker: StructureNuker): FillJob | null {
  const need = NUKER_GHODIUM_CAPACITY - (nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0);
  if (need <= 0) return null;

  // Ghodium is precious — take whatever is available, no surplus gate. Prefer storage,
  // then terminal (the terminal is where market-bought / transferred-in G lands).
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

  // Storage-surplus gate: only bank energy in the nuker while storage is comfortably full,
  // and never draw it below the surplus line (so spawns/upgraders keep their cushion).
  const storage = room.storage;
  if (!storage) return null;
  const storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  if (storageEnergy <= STORAGE_ENERGY_SURPLUS) return null;

  const spendable = storageEnergy - STORAGE_ENERGY_SURPLUS;
  const amount = Math.min(need, spendable, MAX_FILL_PER_TICK);
  if (amount <= 0) return null;
  return { resource: RESOURCE_ENERGY, source: storage, amount };
}

// ── Input movement (borrowed courier) ─────────────────────────────────────────

// Borrow an idle `bagman` and drive it for one tick: dump any unrelated carry to storage,
// then withdraw the needed resource and transfer it into the nuker. Returns silently when
// no courier is free — the hauler simply does its normal job that tick.
function commandCourier(room: Room, nuker: StructureNuker, job: FillJob): void {
  const storage = room.storage;
  if (!storage) return;

  const courier = acquireCourier(room);
  if (!courier) return;

  const carried = (Object.keys(courier.store) as ResourceConstant[]).filter(
    (r) => (courier.store.getUsedCapacity(r) ?? 0) > 0
  );

  if (carried.length > 0) {
    // If already carrying exactly what the nuker needs, deliver it; otherwise dump to
    // storage so the courier is free to fetch the right resource next tick.
    const r = carried[0];
    const carriedAmount = courier.store.getUsedCapacity(r) ?? 0;
    if (r === job.resource && carriedAmount > 0) {
      // Cap to job.amount so a pre-loaded hauler doesn't dump its whole cargo into the nuker
      // and blow past the per-tick / storage-surplus fill gate; the residual stays with the
      // hauler for its normal work (or the next fill tick).
      if (courier.transfer(nuker, r, Math.min(carriedAmount, job.amount)) === ERR_NOT_IN_RANGE) {
        courier.moveTo(nuker, { reusePath: 5 });
      }
    } else {
      if (courier.transfer(storage, r) === ERR_NOT_IN_RANGE) courier.moveTo(storage, { reusePath: 5 });
    }
    return;
  }

  // Empty courier — go withdraw the needed resource from the chosen source.
  const amount = Math.min(courier.store.getFreeCapacity() ?? 0, job.amount);
  if (amount <= 0) return;
  if (courier.withdraw(job.source, job.resource, amount) === ERR_NOT_IN_RANGE) {
    courier.moveTo(job.source, { reusePath: 5 });
  }
}

// ── Courier lifecycle ─────────────────────────────────────────────────────────

// Find (or reuse) an idle bagman to act as the nuker courier this tick. Prefers an empty
// bagman closest to the nuker so we don't strand energy it was hauling.
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

// ── Console-facing helpers (used by console.ts) ───────────────────────────────

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

// One status object per owned room that has a nuker, for Game.arca.nuker().
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

// Validate readiness + range and launch a nuke from `fromRoom` at the given position.
// Returns an error string on failure, or null on a successful launch. NEVER called
// automatically — only from the console command.
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
    return `target ${target.roomName} is ${dist} rooms away — nuker range is ${NUKE_RANGE}`;
  }

  const res = nuker.launchNuke(target);
  if (res !== OK) return `launchNuke failed with code ${res}`;
  return null;
}

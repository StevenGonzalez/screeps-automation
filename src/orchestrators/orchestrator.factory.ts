/**
 * Factory Orchestrator
 * Operates the factory placed at RCL 7 to produce commodities. Per owned room with a
 * factory it:
 *   1. caches the factory id and (every FACTORY_PLAN_INTERVAL ticks) picks the highest
 *      priority under-stocked commodity whose ingredients are obtainable and whose level
 *      gate is satisfied;
 *   2. calls factory.produce() whenever the inputs are loaded and the cooldown is ready;
 *   3. moves ingredients IN and product OUT by commandeering an idle `porter` (hauler) —
 *      see the input/output section for why this is done here rather than in a role file.
 *
 * Heavy planning is throttled like orchestrator.labs (Game.time % interval); the cheap
 * per-tick work (produce + drive the courier) runs every tick.
 *
 * NOTE (cross-system integration left for the integrator):
 *  - This orchestrator is self-contained: it cannot register a dedicated factory-hauler
 *    role because role dispatch lives in orchestrator.creep.ts (owned by another agent).
 *    Instead it borrows an already-spawned, idle, empty `porter` each tick and drives it
 *    directly. main.ts runs this AFTER orchestrator.creep, so our move/withdraw/transfer
 *    intents override whatever the hauler role queued this tick. A future integrator who
 *    wants a dedicated courier should: add a ROLE_FACTORY_HAULER handler in
 *    orchestrator.creep.ts, give orchestrator.spawning a spawn rule for it, and replace
 *    `commandCourier` below with a call into that role.
 *  - Selling commodities on the market is handled in orchestrator.terminal.ts. To feed it,
 *    the courier here routes evicted sellable commodities into the terminal (up to
 *    COMMODITY_TERMINAL_STOCK) instead of storage, and the terminal vends them.
 *  - Factory levelling is handled by orchestrator.powercreep.ts (PWR_OPERATE_FACTORY).
 *    We only READ factory.level to gate tier-2 commodities.
 */

import {
  COMMODITY_TARGETS,
  FACTORY_PLAN_INTERVAL,
  FACTORY_MIN_RESERVE_ENERGY,
  FACTORY_MAX_INPUT_LOAD,
  FACTORY_PRODUCT_EVICT_THRESHOLD,
  FACTORY_RESOLVE_MAX_DEPTH,
  MANAGED_COMMODITIES,
  COMMODITY_VALUE,
  COMMODITY_TERMINAL_STOCK,
} from "../config/config.factory";
import { ROLE_HAULER } from "../config/config.roles";

// Module augmentation — factory state lives on RoomMemory. Kept here (not in types.d.ts)
// because the factory system fully owns this slice of memory.
declare global {
  interface FactorySystemMemory {
    factoryId?: Id<StructureFactory>;
    /** Commodity currently chosen for production. */
    activeCommodity?: CommodityConstant;
    lastPlanTick?: number;
    /** When false, the orchestrator caches/evicts but never produces. */
    autoEnabled?: boolean;
    /** Name of the porter we are currently borrowing as a courier. */
    courierName?: string;
  }
  interface RoomMemory {
    factorySystem?: FactorySystemMemory;
  }
}

// A produce recipe pulled from the runtime COMMODITIES table.
interface Recipe {
  components: Partial<Record<ResourceConstant, number>>;
  amount: number;
  cooldown: number;
  level: number;
}

function getRecipe(commodity: CommodityConstant): Recipe | null {
  const def = COMMODITIES[commodity];
  if (!def) return null;
  return {
    components: def.components as Partial<Record<ResourceConstant, number>>,
    amount: def.amount,
    cooldown: def.cooldown,
    level: def.level ?? 0,
  };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export function loop(): void {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    processFactory(room);
  }
}

function processFactory(room: Room): void {
  const factory = resolveFactory(room);
  if (!factory) return;

  const fs = room.memory.factorySystem!;

  // Periodic heavy planning — pick what to make.
  const needsPlan = !fs.lastPlanTick || Game.time - fs.lastPlanTick >= FACTORY_PLAN_INTERVAL;
  if (needsPlan && fs.autoEnabled !== false) {
    fs.activeCommodity = selectCommodity(room, factory);
    fs.lastPlanTick = Game.time;
  }

  const commodity = fs.activeCommodity;
  if (!commodity) {
    // Nothing to make — still evict any leftover product/stale input so the store frees up.
    commandCourier(room, factory, null);
    return;
  }

  const recipe = getRecipe(commodity);
  if (!recipe) {
    delete fs.activeCommodity;
    return;
  }

  // Try to produce when the factory holds all ingredients and is off cooldown. On OK we
  // simply keep the same commodity until the next plan tick re-selects.
  if (factory.cooldown === 0 && hasAllComponents(factory, recipe)) {
    const res = factory.produce(commodity);
    if (res === ERR_INVALID_TARGET || res === ERR_RCL_NOT_ENOUGH) {
      // Recipe needs a leveled factory we don't have, or commodity invalid — drop it.
      delete fs.activeCommodity;
    }
  }

  // Keep ingredients flowing in and product flowing out via a borrowed courier.
  commandCourier(room, factory, recipe);
}

// ── Factory resolution / caching ────────────────────────────────────────────────

function resolveFactory(room: Room): StructureFactory | null {
  if (!room.memory.factorySystem) room.memory.factorySystem = {};
  const fs = room.memory.factorySystem;

  if (fs.factoryId) {
    const cached = Game.getObjectById(fs.factoryId);
    if (cached) return cached;
    delete fs.factoryId;
  }

  const factory = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureFactory => s.structureType === STRUCTURE_FACTORY,
  })[0] as StructureFactory | undefined;

  if (!factory) return null;
  fs.factoryId = factory.id;
  return factory;
}

// ── Recipe selection (profitability-aware + dependency resolution) ───────────────

// Picks what to produce this cycle. Two stages:
//   1. Choose the best TOP target: among every under-stocked target whose level gate is
//      met and whose full chain is buildable, prefer the highest static `value` (deep
//      tiers rank above cheap fillers). Ties break by the config order. This is the
//      profitability-aware step — we don't grind batteries while a circuit is feasible.
//   2. Resolve that top target down to the deepest missing producible intermediate, so we
//      build the chain bottom-up (like the lab reaction-chain resolver). The returned
//      commodity is always something the factory can make THIS cycle (level-gated, with
//      ingredients available).
// Returns undefined if nothing is feasible right now.
function selectCommodity(room: Room, factory: StructureFactory): CommodityConstant | undefined {
  const factoryLevel = factory.level ?? 0;

  let best: CommodityConstant | undefined;
  let bestValue = -Infinity;

  for (const t of COMMODITY_TARGETS) {
    if (factoryLevel < t.requiresLevel) continue;
    if (t.value <= bestValue) continue; // can't beat current best — skip the work
    if (totalStock(room, t.commodity) >= t.target) continue;

    // Resolve the chain: returns the commodity to actually produce now, or null if the
    // chain is blocked (a raw ingredient is missing, or it needs a higher factory level).
    const produce = resolveProduction(room, factory, t.commodity);
    if (!produce) continue;

    best = produce;
    bestValue = t.value;
  }

  return best;
}

// Dependency resolver. Given a desired (top) commodity, walk its recipe and return the
// deepest missing producible ingredient that the factory can make right now, or the top
// commodity itself when all its ingredients are already in stock. Returns null when the
// chain is blocked: a raw (non-producible) ingredient is unavailable, the recipe needs a
// higher factory level than we have, or the recursion bound is hit.
//
// "Producible intermediate" = an ingredient that is itself a managed commodity (so the
// factory can make it). "Raw" = a mineral / deposit resource / energy we can only source
// from stores. Energy respects the colony reserve.
function resolveProduction(
  room: Room,
  factory: StructureFactory,
  commodity: CommodityConstant,
  depth = 0,
  seen: Set<string> = new Set()
): CommodityConstant | null {
  if (depth > FACTORY_RESOLVE_MAX_DEPTH) return null;
  if (seen.has(commodity)) return null; // cycle guard (shouldn't happen, but be safe)
  seen.add(commodity);

  const recipe = getRecipe(commodity);
  if (!recipe) return null;
  if ((factory.level ?? 0) < recipe.level) return null; // level-gated out

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const needPerBatch = recipe.components[rc] ?? 0;
    if (needPerBatch <= 0) continue;

    const inStores = totalStock(room, rc) + (factory.store.getUsedCapacity(rc) ?? 0);

    if (rc === RESOURCE_ENERGY) {
      // Energy: only what's above the protected reserve counts as spendable.
      const spendable =
        (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) - FACTORY_MIN_RESERVE_ENERGY +
        (factory.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0);
      if (spendable < needPerBatch) return null; // can't afford energy → chain blocked
      continue;
    }

    if (inStores >= needPerBatch) continue; // ingredient already on hand

    // Short on this ingredient. If it's a producible intermediate, recurse to build it
    // first. If it's a raw resource we can't make, the chain is blocked.
    if (MANAGED_COMMODITIES.has(rc)) {
      const sub = resolveProduction(room, factory, rc as CommodityConstant, depth + 1, seen);
      if (sub) return sub; // produce the deeper intermediate first
      // The whole sub-chain for this missing ingredient is blocked (a raw resource under
      // it is unavailable). Since we can't supply this ingredient, the parent can't be
      // made either — block the chain. (Chains are level-monotonic, so a buildable top
      // target never has a level-gated sub-rung; line 209 covers that case anyway.)
      return null;
    }

    // Raw ingredient missing and unbuildable → chain can't proceed.
    return null;
  }

  // Every ingredient is available (or affordable) → make this commodity itself.
  return commodity;
}

function hasAllComponents(factory: StructureFactory, recipe: Recipe): boolean {
  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const need = recipe.components[rc] ?? 0;
    if ((factory.store.getUsedCapacity(rc) ?? 0) < need) return false;
  }
  return true;
}

// ── Input / output movement (borrowed courier) ──────────────────────────────────

// Borrow an idle, empty `porter` and drive it for one tick to: evict product/wrong
// resources from the factory, or load the next missing ingredient. Returns silently when
// no courier is free — the hauler simply does its normal job that tick.
//
// `recipe` is null when we have no active commodity (eviction-only pass).
function commandCourier(room: Room, factory: StructureFactory, recipe: Recipe | null): void {
  const storage = room.storage;
  if (!storage) return;

  // What does the factory hold that it SHOULD keep this cycle?
  const wanted = new Set<string>();
  if (recipe) {
    for (const comp in recipe.components) wanted.add(comp);
  }

  // Decide the single task for this tick: evict has priority over loading so the store
  // never deadlocks full of finished product.
  const evict = findEvictResource(factory, wanted);
  const load = recipe ? findLoadResource(room, factory, recipe) : null;
  if (!evict && !load) {
    releaseCourier(room);
    return;
  }

  const courier = acquireCourier(room);
  if (!courier) return;

  // If the courier is carrying something already, deposit it into storage first so it's
  // free to do our task.
  const carried = (Object.keys(courier.store) as ResourceConstant[]).filter(
    (r) => (courier.store.getUsedCapacity(r) ?? 0) > 0
  );

  if (carried.length > 0) {
    // If carrying the resource we want to load, take it to the factory. Otherwise route
    // a sellable commodity to the terminal (up to its staging level) so the terminal can
    // vend it; everything else (and any overflow past the staging level) goes to storage.
    const r = carried[0];
    if (load && r === load.resource) {
      if (courier.transfer(factory, r) === ERR_NOT_IN_RANGE) courier.moveTo(factory, { reusePath: 5 });
    } else {
      const terminal = room.terminal;
      const dest =
        MANAGED_COMMODITIES.has(r) &&
        terminal &&
        (terminal.store.getUsedCapacity(r) ?? 0) < COMMODITY_TERMINAL_STOCK &&
        (terminal.store.getFreeCapacity(r) ?? 0) > 0
          ? terminal
          : storage;
      if (courier.transfer(dest, r) === ERR_NOT_IN_RANGE) courier.moveTo(dest, { reusePath: 5 });
    }
    return;
  }

  // Empty courier — perform the task.
  if (evict) {
    if (courier.withdraw(factory, evict) === ERR_NOT_IN_RANGE) courier.moveTo(factory, { reusePath: 5 });
    return;
  }

  if (load) {
    const src = load.source;
    const amount = Math.min(courier.store.getFreeCapacity() ?? 0, load.amount);
    if (amount > 0) {
      if (courier.withdraw(src, load.resource, amount) === ERR_NOT_IN_RANGE) {
        courier.moveTo(src, { reusePath: 5 });
      }
    }
  }
}

// Resource the factory holds that it shouldn't (finished product, or leftover ingredient
// no longer wanted), or null. Product is evicted only once it crosses the threshold so we
// don't thrash one unit at a time.
function findEvictResource(
  factory: StructureFactory,
  wanted: Set<string>
): ResourceConstant | null {
  const held = Object.keys(factory.store) as ResourceConstant[];
  for (const r of held) {
    const amt = factory.store.getUsedCapacity(r) ?? 0;
    if (amt <= 0) continue;
    if (!wanted.has(r)) {
      // Unwanted resource (product or stale ingredient). Evict product past threshold,
      // but evict any non-energy stale ingredient immediately to free the store.
      if (amt >= FACTORY_PRODUCT_EVICT_THRESHOLD || r !== RESOURCE_ENERGY) return r;
    }
  }
  return null;
}

interface LoadJob {
  resource: ResourceConstant;
  source: StructureStorage | StructureTerminal;
  amount: number;
}

// Next ingredient the factory is short on, paired with the store to pull it from.
function findLoadResource(room: Room, factory: StructureFactory, recipe: Recipe): LoadJob | null {
  const storage = room.storage;
  const terminal = room.terminal;

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const need = recipe.components[rc] ?? 0;
    if (need <= 0) continue;

    const inFactory = factory.store.getUsedCapacity(rc) ?? 0;
    // Keep a few batches buffered, capped so one ingredient can't hog the 50k store.
    const desired = Math.min(FACTORY_MAX_INPUT_LOAD, Math.max(need * 4, need));
    if (inFactory >= desired) continue;

    const want = desired - inFactory;

    // Prefer storage, then terminal. Respect the energy reserve.
    for (const src of [storage, terminal]) {
      if (!src) continue;
      let avail = src.store.getUsedCapacity(rc) ?? 0;
      if (rc === RESOURCE_ENERGY && src === storage) {
        avail = Math.max(0, avail - FACTORY_MIN_RESERVE_ENERGY);
      }
      if (avail <= 0) continue;
      return { resource: rc, source: src, amount: Math.min(want, avail) };
    }
  }
  return null;
}

// ── Courier lifecycle ───────────────────────────────────────────────────────────

// Find (or reuse) an idle empty porter to act as the factory courier this tick.
function acquireCourier(room: Room): Creep | null {
  const fs = room.memory.factorySystem!;

  // Reuse the same courier across ticks when it's still valid and free.
  if (fs.courierName) {
    const existing = Game.creeps[fs.courierName];
    if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
      return existing;
    }
    delete fs.courierName;
  }

  // Pick the porter closest to the factory that is currently empty (so we don't strand
  // energy it was hauling). Falls back to any porter if none are empty — it will dump its
  // load to storage first.
  const factory = fs.factoryId ? Game.getObjectById(fs.factoryId) : null;
  const haulers = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === ROLE_HAULER && c.spawning !== true,
  });
  if (haulers.length === 0) return null;

  const empty = haulers.filter((c) => (c.store.getUsedCapacity() ?? 0) === 0);
  const pool = empty.length > 0 ? empty : haulers;

  const chosen = factory
    ? pool.reduce((best, c) => (c.pos.getRangeTo(factory) < best.pos.getRangeTo(factory) ? c : best))
    : pool[0];

  fs.courierName = chosen.name;
  return chosen;
}

function releaseCourier(room: Room): void {
  const fs = room.memory.factorySystem;
  if (fs) delete fs.courierName;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Combined stock of a resource across storage + terminal.
function totalStock(room: Room, resource: ResourceConstant): number {
  return (
    (room.storage?.store.getUsedCapacity(resource) ?? 0) +
    (room.terminal?.store.getUsedCapacity(resource) ?? 0)
  );
}

// ── Console-facing helpers (used by console.ts) ─────────────────────────────────

// One-line status string per room with a factory, for Game.arca.factory().
export function describeFactories(): string[] {
  const lines: string[] = [];
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const fs = room.memory.factorySystem;
    const factory = fs?.factoryId
      ? (Game.getObjectById(fs.factoryId) as StructureFactory | null)
      : (room.find(FIND_MY_STRUCTURES, {
          filter: (s): s is StructureFactory => s.structureType === STRUCTURE_FACTORY,
        })[0] as StructureFactory | undefined) ?? null;
    if (!factory) continue;

    const level = factory.level ?? 0;
    const cd = factory.cooldown;
    const active = fs?.activeCommodity ?? "idle";
    const auto = fs?.autoEnabled !== false;
    const used = factory.store.getUsedCapacity() ?? 0;
    const cap = factory.store.getCapacity() ?? 0;
    lines.push(
      `[Factory] ${rn}: active=${active} level=${level} cd=${cd} auto=${auto} store=${used}/${cap}`
    );

    // Show stock vs target for the level-supported commodities that are still
    // under-stocked, most valuable first (the order selection prefers). Skipping the
    // satisfied ones keeps the line readable now that there are many deep-chain targets.
    const parts = COMMODITY_TARGETS.filter((t) => t.requiresLevel <= level)
      .filter((t) => totalStock(room, t.commodity) < t.target)
      .sort((a, b) => (COMMODITY_VALUE.get(b.commodity) ?? 0) - (COMMODITY_VALUE.get(a.commodity) ?? 0))
      .map((t) => `${t.commodity}=${totalStock(room, t.commodity)}/${t.target}`)
      .join("  ");
    if (parts) lines.push(`  ${parts}`);
  }
  return lines;
}

// Force a room's factory to a specific commodity (skips auto-selection until next plan).
// Returns an error string or null on success.
export function forceCommodity(roomName: string, commodity: string): string | null {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) return `${roomName} is not a room you own`;
  if (!COMMODITIES[commodity as CommodityConstant]) return `${commodity} is not a valid commodity`;
  const factory = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureFactory => s.structureType === STRUCTURE_FACTORY,
  })[0] as StructureFactory | undefined;
  if (!factory) return `${roomName} has no factory`;

  const recipe = getRecipe(commodity as CommodityConstant);
  if (recipe && (factory.level ?? 0) < recipe.level) {
    return `${commodity} needs factory level ${recipe.level} (have ${factory.level ?? 0}) — level it via PWR_OPERATE_FACTORY`;
  }

  if (!room.memory.factorySystem) room.memory.factorySystem = {};
  room.memory.factorySystem.activeCommodity = commodity as CommodityConstant;
  // Defer the next auto-plan so the forced choice sticks for a while.
  room.memory.factorySystem.lastPlanTick = Game.time;
  return null;
}

// Toggle auto-production for a room's factory.
export function setAuto(roomName: string, enabled: boolean): string | null {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) return `${roomName} is not a room you own`;
  if (!room.memory.factorySystem) room.memory.factorySystem = {};
  room.memory.factorySystem.autoEnabled = enabled;
  return null;
}

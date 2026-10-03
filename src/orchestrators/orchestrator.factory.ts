import {
  COMMODITY_TARGETS,
  FACTORY_PLAN_INTERVAL,
  FACTORY_MIN_RESERVE_ENERGY,
  FACTORY_BATTERY_MIN_ENERGY,
  FACTORY_MAX_INPUT_LOAD,
  FACTORY_PRODUCT_EVICT_THRESHOLD,
  FACTORY_MIN_RESERVE_MINERAL,
  FACTORY_RESOLVE_MAX_DEPTH,
  MANAGED_COMMODITIES,
  COMMODITY_VALUE,
  COMMODITY_TERMINAL_STOCK,
} from "../config/config.factory";
import { NUKER_GHODIUM_RESERVE } from "./orchestrator.nuker";
import { ROLE_HAULER } from "../config/config.roles";
import { mayBorrowHauler } from "../services/services.creep";

declare global {
  interface FactorySystemMemory {
    factoryId?: Id<StructureFactory>;
    activeCommodity?: CommodityConstant;
    lastPlanTick?: number;
    autoEnabled?: boolean;
    courierName?: string;
  }
  interface RoomMemory {
    factorySystem?: FactorySystemMemory;
  }
}

interface Recipe {
  components: Partial<Record<ResourceConstant, number>>;
  amount: number;
  cooldown: number;
  level: number;
}

/**
 * The engine only runs a leveled recipe in a factory of exactly that level with
 * an active PWR_OPERATE_FACTORY effect; unleveled recipes run anywhere.
 */
export function factoryCanRun(factory: StructureFactory, recipeLevel: number): boolean {
  if (recipeLevel === 0) return true;
  if ((factory.level ?? 0) !== recipeLevel) return false;
  return !!factory.effects?.some((e) => e.effect === PWR_OPERATE_FACTORY);
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

  const needsPlan = !fs.lastPlanTick || Game.time - fs.lastPlanTick >= FACTORY_PLAN_INTERVAL;
  if (needsPlan && fs.autoEnabled !== false) {
    fs.activeCommodity = selectCommodity(room, factory);
    fs.lastPlanTick = Game.time;
  }

  const commodity = fs.activeCommodity;
  if (!commodity) {
    commandCourier(room, factory, null);
    return;
  }

  const recipe = getRecipe(commodity);
  if (!recipe) {
    delete fs.activeCommodity;
    return;
  }

  if (factory.cooldown === 0 && hasAllComponents(factory, recipe)) {
    const res = factory.produce(commodity);
    if (res === ERR_INVALID_TARGET || res === ERR_RCL_NOT_ENOUGH) {
      delete fs.activeCommodity;
    } else if (res === ERR_BUSY) {
      // Operate effect lapsed: drop the leveled recipe and replan next tick.
      delete fs.activeCommodity;
      fs.lastPlanTick = 0;
    }
  }

  commandCourier(room, factory, recipe);
}

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

function selectCommodity(room: Room, factory: StructureFactory): CommodityConstant | undefined {
  let best: CommodityConstant | undefined;
  let bestValue = -Infinity;
  const storedEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

  for (const t of COMMODITY_TARGETS) {
    if (!factoryCanRun(factory, t.requiresLevel)) continue;
    // Batteries only bank genuine energy surplus.
    if (t.commodity === RESOURCE_BATTERY && storedEnergy < FACTORY_BATTERY_MIN_ENERGY) continue;
    if (t.value <= bestValue) continue;
    if (totalStock(room, t.commodity) >= t.target) continue;

    const produce = resolveProduction(room, factory, t.commodity);
    if (!produce) continue;

    best = produce;
    bestValue = t.value;
  }

  return best;
}

function resolveProduction(
  room: Room,
  factory: StructureFactory,
  commodity: CommodityConstant,
  depth = 0,
  seen: Set<string> = new Set()
): CommodityConstant | null {
  if (depth > FACTORY_RESOLVE_MAX_DEPTH) return null;
  if (seen.has(commodity)) return null;
  seen.add(commodity);

  const recipe = getRecipe(commodity);
  if (!recipe) return null;
  if (!factoryCanRun(factory, recipe.level)) return null;

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const needPerBatch = recipe.components[rc] ?? 0;
    if (needPerBatch <= 0) continue;

    const inStores = totalStock(room, rc) - mineralReserve(rc) + (factory.store.getUsedCapacity(rc) ?? 0);

    if (rc === RESOURCE_ENERGY) {
      const spendable =
        (room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0) - FACTORY_MIN_RESERVE_ENERGY +
        (factory.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0);
      if (spendable < needPerBatch) return null;
      continue;
    }

    if (inStores >= needPerBatch) continue;

    if (MANAGED_COMMODITIES.has(rc)) {
      const sub = resolveProduction(room, factory, rc as CommodityConstant, depth + 1, seen);
      if (sub) return sub;
      return null;
    }

    return null;
  }

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

function commandCourier(room: Room, factory: StructureFactory, recipe: Recipe | null): void {
  const storage = room.storage;
  if (!storage) return;

  const wanted = new Set<string>();
  if (recipe) {
    for (const comp in recipe.components) wanted.add(comp);
  }

  const evict = findEvictResource(factory, wanted);
  const load = recipe ? findLoadResource(room, factory, recipe) : null;
  // A courier still holding cargo puts it away before going back to hauling:
  // a hauler only moves energy, so anything else would ride with it for life.
  if (!evict && !load && !courierHoldsCargo(room)) {
    releaseCourier(room);
    return;
  }

  const courier = acquireCourier(room);
  if (!courier) return;

  const carried = (Object.keys(courier.store) as ResourceConstant[]).filter(
    (r) => (courier.store.getUsedCapacity(r) ?? 0) > 0
  );

  if (carried.length > 0) {
    const r = carried[0];
    // Deliver what the factory still wants even when that withdrawal took the
    // last spare stock, which drops it out of findLoadResource.
    if ((load && r === load.resource) || (recipe && factoryWantsMore(factory, recipe, r))) {
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

function findEvictResource(
  factory: StructureFactory,
  wanted: Set<string>
): ResourceConstant | null {
  const held = Object.keys(factory.store) as ResourceConstant[];
  for (const r of held) {
    const amt = factory.store.getUsedCapacity(r) ?? 0;
    if (amt <= 0) continue;
    if (!wanted.has(r)) {
      const batched = r === RESOURCE_ENERGY || MANAGED_COMMODITIES.has(r);
      if (!batched || amt >= FACTORY_PRODUCT_EVICT_THRESHOLD) return r;
    }
  }
  return null;
}

interface LoadJob {
  resource: ResourceConstant;
  source: StructureStorage | StructureTerminal;
  amount: number;
}

function inputShortfall(factory: StructureFactory, recipe: Recipe, rc: ResourceConstant): number {
  const need = recipe.components[rc] ?? 0;
  if (need <= 0) return 0;
  const desired = Math.min(FACTORY_MAX_INPUT_LOAD, Math.max(need * 4, need));
  return desired - (factory.store.getUsedCapacity(rc) ?? 0);
}

function factoryWantsMore(factory: StructureFactory, recipe: Recipe, rc: ResourceConstant): boolean {
  return inputShortfall(factory, recipe, rc) > 0 && (factory.store.getFreeCapacity(rc) ?? 0) > 0;
}

function courierHoldsCargo(room: Room): boolean {
  const name = room.memory.factorySystem?.courierName;
  const courier = name ? Game.creeps[name] : undefined;
  return !!courier && (courier.store.getUsedCapacity() ?? 0) > 0;
}

function findLoadResource(room: Room, factory: StructureFactory, recipe: Recipe): LoadJob | null {
  const storage = room.storage;
  const terminal = room.terminal;

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const need = recipe.components[rc] ?? 0;
    if (need <= 0) continue;

    const want = inputShortfall(factory, recipe, rc);
    if (want <= 0) continue;

    const spare = totalStock(room, rc) - mineralReserve(rc);
    for (const src of [storage, terminal]) {
      if (!src) continue;
      let avail = src.store.getUsedCapacity(rc) ?? 0;
      if (rc === RESOURCE_ENERGY && src === storage) {
        avail = Math.max(0, avail - FACTORY_MIN_RESERVE_ENERGY);
      } else if (rc !== RESOURCE_ENERGY) {
        avail = Math.min(avail, spare);
      }
      if (avail <= 0) continue;
      return { resource: rc, source: src, amount: Math.min(want, avail) };
    }
  }
  return null;
}

function acquireCourier(room: Room): Creep | null {
  const fs = room.memory.factorySystem!;

  const haulers = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.role === ROLE_HAULER && c.spawning !== true,
  });
  const mayBorrow = mayBorrowHauler(room, haulers);

  if (fs.courierName) {
    const existing = Game.creeps[fs.courierName];
    if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
      const holdsNonEnergy =
        (existing.store.getUsedCapacity() ?? 0) > (existing.store[RESOURCE_ENERGY] ?? 0);
      if (mayBorrow || holdsNonEnergy) return existing;
    }
    delete fs.courierName;
  }

  if (!mayBorrow) return null;

  const factory = fs.factoryId ? Game.getObjectById(fs.factoryId) : null;
  const pool = haulers.filter((c) => (c.store.getUsedCapacity() ?? 0) === 0);
  if (pool.length === 0) return null;

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

const LAB_MINERALS: ReadonlySet<string> = new Set<string>([
  RESOURCE_HYDROGEN,
  RESOURCE_OXYGEN,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_CATALYST,
]);

function mineralReserve(resource: ResourceConstant): number {
  if (resource === RESOURCE_GHODIUM) return FACTORY_MIN_RESERVE_MINERAL + NUKER_GHODIUM_RESERVE;
  return LAB_MINERALS.has(resource) ? FACTORY_MIN_RESERVE_MINERAL : 0;
}

function totalStock(room: Room, resource: ResourceConstant): number {
  return (
    (room.storage?.store.getUsedCapacity(resource) ?? 0) +
    (room.terminal?.store.getUsedCapacity(resource) ?? 0)
  );
}

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

    const parts = COMMODITY_TARGETS.filter((t) => t.requiresLevel <= level)
      .filter((t) => totalStock(room, t.commodity) < t.target)
      .sort((a, b) => (COMMODITY_VALUE.get(b.commodity) ?? 0) - (COMMODITY_VALUE.get(a.commodity) ?? 0))
      .map((t) => `${t.commodity}=${totalStock(room, t.commodity)}/${t.target}`)
      .join("  ");
    if (parts) lines.push(`  ${parts}`);
  }
  return lines;
}

export function forceCommodity(roomName: string, commodity: string): string | null {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) return `${roomName} is not a room you own`;
  if (!COMMODITIES[commodity as CommodityConstant]) return `${commodity} is not a valid commodity`;
  const factory = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureFactory => s.structureType === STRUCTURE_FACTORY,
  })[0] as StructureFactory | undefined;
  if (!factory) return `${roomName} has no factory`;

  const recipe = getRecipe(commodity as CommodityConstant);
  if (recipe && recipe.level !== 0 && (factory.level ?? 0) !== recipe.level) {
    return `${commodity} needs a level ${recipe.level} factory (have ${factory.level ?? 0})`;
  }

  if (!room.memory.factorySystem) room.memory.factorySystem = {};
  room.memory.factorySystem.activeCommodity = commodity as CommodityConstant;
  room.memory.factorySystem.lastPlanTick = Game.time;
  return null;
}

export function setAuto(roomName: string, enabled: boolean): string | null {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) return `${roomName} is not a room you own`;
  if (!room.memory.factorySystem) room.memory.factorySystem = {};
  room.memory.factorySystem.autoEnabled = enabled;
  return null;
}

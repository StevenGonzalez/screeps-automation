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
  const factoryLevel = factory.level ?? 0;

  let best: CommodityConstant | undefined;
  let bestValue = -Infinity;

  for (const t of COMMODITY_TARGETS) {
    if (factoryLevel < t.requiresLevel) continue;
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
  if ((factory.level ?? 0) < recipe.level) return null;

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const needPerBatch = recipe.components[rc] ?? 0;
    if (needPerBatch <= 0) continue;

    const inStores = totalStock(room, rc) + (factory.store.getUsedCapacity(rc) ?? 0);

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
  if (!evict && !load) {
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

function findLoadResource(room: Room, factory: StructureFactory, recipe: Recipe): LoadJob | null {
  const storage = room.storage;
  const terminal = room.terminal;

  for (const comp in recipe.components) {
    const rc = comp as ResourceConstant;
    const need = recipe.components[rc] ?? 0;
    if (need <= 0) continue;

    const inFactory = factory.store.getUsedCapacity(rc) ?? 0;
    const desired = Math.min(FACTORY_MAX_INPUT_LOAD, Math.max(need * 4, need));
    if (inFactory >= desired) continue;

    const want = desired - inFactory;

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

function acquireCourier(room: Room): Creep | null {
  const fs = room.memory.factorySystem!;

  if (fs.courierName) {
    const existing = Game.creeps[fs.courierName];
    if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
      return existing;
    }
    delete fs.courierName;
  }

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
  if (recipe && (factory.level ?? 0) < recipe.level) {
    return `${commodity} needs factory level ${recipe.level} (have ${factory.level ?? 0}) - level it via PWR_OPERATE_FACTORY`;
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

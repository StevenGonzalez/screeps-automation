import {
  resolveChain,
  getStorageStockForCompound,
  REACTION_RECIPES,
} from "../services/services.labs";
import { advanceBoost } from "../services/services.combat";

const LAB_STALL_TIMEOUT = 200;

const LAB_PLAN_INTERVAL = 100;

const AUTO_PRODUCTION_TARGETS: Record<string, number> = {
  XUH2O: 3000,
  XUHO2: 3000,
  XKHO2: 3000,
  XZHO2: 2000,
  XGH2O: 3000,
  OH:    10000,
  G:     5000,
};

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    processLabSystem(room);
  }
}

function runBoosts(room: Room) {
  const ls = room.memory.labSystem;
  if (!ls?.outputLabIds?.length) return;

  const outputLabs = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null);

  const waitingCreeps = room.find(FIND_MY_CREEPS, {
    filter: (c) => !!c.memory.boostCompound && !c.memory.boosted,
  });

  for (const creep of waitingCreeps) {
    const compound = creep.memory.boostCompound as ResourceConstant;
    for (const lab of outputLabs) {
      if ((lab.store.getUsedCapacity(compound) ?? 0) < 30) continue;
      if (!lab.pos.isNearTo(creep.pos)) continue;
      if (lab.boostCreep(creep) === OK) {
        advanceBoost(creep);
      }
      break;
    }
  }
}

function processLabSystem(room: Room) {
  if (!room.memory.labSystem) room.memory.labSystem = { queue: [] };
  const ls = room.memory.labSystem;

  const needsPlan = !ls.lastPlanTick || Game.time - ls.lastPlanTick >= LAB_PLAN_INTERVAL;
  if (needsPlan) {
    refreshLabIdentity(room);
    if (ls.queue.length === 0 && ls.autoEnabled !== false) {
      planAutoProduction(room);
    }
    ls.lastPlanTick = Game.time;
  }

  runBoosts(room);

  if (!ls.inputLabIds || !ls.outputLabIds) return;

  const inputLabs = ls.inputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null);
  const outputLabs = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null);

  if (inputLabs.length < 2 || outputLabs.length === 0) return;

  if (!ls.activeCompound) {
    if (ls.queue.length === 0) return;
    const next = ls.queue[0];
    const recipe = REACTION_RECIPES[next.compound];
    if (!recipe) { ls.queue.shift(); return; }
    ls.activeCompound = next.compound;
    ls.inputCompounds = [recipe[0], recipe[1]];
    ls.startStock = producedStock(next.compound, room, outputLabs);
    ls.targetAmount = next.amount;
    ls.lastProduced = 0;
    ls.lastProgressTick = Game.time;
    return;
  }

  if (!ls.inputCompounds) return;

  const produced = producedStock(ls.activeCompound, room, outputLabs) - (ls.startStock ?? 0);
  if (produced >= (ls.targetAmount ?? 0)) {
    ls.queue.shift();
    delete ls.activeCompound;
    delete ls.inputCompounds;
    delete ls.startStock;
    delete ls.targetAmount;
    delete ls.lastProduced;
    delete ls.lastProgressTick;
    return;
  }

  if (produced > (ls.lastProduced ?? 0)) {
    ls.lastProduced = produced;
    ls.lastProgressTick = Game.time;
  } else if (Game.time - (ls.lastProgressTick ?? Game.time) > LAB_STALL_TIMEOUT) {
    console.log(
      `[Labs] ${room.name}: reaction ${ls.activeCompound} stalled (no progress in ` +
      `${LAB_STALL_TIMEOUT} ticks) - aborting and advancing queue.`
    );
    ls.queue.shift();
    delete ls.activeCompound;
    delete ls.inputCompounds;
    delete ls.startStock;
    delete ls.targetAmount;
    delete ls.lastProduced;
    delete ls.lastProgressTick;
    return;
  }

  const rc0 = ls.inputCompounds[0] as ResourceConstant;
  const rc1 = ls.inputCompounds[1] as ResourceConstant;
  if (
    (inputLabs[0].store.getUsedCapacity(rc0) ?? 0) > 0 &&
    (inputLabs[1].store.getUsedCapacity(rc1) ?? 0) > 0
  ) {
    for (const outputLab of outputLabs) {
      outputLab.runReaction(inputLabs[0], inputLabs[1]);
    }
  }
}

function producedStock(compound: string, room: Room, outputLabs: StructureLab[]): number {
  const rc = compound as ResourceConstant;
  let total = room.storage?.store.getUsedCapacity(rc) ?? 0;
  for (const lab of outputLabs) total += lab.store.getUsedCapacity(rc) ?? 0;
  return total;
}

function refreshLabIdentity(room: Room) {
  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLab => s.structureType === STRUCTURE_LAB,
  }) as StructureLab[];
  if (labs.length < 3) return;

  const ls = room.memory.labSystem!;

  const cachedCount = (ls.inputLabIds?.length ?? 0) + (ls.outputLabIds?.length ?? 0);
  if (
    ls.inputLabIds?.length === 2 &&
    (ls.outputLabIds?.length ?? 0) > 0 &&
    cachedCount === labs.length &&
    [...(ls.inputLabIds ?? []), ...(ls.outputLabIds ?? [])].every((id) => Game.getObjectById(id))
  ) {
    return;
  }

  const refPos = room.storage?.pos ?? room.find(FIND_MY_SPAWNS)[0]?.pos;
  if (!refPos) return;

  const sorted = [...labs].sort((a, b) => a.pos.getRangeTo(refPos) - b.pos.getRangeTo(refPos));
  const central = sorted.filter((lab) =>
    labs.every((other) => other.id === lab.id || lab.pos.getRangeTo(other) <= 2)
  );
  const inputs = (central.length >= 2 ? central : sorted).slice(0, 2);
  const inputIds = new Set(inputs.map((l) => l.id));
  ls.inputLabIds = inputs.map((l) => l.id as Id<StructureLab>);
  ls.outputLabIds = labs.filter((l) => !inputIds.has(l.id)).map((l) => l.id as Id<StructureLab>);
}

function planAutoProduction(room: Room) {
  const ls = room.memory.labSystem!;
  for (const [compound, target] of Object.entries(AUTO_PRODUCTION_TARGETS)) {
    const stock = getStorageStockForCompound(compound, room);
    if (stock < target) {
      const chain = resolveChain(compound, target, room.storage ?? null);
      if (chain.length > 0) {
        ls.queue.push(...chain);
        return;
      }
    }
  }
}

import { resolveChain, getStockForCompound, REACTIONS } from "../services/services.labs";

const LAB_PLAN_INTERVAL = 100;

// Default stock targets for auto-production; adjust as needed per playstyle.
const AUTO_PRODUCTION_TARGETS: Record<string, number> = {
  XUH2O: 3000,  // catalyzed attack boost (T4)
  XUHO2: 3000,  // catalyzed dismantle boost (T4)
  XKHO2: 3000,  // catalyzed fatigue reduction (T4)
  XZHO2: 2000,  // catalyzed fatigue reduction alt (T4)
  XGH2O: 3000,  // catalyzed harvest boost (T4)
  OH:    10000, // universal intermediate
  G:     5000,  // catalyst / power-bank ingredient
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
        creep.memory.boosted = true;
        delete creep.memory.boostCompound;
      }
      break;
    }
  }
}

function processLabSystem(room: Room) {
  if (!room.memory.labSystem) room.memory.labSystem = { queue: [] };
  const ls = room.memory.labSystem;

  // Periodic: identify labs + maybe queue auto-production
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

  // Advance queue when idle
  if (!ls.activeCompound) {
    if (ls.queue.length === 0) return;
    const next = ls.queue[0];
    const recipe = REACTIONS[next.compound];
    if (!recipe) { ls.queue.shift(); return; }
    ls.activeCompound = next.compound;
    ls.inputCompounds = [recipe[0], recipe[1]];
    ls.startStock = getStockForCompound(next.compound, room);
    ls.targetAmount = next.amount;
    return; // let chemist fill labs this tick before we try to react
  }

  if (!ls.inputCompounds) return;

  // Check completion
  const produced = getStockForCompound(ls.activeCompound, room) - (ls.startStock ?? 0);
  if (produced >= (ls.targetAmount ?? 0)) {
    console.log(`[Labs] ${room.name}: Finished ${ls.activeCompound} (produced ${produced})`);
    ls.queue.shift();
    delete ls.activeCompound;
    delete ls.inputCompounds;
    delete ls.startStock;
    delete ls.targetAmount;
    return;
  }

  // Run reactions on all output labs
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

function refreshLabIdentity(room: Room) {
  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLab => s.structureType === STRUCTURE_LAB,
  }) as StructureLab[];
  if (labs.length < 3) return;

  const ls = room.memory.labSystem!;

  // Keep cached IDs if they're still valid
  if (
    ls.inputLabIds?.length === 2 &&
    (ls.outputLabIds?.length ?? 0) > 0 &&
    [...(ls.inputLabIds ?? []), ...(ls.outputLabIds ?? [])].every((id) => Game.getObjectById(id))
  ) {
    return;
  }

  const refPos = room.storage?.pos ?? room.find(FIND_MY_SPAWNS)[0]?.pos;
  if (!refPos) return;

  // Input labs = 2 closest to storage (easiest for chemist to access)
  const sorted = [...labs].sort((a, b) => a.pos.getRangeTo(refPos) - b.pos.getRangeTo(refPos));
  ls.inputLabIds = sorted.slice(0, 2).map((l) => l.id as Id<StructureLab>);
  ls.outputLabIds = sorted.slice(2).map((l) => l.id as Id<StructureLab>);
}

function planAutoProduction(room: Room) {
  const ls = room.memory.labSystem!;
  for (const [compound, target] of Object.entries(AUTO_PRODUCTION_TARGETS)) {
    const stock = getStockForCompound(compound, room);
    if (stock < target) {
      const chain = resolveChain(compound, target, room.storage ?? null);
      if (chain.length > 0) {
        ls.queue.push(...chain);
        console.log(
          `[Labs] ${room.name}: Auto-queued ${chain.length} reaction(s) → ${compound} (have ${stock}/${target})`
        );
        return; // one compound per planning cycle
      }
    }
  }
}

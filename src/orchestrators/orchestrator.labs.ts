import {
  resolveChain,
  getStorageStockForCompound,
  REACTION_RECIPES,
} from "../services/services.labs";
import { advanceBoost } from "../services/services.combat";

// Abort an active reaction that hasn't increased its produced count for this many ticks.
// A reaction stalls when its reagents are unavailable (base mineral exhausted, or the
// product is drained by boosting faster than it's made); without this the active compound
// never completes and blocks the entire lab queue — including boosts — forever.
const LAB_STALL_TIMEOUT = 200;

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
        // Advance to the next queued boost (e.g. TOUGH) or mark fully boosted.
        advanceBoost(creep);
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
    const recipe = REACTION_RECIPES[next.compound];
    if (!recipe) { ls.queue.shift(); return; }
    ls.activeCompound = next.compound;
    ls.inputCompounds = [recipe[0], recipe[1]];
    ls.startStock = producedStock(next.compound, room, outputLabs);
    ls.targetAmount = next.amount;
    ls.lastProduced = 0;
    ls.lastProgressTick = Game.time;
    return; // let apothecary fill labs this tick before we try to react
  }

  if (!ls.inputCompounds) return;

  // Check completion. Count product in storage AND in the output labs: runReaction
  // deposits into the output lab, and the apothecary only drains it to storage once a
  // lab fills past ~75%. Measuring storage alone lags real production, so the head would
  // never pop (and the stall watchdog could abort a reaction that is in fact producing).
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

  // Stall watchdog: if production hasn't advanced in LAB_STALL_TIMEOUT ticks, the reagents
  // aren't coming — abort this compound and free the queue instead of blocking it forever.
  if (produced > (ls.lastProduced ?? 0)) {
    ls.lastProduced = produced;
    ls.lastProgressTick = Game.time;
  } else if (Game.time - (ls.lastProgressTick ?? Game.time) > LAB_STALL_TIMEOUT) {
    console.log(
      `[Labs] ${room.name}: reaction ${ls.activeCompound} stalled (no progress in ` +
      `${LAB_STALL_TIMEOUT} ticks) — aborting and advancing queue.`
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

// Total amount of `compound` already produced this run: storage plus what's still sitting
// in the output labs before the apothecary has hauled it to storage.
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

  // Keep cached IDs if they're still valid AND still cover every lab — when a new lab is
  // built (e.g. RCL 7 → 8) the count grows, so we must re-derive roles to slot the new labs
  // in and re-check that the input pair is still central (see below).
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

  // runReaction requires BOTH input labs within range 2 of every output lab, so each input
  // must be within range 2 of ALL other labs. At RCL 8 the cluster spans 3 tiles, so a
  // corner lab can't reach the opposite corner — picking inputs purely by distance-to-storage
  // could grab a corner and silently disable the far output labs (they'd return ERR_NOT_IN_RANGE
  // forever). Restrict input candidates to "central" labs, then prefer the two closest to
  // storage for apothecary access. Fall back to closest-to-storage if no central pair exists.
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
    // Storage-only basis so the chain's delta and the completion check agree (see
    // getStorageStockForCompound). Reagents and the produced buffer both live in storage.
    const stock = getStorageStockForCompound(compound, room);
    if (stock < target) {
      const chain = resolveChain(compound, target, room.storage ?? null);
      if (chain.length > 0) {
        ls.queue.push(...chain);
        return; // one compound per planning cycle
      }
    }
  }
}

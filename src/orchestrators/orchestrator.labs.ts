import {
  resolveChain,
  getStockForCompound,
  labInputStock,
  labMineralShortfall,
  queuedBaseMineralNeed,
  REACTION_RECIPES,
  getBoostRequests,
  assignBoostLabs,
} from "../services/services.labs";
import { advanceBoost } from "../services/services.combat";
import { mineralSupplyExpected } from "./orchestrator.terminal";

const LAB_STALL_TIMEOUT = 200;
// A reaction short of an input the market or another room can supply waits
// this long for it before being dropped.
const LAB_SUPPLY_WAIT_TIMEOUT = 3000;
const SUPPLIED_INPUTS = new Set(["H", "O", "U", "L", "K", "Z", "X", "G"]);
// LAB_REACTION_AMOUNT: what one reaction takes of each input.
const REACTION_INPUT_MIN = 5;

const LAB_PLAN_INTERVAL = 100;
// An auto target whose chain stalled sits out this long, so the targets after
// it get the labs instead of the same stalled chain being planned again.
const LAB_TARGET_BENCH_TICKS = 10_000;

export const AUTO_PRODUCTION_TARGETS: Record<string, number> = {
  XUH2O: 3000,
  XKHO2: 3000,
  XLHO2: 3000,
  XZH2O: 2000,
  XZHO2: 2000,
  XGH2O: 3000,
  XGHO2: 2000,
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
    if (ls.queue.length === 0) delete ls.plannedTarget;
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
  } else if (
    // Only a reaction idle past the shorter timeout asks after its supply,
    // which may look at the market.
    Game.time - (ls.lastProgressTick ?? Game.time) > LAB_STALL_TIMEOUT &&
    Game.time - (ls.lastProgressTick ?? Game.time) > stallTimeout(room, ls.inputCompounds)
  ) {
    console.log(
      `[Labs] ${room.name}: reaction ${ls.activeCompound} stalled (no progress in ` +
      `${stallTimeout(room, ls.inputCompounds)} ticks) - aborting and advancing queue.`
    );
    const stalled = ls.queue.shift();
    // The rest of an auto chain feeds the stalled step's target, so it goes
    // too. Steps queued from the console stay.
    if (stalled?.auto && ls.plannedTarget) {
      ls.benchedUntil = { ...ls.benchedUntil, [ls.plannedTarget]: Game.time + LAB_TARGET_BENCH_TICKS };
      ls.queue = ls.queue.filter((e) => !e.auto);
      delete ls.plannedTarget;
    }
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
    const boostLabIds = new Set<string>();
    for (const lab of assignBoostLabs(outputLabs, getBoostRequests(room).keys()).values()) {
      boostLabIds.add(lab.id);
    }
    for (const outputLab of outputLabs) {
      if (boostLabIds.has(outputLab.id)) continue;
      outputLab.runReaction(inputLabs[0], inputLabs[1]);
    }
  }
}

/**
 * How long a reaction may go without progress. Running dry on an input the
 * terminal is buying or another room is sending is a wait, not a fault. A base
 * mineral nobody will send or sell is not waited for.
 */
export function stallTimeout(room: Room, inputs: [string, string]): number {
  const awaitingSupply = inputs.some(
    (c) =>
      SUPPLIED_INPUTS.has(c) &&
      labInputStock(room, c) < REACTION_INPUT_MIN &&
      (c === RESOURCE_GHODIUM ||
        mineralSupplyExpected(room, c as MineralConstant, labMineralShortfall(room).get(c) ?? 0))
  );
  return awaitingSupply ? LAB_SUPPLY_WAIT_TIMEOUT : LAB_STALL_TIMEOUT;
}

/**
 * Whether every base mineral a chain needs is in the room or on its way. A
 * chain short of one nobody will send or sell held Embercrag's labs for the
 * whole supply wait before it was benched: on a market with no Z, K, U, L or
 * X under the price the terminal pays, five targets did this in turn, while
 * OH, which Embercrag had the O and some H for, waited behind them.
 */
function chainSupplied(room: Room, chain: LabQueueEntry[]): boolean {
  for (const [mineral, need] of queuedBaseMineralNeed(chain)) {
    if (labInputStock(room, mineral) >= REACTION_INPUT_MIN) continue;
    if (!mineralSupplyExpected(room, mineral as MineralConstant, need)) return false;
  }
  return true;
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

export function planAutoProduction(room: Room) {
  const ls = room.memory.labSystem!;
  for (const [compound, target] of Object.entries(AUTO_PRODUCTION_TARGETS)) {
    if ((ls.benchedUntil?.[compound] ?? 0) > Game.time) continue;
    const stock = getStockForCompound(compound, room);
    if (stock < target) {
      const chain = resolveChain(compound, target, room);
      if (chain.length > 0 && chainSupplied(room, chain)) {
        ls.queue.push(...chain.map((e) => ({ ...e, auto: true })));
        ls.plannedTarget = compound;
        return;
      }
    }
  }
}

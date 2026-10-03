export const REACTION_RECIPES: Record<string, [string, string]> = {
  OH:    ['O', 'H'],
  ZK:    ['Z', 'K'],
  UL:    ['U', 'L'],
  G:     ['ZK', 'UL'],
  UH:    ['U', 'H'],
  UO:    ['U', 'O'],
  KH:    ['K', 'H'],
  KO:    ['K', 'O'],
  LH:    ['L', 'H'],
  LO:    ['L', 'O'],
  ZH:    ['Z', 'H'],
  ZO:    ['Z', 'O'],
  GH:    ['G', 'H'],
  GO:    ['G', 'O'],
  UH2O:  ['UH', 'OH'],
  UHO2:  ['UO', 'OH'],
  KH2O:  ['KH', 'OH'],
  KHO2:  ['KO', 'OH'],
  LH2O:  ['LH', 'OH'],
  LHO2:  ['LO', 'OH'],
  ZH2O:  ['ZH', 'OH'],
  ZHO2:  ['ZO', 'OH'],
  GH2O:  ['GH', 'OH'],
  GHO2:  ['GO', 'OH'],
  XUH2O: ['UH2O', 'X'],
  XUHO2: ['UHO2', 'X'],
  XKH2O: ['KH2O', 'X'],
  XKHO2: ['KHO2', 'X'],
  XLH2O: ['LH2O', 'X'],
  XLHO2: ['LHO2', 'X'],
  XZH2O: ['ZH2O', 'X'],
  XZHO2: ['ZHO2', 'X'],
  XGH2O: ['GH2O', 'X'],
  XGHO2: ['GHO2', 'X'],
};

export function resolveChain(
  compound: string,
  amount: number,
  room: Room | null
): LabQueueEntry[] {
  const post: string[] = [];
  const visited = new Set<string>();
  function dfs(c: string) {
    if (visited.has(c) || !REACTION_RECIPES[c]) return;
    visited.add(c);
    const [a, b] = REACTION_RECIPES[c];
    dfs(a);
    dfs(b);
    post.push(c);
  }
  dfs(compound);

  const grossNeed = new Map<string, number>([[compound, amount]]);
  const netNeed = new Map<string, number>();
  for (let i = post.length - 1; i >= 0; i--) {
    const c = post[i];
    const have = room ? getStockForCompound(c, room) : 0;
    const net = Math.max(0, (grossNeed.get(c) ?? 0) - have);
    if (net <= 0) continue;
    netNeed.set(c, net);
    const [a, b] = REACTION_RECIPES[c];
    grossNeed.set(a, (grossNeed.get(a) ?? 0) + net);
    grossNeed.set(b, (grossNeed.get(b) ?? 0) + net);
  }

  const result: LabQueueEntry[] = [];
  for (const c of post) {
    if (netNeed.has(c)) result.push({ compound: c, amount: netNeed.get(c)! });
  }
  return result;
}

function boostedPartType(compound: string): BodyPartConstant | undefined {
  for (const part of Object.keys(BOOSTS) as BodyPartConstant[]) {
    if ((BOOSTS as Record<string, Record<string, unknown>>)[part][compound]) return part;
  }
  return undefined;
}

// Compound -> mineral needed by creeps (spawning included) waiting on a boost.
// Queued boosts count too, so every lab is loaded before the creep arrives
// rather than one at a time inside its short boosting window.
export function getBoostRequests(room: Room): Map<string, number> {
  const requests = new Map<string, number>();
  for (const c of room.find(FIND_MY_CREEPS)) {
    if (c.memory.boosted) continue;
    const pending = [c.memory.boostCompound, ...(c.memory.boostQueue ?? [])];
    for (const compound of pending) {
      if (!compound) continue;
      const part = boostedPartType(compound);
      if (!part) continue;
      const parts = c.body.filter((b) => b.type === part && !b.boost).length;
      if (parts > 0) {
        requests.set(compound, (requests.get(compound) ?? 0) + parts * LAB_BOOST_MINERAL);
      }
    }
  }
  return requests;
}

// One output lab per requested compound: a lab already holding it, else a free one
// taken from the end of the list. Reactions skip these labs while the boost is pending.
export function assignBoostLabs(
  outputLabs: StructureLab[],
  compounds: Iterable<string>
): Map<string, StructureLab> {
  const assigned = new Map<string, StructureLab>();
  const taken = new Set<string>();
  const unplaced: string[] = [];
  for (const compound of compounds) {
    const lab = outputLabs.find((l) => l.mineralType === compound && !taken.has(l.id));
    if (lab) {
      assigned.set(compound, lab);
      taken.add(lab.id);
    } else {
      unplaced.push(compound);
    }
  }
  for (const compound of unplaced) {
    const lab = [...outputLabs].reverse().find((l) => !taken.has(l.id));
    if (!lab) break;
    assigned.set(compound, lab);
    taken.add(lab.id);
  }
  return assigned;
}

export function getStockForCompound(compound: string, room: Room): number {
  const rc = compound as ResourceConstant;
  return (
    (room.storage?.store.getUsedCapacity(rc) ?? 0) +
    (room.terminal?.store.getUsedCapacity(rc) ?? 0)
  );
}

const BASE_MINERAL_SET = new Set<string>(["H", "O", "U", "L", "K", "Z", "X"]);

// Base minerals the queued reactions will consume, summed per mineral. Queue
// entries are already net of stock on hand, so this is what the labs still need.
// `producedOnFirst` is what the running reaction (always queue[0]) has made.
export function queuedBaseMineralNeed(
  queue: LabQueueEntry[],
  producedOnFirst = 0
): Map<string, number> {
  const need = new Map<string, number>();
  queue.forEach((entry, i) => {
    const recipe = REACTION_RECIPES[entry.compound];
    if (!recipe) return;
    const amount = i === 0 ? Math.max(0, entry.amount - producedOnFirst) : entry.amount;
    for (const input of recipe) {
      if (BASE_MINERAL_SET.has(input)) need.set(input, (need.get(input) ?? 0) + amount);
    }
  });
  return need;
}

/** Base minerals this room's lab queue still has to consume. */
export function labMineralNeed(room: Room): Map<string, number> {
  const ls = room.memory.labSystem;
  return queuedBaseMineralNeed(ls?.queue ?? [], ls?.activeCompound ? ls.lastProduced ?? 0 : 0);
}

/** A lab input held in the room: storage, terminal and the input labs. */
export function labInputStock(room: Room, resource: string): number {
  let total = getStockForCompound(resource, room);
  for (const id of room.memory.labSystem?.inputLabIds ?? []) {
    const lab = Game.getObjectById(id) as StructureLab | null;
    total += lab?.store.getUsedCapacity(resource as ResourceConstant) ?? 0;
  }
  return total;
}

/** Queued terminal sends from our other rooms to `room` of `resource`. */
export function incomingSends(room: Room, resource: string): number {
  let total = 0;
  for (const name in Game.rooms) {
    const pending = Game.rooms[name].memory?.pendingSend;
    if (pending && pending.to === room.name && pending.resource === resource) total += pending.amount;
  }
  return total;
}

/** Base minerals the lab queue needs beyond what the room holds or has on the way. */
export function labMineralShortfall(room: Room): Map<string, number> {
  const shortfall = new Map<string, number>();
  for (const [mineral, need] of labMineralNeed(room)) {
    const missing = need - labInputStock(room, mineral) - incomingSends(room, mineral);
    if (missing > 0) shortfall.set(mineral, missing);
  }
  return shortfall;
}

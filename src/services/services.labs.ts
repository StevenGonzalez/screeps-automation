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
  storage: StructureStorage | null
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
    const have = storage?.store.getUsedCapacity(c as ResourceConstant) ?? 0;
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

// Compound -> mineral needed by creeps (spawning included) waiting on their current boost.
export function getBoostRequests(room: Room): Map<string, number> {
  const requests = new Map<string, number>();
  for (const c of room.find(FIND_MY_CREEPS)) {
    const compound = c.memory.boostCompound;
    if (!compound || c.memory.boosted) continue;
    const part = boostedPartType(compound);
    if (!part) continue;
    const parts = c.body.filter((b) => b.type === part && !b.boost).length;
    if (parts > 0) {
      requests.set(compound, (requests.get(compound) ?? 0) + parts * LAB_BOOST_MINERAL);
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

export function getStorageStockForCompound(compound: string, room: Room): number {
  return room.storage?.store.getUsedCapacity(compound as ResourceConstant) ?? 0;
}

const BASE_MINERAL_SET = new Set<string>(["H", "O", "U", "L", "K", "Z", "X"]);

// Base minerals the queued reactions will consume, summed per mineral. Queue
// entries are already net of stock on hand, so this is what the labs still need.
export function queuedBaseMineralNeed(queue: LabQueueEntry[]): Map<string, number> {
  const need = new Map<string, number>();
  for (const entry of queue) {
    const recipe = REACTION_RECIPES[entry.compound];
    if (!recipe) continue;
    for (const input of recipe) {
      if (BASE_MINERAL_SET.has(input)) need.set(input, (need.get(input) ?? 0) + entry.amount);
    }
  }
  return need;
}

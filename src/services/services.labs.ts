// Complete reaction database: output compound → [ingredient1, ingredient2]
// NB: named REACTION_RECIPES, not REACTIONS, to avoid colliding with the
// Screeps built-in global REACTIONS once rollup flattens modules.
export const REACTION_RECIPES: Record<string, [string, string]> = {
  // Tier 1
  OH:    ['O', 'H'],
  ZK:    ['Z', 'K'],
  UL:    ['U', 'L'],
  G:     ['ZK', 'UL'],
  // Tier 2
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
  // Tier 3
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
  // Tier 4
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

// Returns ordered list of reactions needed to produce `amount` of `compound`.
// Dependencies (ingredients) always come before the compounds that use them.
// Deduplicates intermediates — if OH is needed by two chains, it appears once.
export function resolveChain(
  compound: string,
  amount: number,
  storage: StructureStorage | null
): LabQueueEntry[] {
  const needed = new Map<string, number>();

  function collect(c: string, qty: number) {
    const recipe = REACTION_RECIPES[c];
    if (!recipe) return; // base mineral — no reaction, nothing to queue
    const have = storage?.store.getUsedCapacity(c as ResourceConstant) ?? 0;
    const need = Math.max(0, qty - have);
    if (need <= 0) return;
    needed.set(c, Math.max(needed.get(c) ?? 0, need));
    collect(recipe[0], need);
    collect(recipe[1], need);
  }

  collect(compound, amount);

  // Topological sort: each compound appears after all its ingredients
  const result: LabQueueEntry[] = [];
  const added = new Set<string>();

  function addInOrder(c: string) {
    if (added.has(c) || !needed.has(c)) return;
    const recipe = REACTION_RECIPES[c];
    if (recipe) {
      addInOrder(recipe[0]);
      addInOrder(recipe[1]);
    }
    result.push({ compound: c, amount: needed.get(c)! });
    added.add(c);
  }

  addInOrder(compound);
  return result;
}

// Total stock of a compound across storage + terminal (terminal holds excess)
export function getStockForCompound(compound: string, room: Room): number {
  const rc = compound as ResourceConstant;
  return (
    (room.storage?.store.getUsedCapacity(rc) ?? 0) +
    (room.terminal?.store.getUsedCapacity(rc) ?? 0)
  );
}

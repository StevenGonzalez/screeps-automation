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
// Dependencies (ingredients) always come before the compounds that use them, and an
// intermediate consumed by more than one branch appears once with its demands summed.
//
// We can't subtract existing stock during a naive recursion: an intermediate reached by
// two parents would have its stock deducted twice, under-producing it. So we propagate
// demand in topological order (every consumer processed before its ingredients), compute
// each compound's net need = max(0, summed-demand − stock) exactly once, and feed that
// net need down to its ingredients. Net (not gross) propagation preserves the useful
// short-circuit where existing intermediate stock cuts off deeper production.
export function resolveChain(
  compound: string,
  amount: number,
  storage: StructureStorage | null
): LabQueueEntry[] {
  // Post-order DFS over the recipe DAG: ingredients are pushed before the compound that
  // uses them, so `post` lists every compound after its ingredients (the output order),
  // and its reverse is a valid topological order (every consumer before its ingredients).
  const post: string[] = [];
  const visited = new Set<string>();
  function dfs(c: string) {
    if (visited.has(c) || !REACTION_RECIPES[c]) return; // base mineral — not a reaction
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
    const c = post[i]; // reverse post-order = consumers before ingredients
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

// Total stock of a compound across storage + terminal (terminal holds excess)
export function getStockForCompound(compound: string, room: Room): number {
  const rc = compound as ResourceConstant;
  return (
    (room.storage?.store.getUsedCapacity(rc) ?? 0) +
    (room.terminal?.store.getUsedCapacity(rc) ?? 0)
  );
}

// Stock that lives specifically in STORAGE — the basis production must use. resolveChain
// measures existing stock from storage only and the chemist loads reagents from storage
// only, so the production target / completion check must too. Mixing in the terminal (as
// getStockForCompound does, for "do we hold enough overall to trade") makes the completion
// check overshoot the target by the terminal balance, or stall outright.
export function getStorageStockForCompound(compound: string, room: Room): number {
  return room.storage?.store.getUsedCapacity(compound as ResourceConstant) ?? 0;
}

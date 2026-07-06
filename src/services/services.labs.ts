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

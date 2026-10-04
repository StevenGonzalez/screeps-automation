// A creep's dossier: what it carries, how hale it is, how long it has left,
// and what its body is built of, read from its room object for the cinema's
// card (see cinema).

export interface BodyGroup {
  part: string;
  count: number;
  // Of these, how many are broken (no hits left) and how many boosted.
  broken: number;
  boosted: number;
}

export interface Dossier {
  // The creep's object id, so a card that stays on the same creep is not redrawn as new.
  id: string;
  name: string;
  detail: string;
  // The most of any one thing it carries, null when it cannot carry.
  cargo: { amount: number; capacity: number; what: string } | null;
  hits: number;
  hitsMax: number;
  // Ticks left to live out of its whole lifespan, null when not known.
  life: { left: number; span: number } | null;
  // Its body by part, the most numerous first.
  body: BodyGroup[];
  foe: boolean;
}

// How a carried resource is named: energy is the realm's gold.
const RESOURCE_NAMES: Record<string, string> = { energy: "gold" };
// A creep's lifespan in ticks, shorter for one with a claim part.
const LIFE_TICKS = 1500;
const CLAIM_LIFE_TICKS = 600;
// How a body part is named on the card.
const PART_NAMES: Record<string, string> = { ranged_attack: "ranged" };

export function dossierOf(id: string, o: Record<string, any>, gameTime: number | null, detail: string, foe: boolean): Dossier {
  const store: Record<string, number> = o.store && typeof o.store === "object" ? o.store : {};
  const capacity = Number(o.storeCapacity) || 0;
  let what = "energy";
  let amount = 0;
  for (const k in store) {
    const n = Number(store[k]) || 0;
    if (n > amount) {
      what = k;
      amount = n;
    }
  }
  const groups = new Map<string, BodyGroup>();
  for (const p of Array.isArray(o.body) ? o.body : []) {
    if (!p || typeof p.type !== "string") continue;
    const g = groups.get(p.type) ?? { part: PART_NAMES[p.type] ?? p.type, count: 0, broken: 0, boosted: 0 };
    g.count++;
    if (p.hits === 0) g.broken++;
    if (p.boost) g.boosted++;
    groups.set(p.type, g);
  }
  return {
    id,
    name: typeof o.name === "string" ? o.name : "A stranger",
    detail,
    cargo: capacity > 0 || amount > 0 ? { amount, capacity, what: RESOURCE_NAMES[what] ?? what } : null,
    hits: Number(o.hits) || 0,
    hitsMax: Number(o.hitsMax) || 0,
    life: typeof o.ageTime === "number" && gameTime !== null ? { left: Math.max(0, o.ageTime - gameTime), span: groups.has("claim") ? CLAIM_LIFE_TICKS : LIFE_TICKS } : null,
    body: [...groups.values()].sort((a, b) => b.count - a.count),
    foe,
  };
}

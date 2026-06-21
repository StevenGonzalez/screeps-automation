/**
 * Factory & commodity production config.
 *
 * The actual recipes (component minerals/commodities, output amount, cooldown and the
 * required factory level) live in the runtime `COMMODITIES` constant provided by the
 * game — we never re-hardcode those numbers. This file just decides WHICH commodities
 * the bot is willing to auto-produce, in what priority, the stock target for each, and a
 * static value rank used for profitability-aware selection.
 *
 * Tiers covered:
 *  - Tier 0 (level 0, always allowed): RESOURCE_BATTERY — energy → battery, a cheap
 *    energy-compaction commodity that needs no leveled factory.
 *  - Tier 1 (level 0, always allowed): the compressed base minerals (the "*_bar" and
 *    oxidant/reductant/purifier/ghodium_melt commodities). These compress a mineral +
 *    energy into a bar; reversible and safe to make without PWR_OPERATE_FACTORY.
 *  - Tier 2 (level 0): the four basic deposit commodities — RESOURCE_WIRE / RESOURCE_CELL
 *    / RESOURCE_ALLOY / RESOURCE_CONDENSATE — produced from the compressed deposit
 *    resources (silicon/biomass/metal/mist) plus a bar. These are the entry rung of the
 *    four deep production lines and are also valuable standalone deposit commodities.
 *  - Tier 3–5 (need a leveled factory, level 1..5): the deep multi-step chains. Each of
 *    the four lines (electronic → device, biological → organism, mechanical → machine,
 *    chemical/mist → essence) climbs one factory level per rung. The three cross-line
 *    "composite" commodities (composite/crystal/liquid) feed into the upper rungs.
 *
 * Deep chains consume lower-tier commodities as ingredients. The orchestrator's
 * dependency resolver walks a desired top commodity's recipe and, when an intermediate
 * commodity ingredient is missing, redirects production to the deepest buildable
 * intermediate first (the lab reaction-chain resolver pattern). So we only need to list
 * the TOP target of each line here — the resolver pulls in the rungs below it on demand.
 */

// How often (ticks) the orchestrator re-runs heavy recipe selection. Matches the
// throttling style of orchestrator.labs (LAB_PLAN_INTERVAL = 100); commodity demand
// changes slowly so an infrequent plan is plenty.
export const FACTORY_PLAN_INTERVAL = 50;

// Leave this much energy untouched in storage — never cannibalise the colony's energy
// reserve to make batteries.
export const FACTORY_MIN_RESERVE_ENERGY = 50_000;

// Don't keep an input topped up in the factory beyond this; keeps the 50k-cap factory
// store from clogging with one ingredient.
export const FACTORY_MAX_INPUT_LOAD = 6_000;

// Pull product out of the factory once it holds at least this much, so the store stays
// free for ingredients.
export const FACTORY_PRODUCT_EVICT_THRESHOLD = 1_000;

// Cap on how deep the dependency resolver will recurse when chasing missing
// intermediates. The longest real chain is 6 rungs (wire→…→device); a small cap keeps
// the per-tick resolve bounded and guarantees no runaway loop even if data is odd.
export const FACTORY_RESOLVE_MAX_DEPTH = 8;

// A produce target: the commodity, the stock we aim to keep (storage+terminal+factory),
// whether it needs a leveled factory, and a static value rank for profitability-aware
// selection. `requiresLevel` mirrors COMMODITIES[c].level but is stated explicitly so the
// gate is obvious at a glance. `value` is a deterministic, market-free ranking — higher =
// more valuable — used to prefer the best feasible commodity rather than always grinding
// the cheapest one.
export interface CommodityTarget {
  commodity: CommodityConstant;
  /** Keep producing until combined stock reaches this. */
  target: number;
  /** Minimum factory.level required (0 = any factory). */
  requiresLevel: number;
  /** Static value rank (higher = more valuable). Deep tiers rank above cheap fillers. */
  value: number;
}

// Targets the bot is willing to auto-produce. Order here is no longer the selection
// priority — selection is value-driven (see orchestrator.selectCommodity). We still keep
// cheap fallbacks (battery, bars) so a level-0 / starved factory always has something to
// do, but they carry low `value` so a feasible deep chain is always preferred.
export const COMMODITY_TARGETS: CommodityTarget[] = [
  // ── Tier 0: energy compaction (no level needed) ──────────────────────────────
  { commodity: RESOURCE_BATTERY, target: 10_000, requiresLevel: 0, value: 1 },

  // ── Tier 1: compressed base minerals (no level needed) ───────────────────────
  { commodity: RESOURCE_UTRIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_LEMERGIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_ZYNTHIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_KEANIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_OXIDANT, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_REDUCTANT, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_PURIFIER, target: 2_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_GHODIUM_MELT, target: 2_000, requiresLevel: 0, value: 2 },

  // ── Tier 2: basic deposit commodities (entry rung of each deep line) ──────────
  // Official COMMODITIES level is 0, but they need raw deposit resources to exist; we
  // value them above bars since they gate the whole line.
  { commodity: RESOURCE_WIRE, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_CELL, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_ALLOY, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_CONDENSATE, target: 2_000, requiresLevel: 0, value: 5 },

  // ── Cross-line composites (combine bars from multiple lines) ─────────────────
  { commodity: RESOURCE_COMPOSITE, target: 1_000, requiresLevel: 1, value: 8 },
  { commodity: RESOURCE_CRYSTAL, target: 500, requiresLevel: 2, value: 12 },
  { commodity: RESOURCE_LIQUID, target: 500, requiresLevel: 3, value: 16 },

  // ── Electronic line: wire → switch → transistor → microchip → circuit → device ─
  { commodity: RESOURCE_SWITCH, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_TRANSISTOR, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_MICROCHIP, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_CIRCUIT, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_DEVICE, target: 30, requiresLevel: 5, value: 110 },

  // ── Biological line: cell → phlegm → tissue → muscle → organoid → organism ────
  { commodity: RESOURCE_PHLEGM, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_TISSUE, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_MUSCLE, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_ORGANOID, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_ORGANISM, target: 30, requiresLevel: 5, value: 110 },

  // ── Mechanical line: alloy → tube → fixtures → frame → hydraulics → machine ───
  { commodity: RESOURCE_TUBE, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_FIXTURES, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_FRAME, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_HYDRAULICS, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_MACHINE, target: 30, requiresLevel: 5, value: 110 },

  // ── Chemical/mist line: condensate → concentrate → extract → spirit → emanation → essence ─
  { commodity: RESOURCE_CONCENTRATE, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_EXTRACT, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_SPIRIT, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_EMANATION, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_ESSENCE, target: 30, requiresLevel: 5, value: 110 },
];

// Lookup of every commodity we manage, for fast membership checks. Also used by the
// resolver: an ingredient that is itself a managed commodity is a producible
// intermediate (vs. a raw mineral/deposit we can only obtain by mining/market).
export const MANAGED_COMMODITIES: Set<string> = new Set(
  COMMODITY_TARGETS.map((t) => t.commodity)
);

// Fast value lookup (commodity → static value rank) for selection scoring.
export const COMMODITY_VALUE: Map<string, number> = new Map(
  COMMODITY_TARGETS.map((t) => [t.commodity, t.value])
);

// How much of each commodity to stage in the terminal for the market to sell from. The
// factory courier routes evicted product here (up to this much) instead of storage, so the
// terminal orchestrator has inventory to vend without a dedicated courier of its own.
export const COMMODITY_TERMINAL_STOCK = 2_000;

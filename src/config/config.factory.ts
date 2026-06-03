/**
 * Factory & commodity production config.
 *
 * The actual recipes (component minerals/commodities, output amount, cooldown and the
 * required factory level) live in the runtime `COMMODITIES` constant provided by the
 * game — we never re-hardcode those numbers. This file just decides WHICH commodities
 * the bot is willing to auto-produce, in what priority, and the stock target for each.
 *
 * Tiers covered:
 *  - Tier 0 (level 0, always allowed): RESOURCE_BATTERY — energy → battery, a cheap
 *    energy-compaction commodity that needs no leveled factory.
 *  - Tier 1 (level 0, always allowed): the compressed base minerals (the "*_bar" and
 *    oxidant/reductant/purifier/ghodium_melt commodities). These compress a mineral +
 *    energy into a bar; reversible and safe to make without PWR_OPERATE_FACTORY.
 *  - Tier 2 (needs a leveled factory): the four basic deposit commodities —
 *    RESOURCE_WIRE / RESOURCE_CELL / RESOURCE_ALLOY / RESOURCE_CONDENSATE — produced
 *    from the compressed deposit resources (silicon/biomass/metal/mist → bars). These
 *    carry COMMODITIES[...].level === 1, so the factory must have been leveled to 1 via
 *    PWR_OPERATE_FACTORY before we attempt them.
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

// A produce target: the commodity, the stock we aim to keep (storage+terminal+factory),
// and whether it needs a leveled factory. `requiresLevel` mirrors COMMODITIES[c].level
// but is stated explicitly so the gate is obvious at a glance.
export interface CommodityTarget {
  commodity: CommodityConstant;
  /** Keep producing until combined stock reaches this. */
  target: number;
  /** Minimum factory.level required (0 = any factory). */
  requiresLevel: number;
}

// Priority order: cheaper / always-available commodities first. The orchestrator walks
// this list and produces the first target that is under-stocked AND whose inputs are
// present AND whose level gate is satisfied.
export const COMMODITY_TARGETS: CommodityTarget[] = [
  // ── Tier 0: energy compaction (no level needed) ──────────────────────────────
  { commodity: RESOURCE_BATTERY, target: 10_000, requiresLevel: 0 },

  // ── Tier 1: compressed base minerals (no level needed) ───────────────────────
  { commodity: RESOURCE_UTRIUM_BAR, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_LEMERGIUM_BAR, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_ZYNTHIUM_BAR, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_KEANIUM_BAR, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_OXIDANT, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_REDUCTANT, target: 3_000, requiresLevel: 0 },
  { commodity: RESOURCE_PURIFIER, target: 2_000, requiresLevel: 0 },
  { commodity: RESOURCE_GHODIUM_MELT, target: 2_000, requiresLevel: 0 },

  // ── Tier 2: basic deposit commodities (need a leveled factory) ───────────────
  { commodity: RESOURCE_WIRE, target: 2_000, requiresLevel: 1 },
  { commodity: RESOURCE_CELL, target: 2_000, requiresLevel: 1 },
  { commodity: RESOURCE_ALLOY, target: 2_000, requiresLevel: 1 },
  { commodity: RESOURCE_CONDENSATE, target: 2_000, requiresLevel: 1 },
];

// Lookup of every commodity we manage, for fast membership checks.
export const MANAGED_COMMODITIES: Set<string> = new Set(
  COMMODITY_TARGETS.map((t) => t.commodity)
);

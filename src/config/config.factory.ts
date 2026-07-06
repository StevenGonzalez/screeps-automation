export const FACTORY_PLAN_INTERVAL = 50;

export const FACTORY_MIN_RESERVE_ENERGY = 50_000;

export const FACTORY_MAX_INPUT_LOAD = 6_000;

export const FACTORY_PRODUCT_EVICT_THRESHOLD = 1_000;

export const FACTORY_RESOLVE_MAX_DEPTH = 8;

export interface CommodityTarget {
  commodity: CommodityConstant;
  target: number;
  requiresLevel: number;
  value: number;
}

export const COMMODITY_TARGETS: CommodityTarget[] = [
  { commodity: RESOURCE_BATTERY, target: 10_000, requiresLevel: 0, value: 1 },

  { commodity: RESOURCE_UTRIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_LEMERGIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_ZYNTHIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_KEANIUM_BAR, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_OXIDANT, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_REDUCTANT, target: 3_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_PURIFIER, target: 2_000, requiresLevel: 0, value: 2 },
  { commodity: RESOURCE_GHODIUM_MELT, target: 2_000, requiresLevel: 0, value: 2 },

  { commodity: RESOURCE_WIRE, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_CELL, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_ALLOY, target: 2_000, requiresLevel: 0, value: 5 },
  { commodity: RESOURCE_CONDENSATE, target: 2_000, requiresLevel: 0, value: 5 },

  { commodity: RESOURCE_COMPOSITE, target: 1_000, requiresLevel: 1, value: 8 },
  { commodity: RESOURCE_CRYSTAL, target: 500, requiresLevel: 2, value: 12 },
  { commodity: RESOURCE_LIQUID, target: 500, requiresLevel: 3, value: 16 },

  { commodity: RESOURCE_SWITCH, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_TRANSISTOR, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_MICROCHIP, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_CIRCUIT, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_DEVICE, target: 30, requiresLevel: 5, value: 110 },

  { commodity: RESOURCE_PHLEGM, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_TISSUE, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_MUSCLE, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_ORGANOID, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_ORGANISM, target: 30, requiresLevel: 5, value: 110 },

  { commodity: RESOURCE_TUBE, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_FIXTURES, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_FRAME, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_HYDRAULICS, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_MACHINE, target: 30, requiresLevel: 5, value: 110 },

  { commodity: RESOURCE_CONCENTRATE, target: 600, requiresLevel: 1, value: 10 },
  { commodity: RESOURCE_EXTRACT, target: 300, requiresLevel: 2, value: 20 },
  { commodity: RESOURCE_SPIRIT, target: 150, requiresLevel: 3, value: 40 },
  { commodity: RESOURCE_EMANATION, target: 60, requiresLevel: 4, value: 70 },
  { commodity: RESOURCE_ESSENCE, target: 30, requiresLevel: 5, value: 110 },
];

export const MANAGED_COMMODITIES: Set<string> = new Set(
  COMMODITY_TARGETS.map((t) => t.commodity)
);

export const COMMODITY_VALUE: Map<string, number> = new Map(
  COMMODITY_TARGETS.map((t) => [t.commodity, t.value])
);

export const COMMODITY_TERMINAL_STOCK = 2_000;

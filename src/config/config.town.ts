// The castle's town quarter: watch posts behind the walls, a market square with
// a fountain, cottages for the townsfolk, and the townsfolk themselves. It grows
// a step with every RCL, so the kingdom visibly fills out as the castle rises.
export const TOWN = {
  // RCL 4: watch posts and the market square. Both cost almost nothing (a few
  // ramparts and one wall), so they only wait for the perimeter.
  watchRcl: 4,
  // From RCL 5: cottages, and the militia who sleep in them (nine beds a cottage).
  cottagesByRcl: { 5: 1, 6: 1, 7: 2, 8: 3 } as Record<number, number>,
  militiaByRcl: { 5: 2, 6: 4, 7: 8, 8: 12 } as Record<number, number>,
  // Stored energy a room needs before it adds a cottage or a townsperson; below
  // it the town keeps what it has and waits. Upgraders spend everything above
  // their 10k floor, so storage settles near it and a higher gate would never
  // open. The town is cheap: a militiaman is 200 energy a lifetime, a cottage
  // about 5k to raise and a few energy per hundred ticks to keep.
  storageGate: 10_000,
  // Lookouts stand in neighbouring rooms so the castle can see its approaches.
  lookoutRcl: 8,
  maxLookouts: 4,
  // Plan the town only once most of the perimeter stands, so its sites do not
  // compete with the ring for builders and the global site cap.
  perimeterBuiltRatio: 0.9,
  // Repair goal for every town wall and rampart. Enough to shrug off a stray
  // shot; the town is not a fortification, the perimeter is.
  barrierHits: 20_000,
  // A failed cottage search is retried this long after.
  retryInterval: 1500,
  // Watch posts per side of the perimeter that has exits.
  postsPerSide: 3,
  // Ring of parking tiles around the fountain, and the fallback tile count when
  // no 3x3 plaza fits.
  squareFallbackTiles: 6,
  // How far from storage the square may sit (Chebyshev).
  squareMinRange: 3,
  squareMaxRange: 10,
  // Cottages sit this far from the controller, sources and mineral so they never
  // take a harvesting or upgrading tile.
  cottageControllerClearance: 4,
  cottageResourceClearance: 3,
  // A cottage outside the ring is only allowed this close to the anchor, and
  // then the perimeter is re-planned around it.
  cottageMaxRange: 14,
};

// A day in the town lasts a thousand ticks. Dawn and day send the militia to the
// watch posts, dusk and night put them to bed.
export const TOWN_DAY_LENGTH = 1000;
export const TOWN_PHASES: ReadonlyArray<{ name: TownPhase; start: number }> = [
  { name: "dawn", start: 0 },
  { name: "day", start: 100 },
  { name: "dusk", start: 600 },
  { name: "night", start: 700 },
];

export type TownPhase = "dawn" | "day" | "dusk" | "night";

// Seven days to a season and four seasons to the year, the same for every castle.
export const TOWN_DAYS_PER_SEASON = 7;
// About one day in this many is a storm day, feast days and winter aside.
export const TOWN_STORM_ODDS = 5;
export type TownSeason = "spring" | "summer" | "autumn" | "winter";
export const TOWN_SEASONS: ReadonlyArray<TownSeason> = ["spring", "summer", "autumn", "winter"];
// The first day of each season is a feast day.
export const TOWN_FEASTS: Record<TownSeason, string> = {
  spring: "Sowing Feast",
  summer: "Midsummer Fair",
  autumn: "Harvest Home",
  winter: "Yule Feast",
};

// Families of the town. A cottage takes the name at its index.
export const COTTAGE_FAMILIES = [
  "Aldermere",
  "Blackwood",
  "Cotter",
  "Fairweather",
  "Holloway",
  "Marsh",
  "Thatcher",
  "Wren",
];

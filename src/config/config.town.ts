// The castle's town quarter: watch posts behind the walls, a market square with
// a fountain, cottages for the townsfolk, and the townsfolk themselves. It only
// grows once a room can pay for it, so every stage is gated on RCL and storage.
export const TOWN = {
  // RCL 6: watch posts and the market square. Both cost almost nothing (a few
  // ramparts and one wall), so they only wait for the perimeter.
  watchRcl: 6,
  // RCL 7 and 8: cottages and the militia who sleep in them.
  cottagesByRcl: { 7: 1, 8: 2 } as Record<number, number>,
  militiaByRcl: { 7: 4, 8: 8 } as Record<number, number>,
  // Stored energy a room needs before it builds a cottage or spawns townsfolk,
  // by RCL. Below it the town keeps what it has and waits.
  storageGateByRcl: { 7: 150_000, 8: 250_000 } as Record<number, number>,
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

// Families of the town, after the townsfolk of Lorencia. A cottage takes the
// name at its index.
export const COTTAGE_FAMILIES = [
  "Hanzo",
  "Pasi",
  "Lumen",
  "Martin",
  "Liaman",
  "Zienna",
  "Thompson",
  "Caren",
];

// Room and map visuals last only the tick they are drawn on, and the CPU guard
// in main sheds the visuals system on busy ticks: with the creeps using most of
// the limit it drew on about one tick in eight, so the HUD and the scenery
// flickered on and off. What it last drew is kept and laid down again on the
// ticks it is shed, which costs a string append rather than a redraw.

// Past this many ticks the drawing is too stale to show (a dragon frozen in
// the sky, the treasury of long ago), so the screen is left bare instead.
const REPLAY_MAX_AGE = 30;

interface KeptVisuals {
  at: number;
  rooms: Record<string, string>;
  map: string;
}

// Kept on the heap: a drawing lost to a global reset is redrawn soon enough.
let kept: KeptVisuals | undefined;

/** Runs `draw` and keeps what it added to each room's visuals and the map's. */
export function drawAndKeep(draw: () => void): void {
  // Export gives everything drawn so far this tick, and drawing only appends,
  // so what `draw` added is what follows the earlier export: path lines the
  // creeps drew are not kept.
  const before: Record<string, number> = {};
  for (const name in Game.rooms) before[name] = Game.rooms[name].visual.export()?.length ?? 0;
  const mapBefore = Game.map.visual.export()?.length ?? 0;
  draw();
  const rooms: Record<string, string> = {};
  for (const name in Game.rooms) {
    const added = Game.rooms[name].visual.export()?.slice(before[name] ?? 0);
    if (added) rooms[name] = added;
  }
  kept = { at: Game.time, rooms, map: Game.map.visual.export()?.slice(mapBefore) ?? "" };
}

/** Lays down again what drawAndKeep last kept, unless it is too old. */
export function replayKept(): void {
  if (!kept || Game.time - kept.at > REPLAY_MAX_AGE) return;
  for (const name in kept.rooms) Game.rooms[name]?.visual.import(kept.rooms[name]);
  if (kept.map) Game.map.visual.import(kept.map);
}

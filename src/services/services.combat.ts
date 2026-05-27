export interface ThreatInfo {
  hostiles: Creep[];
  score: number;
}

const threatCache: Record<string, { info: ThreatInfo; tick: number }> = {};

// Returns a threat score for the room: 0 = no hostiles.
// Score scales with hostile count, ATTACK/RANGED_ATTACK parts, and HEAL parts.
// Cached per-tick so multiple callers (spawner, tower) share one room.find.
export function getThreatInfo(room: Room): ThreatInfo {
  const cached = threatCache[room.name];
  if (cached && cached.tick === Game.time) return cached.info;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  let score = 0;
  for (const c of hostiles) {
    score += 10;
    for (const part of c.body) {
      if (part.type === ATTACK) score += 5;
      if (part.type === RANGED_ATTACK) score += 5;
      if (part.type === HEAL) score += 8;
    }
  }

  const info: ThreatInfo = { hostiles, score };
  threatCache[room.name] = { info, tick: Game.time };
  return info;
}

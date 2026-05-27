export interface ThreatInfo {
  hostiles: Creep[];
  score: number;
}

// Ticks a freshly spawned creep gets to reach a boost lab before giving up.
const BOOST_TIMEOUT = 50;

// Move a creep toward a lab holding its assigned boost compound.
// Returns true while still seeking (caller should return early).
// Returns false (and clears boostCompound) when timed out or no lab found.
export function seekBoost(creep: Creep): boolean {
  const compound = creep.memory.boostCompound as ResourceConstant | undefined;
  if (!compound) return false;

  // Creep starts at CREEP_LIFE_TIME (1500) and counts down.
  // If more than BOOST_TIMEOUT ticks have passed since spawn, give up.
  if ((creep.ticksToLive ?? 0) < 1500 - BOOST_TIMEOUT) {
    delete creep.memory.boostCompound;
    return false;
  }

  const ls = creep.room.memory.labSystem;
  if (!ls?.outputLabIds?.length) {
    delete creep.memory.boostCompound;
    return false;
  }

  const boostLab = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null)
    .find((l) => (l.store.getUsedCapacity(compound) ?? 0) >= 30);

  if (!boostLab) {
    delete creep.memory.boostCompound;
    return false;
  }

  if (!creep.pos.isNearTo(boostLab)) {
    creep.moveTo(boostLab, { reusePath: 5 });
  }
  return true;
}

export type ThreatSeverity = "none" | "low" | "medium" | "high";

// Thresholds derived from score formula: 10/creep + 5/ATTACK part + 5/RANGED_ATTACK part + 8/HEAL part
// low  (~1 weak creep), medium (~small unhealed squad), high (~healer-backed raid)
const SEVERITY_MEDIUM = 80;
const SEVERITY_HIGH   = 150;

export function getThreatSeverity(room: Room): ThreatSeverity {
  const { score } = getThreatInfo(room);
  if (score === 0) return "none";
  if (score < SEVERITY_MEDIUM) return "low";
  if (score < SEVERITY_HIGH) return "medium";
  return "high";
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

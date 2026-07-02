/**
 * Score Hunter (Season only). The Screeps Season server periodically drops "Score" objects
 * on random room tiles — moving any creep onto one automatically banks its point value, no
 * action needed. This object type (and its FIND_SCORES find-constant) does not exist on the
 * persistent World server at all, so every entry point below resolves the constant at
 * runtime and no-ops immediately when it's missing — the whole system is inert on World.
 *
 * Flow: each tick, scan every room currently in vision for Score objects and remember their
 * position/value/decay in Memory.scoreTargets (so a hunter can still path to one seen by a
 * scout/miner that has since moved on). role.scoreHunter claims the nearest unclaimed
 * remembered target and walks onto it; orchestrator.spawning raises a new (very cheap)
 * hunter whenever unclaimed targets outnumber hunters already chasing one.
 */

declare global {
  interface Memory {
    scoreTargets?: Record<string, ScoreTarget>;
  }
  // Season-only global constant (value 10031); absent on the World server. Declared here
  // purely so `typeof FIND_SCORES` type-checks — never reference it directly, only through
  // the typeof guard in getScoreFindConstant below. `typeof` on a name that resolves to
  // nothing (not a global-object property, not a lexical binding, nothing) is guaranteed by
  // the JS spec to evaluate to "undefined" rather than throw, so this check is safe
  // regardless of how the Screeps sandbox actually wires season constants into scope.
  const FIND_SCORES: number;
}

interface ScoreTarget {
  roomName: string;
  x: number;
  y: number;
  value: number;
  expiresAt: number; // Game.time this target is expected to have decayed
  claimedBy?: string; // creep name
}

// Minimal shape we actually use off the season-only Score object — kept local instead of
// augmenting global types, since FIND_SCORES/Score don't exist in @types/screeps at all.
type ScoreObject = {
  id: string;
  pos: RoomPosition;
  score: number;
  ticksToDecay: number;
};

function getScoreFindConstant(): number | undefined {
  return typeof FIND_SCORES !== "undefined" ? FIND_SCORES : undefined;
}

export function scoreHunterSupported(): boolean {
  return getScoreFindConstant() !== undefined;
}

export function loop(): void {
  const findConstant = getScoreFindConstant();
  if (findConstant === undefined) return; // Not on this server (e.g. World) — no-op.

  const targets = Memory.scoreTargets ?? (Memory.scoreTargets = {});

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    const scores = (room.find as (c: number) => ScoreObject[])(findConstant);
    const seenIds = new Set<string>();
    for (const s of scores) {
      seenIds.add(s.id);
      const existing = targets[s.id];
      targets[s.id] = {
        roomName,
        x: s.pos.x,
        y: s.pos.y,
        value: s.score,
        expiresAt: Game.time + s.ticksToDecay,
        claimedBy: existing?.claimedBy,
      };
    }
    // Anything we previously tracked in this (now visible) room that isn't there anymore
    // was collected or decayed — drop it so hunters don't chase a ghost.
    for (const id in targets) {
      if (targets[id].roomName === roomName && !seenIds.has(id)) delete targets[id];
    }
  }

  // Expire anything whose decay window passed while it was out of vision.
  for (const id in targets) {
    if (Game.time > targets[id].expiresAt) delete targets[id];
  }

  // Release claims held by hunters that died en route.
  for (const id in targets) {
    const claimant = targets[id].claimedBy;
    if (claimant && !Game.creeps[claimant]) targets[id].claimedBy = undefined;
  }
}

// ── Shared with orchestrator.spawning + role.scoreHunter ───────────────────────

export function getUnclaimedScoreTargetCount(): number {
  const targets = Memory.scoreTargets;
  if (!targets) return 0;
  let count = 0;
  for (const id in targets) if (!targets[id].claimedBy) count++;
  return count;
}

export function getScoreTarget(id: string): ScoreTarget | undefined {
  return Memory.scoreTargets?.[id];
}

// Claim the nearest unclaimed target for a hunter with no assignment. Returns its id
// (stored on the creep as memory.targetId) or undefined if nothing is unclaimed.
export function claimNearestScoreTarget(creep: Creep): string | undefined {
  const targets = Memory.scoreTargets;
  if (!targets) return undefined;

  let bestId: string | undefined;
  let bestDist = Infinity;
  for (const id in targets) {
    const t = targets[id];
    if (t.claimedBy) continue;
    const dist = Game.map.getRoomLinearDistance(creep.room.name, t.roomName);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  if (bestId) targets[bestId].claimedBy = creep.name;
  return bestId;
}

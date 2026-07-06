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
 *
 * Search (when nothing is claimed): a Score is only visible while a creep stands in its room
 * and decays fast, so discovery is really a COVERAGE problem — keep revisiting nearby rooms
 * so a fresh Score is seen (and thus reachable) before it decays. pickPatrolRoom hands out
 * disjoint patrol targets via a deterministic sequential assignment across the fleet (see its
 * comment), so seekers cover different rooms instead of trailing each other. Per-room
 * last-vision ticks live in Memory.scorePatrol.seen, stamped below for every room in vision.
 */

import { ROLE_SCORE_HUNTER } from "../config/config.roles";
import { isAlly } from "../services/services.allies";
import { isSourceKeeperRoom } from "../services/services.combat";

declare global {
  interface Memory {
    scoreTargets?: Record<string, ScoreTarget>;
    scorePatrol?: { seen: Record<string, number> };
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
  const patrol = Memory.scorePatrol ?? (Memory.scorePatrol = { seen: {} });

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    // Any room we can see this tick is "covered now" — this is the freshness signal the
    // coverage sweep in pickPatrolRoom minimizes across the region.
    patrol.seen[roomName] = Game.time;
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

  // Drop coverage records for rooms we've long since stopped patrolling so Memory.scorePatrol
  // can't grow unbounded as homes come and go. Any room still in a live region is re-stamped
  // above every time a seeker passes through, so this only ever prunes abandoned rooms.
  for (const rn in patrol.seen) {
    if (Game.time - patrol.seen[rn] > SEEN_TTL) delete patrol.seen[rn];
  }
}

// How long an unvisited room's coverage timestamp survives before it's pruned. Far longer than
// any realistic revisit interval, so a room in an active patrol beat is never dropped.
const SEEN_TTL = 50000;

// How far (in rooms) seekers range from home while covering. Kept short on purpose: a Score can
// decay in ~100 ticks and a seeker crosses ~1 room per 50 ticks, so a Score more than a room or
// two away has usually decayed before a seeker sent after it could arrive.
const PATROL_RADIUS = 2;

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

// Rough tile-distance estimate between a creep and a target room: each room is 50 tiles
// across and a Score can land anywhere in it, so linear_room_distance * 50 + 25 approximates
// travel time without running PathFinder across rooms for every candidate. A score hunter's
// body is a single MOVE with nothing else on it, so it generates zero fatigue on ANY terrain
// (fatigue comes from non-MOVE parts) — it always covers 1 tile/tick, making "tiles" and
// "ticks" the same number and this estimate directly usable as a travel-time bound.
function estimateTravelTicks(fromRoom: string, toRoom: string): number {
  if (fromRoom === toRoom) return 0;
  return Game.map.getRoomLinearDistance(fromRoom, toRoom) * 50 + 25;
}

// Safety margin over the raw estimate above: real paths bend around terrain/obstacles and
// the estimate is a straight-line approximation, not an actual PathFinder result.
const TRAVEL_SAFETY_MARGIN = 1.3;

// Claim the best unclaimed target for a hunter with no assignment: highest value per tick of
// travel among targets it can actually reach before they decay. Ignoring value would send
// hunters at whatever's nearest regardless of payoff (a 500-point target two rooms away
// beating an unclaimed 11,500-point target four rooms away); ignoring decay would let a
// hunter commit to a target it can never reach in time, locking out any hunter that could.
// Returns undefined (rather than the impossible-nearest target) when nothing is reachable —
// the caller keeps patrolling instead of chasing a target it'll never touch.
export function claimNearestScoreTarget(creep: Creep): string | undefined {
  const targets = Memory.scoreTargets;
  if (!targets) return undefined;

  let bestId: string | undefined;
  let bestRate = -Infinity;
  for (const id in targets) {
    const t = targets[id];
    if (t.claimedBy) continue;

    const travel = estimateTravelTicks(creep.room.name, t.roomName) * TRAVEL_SAFETY_MARGIN;
    const remaining = t.expiresAt - Game.time;
    if (travel >= remaining) continue; // can't get there before it decays
    if (travel >= (creep.ticksToLive ?? CREEP_LIFE_TIME)) continue; // we'd die en route

    const rate = t.value / Math.max(travel, 1);
    if (rate > bestRate) {
      bestRate = rate;
      bestId = id;
    }
  }
  if (bestId) targets[bestId].claimedBy = creep.name;
  return bestId;
}

// ── Coverage search (used by role.scoreHunter when nothing is claimed) ──────────
//
// A Score is only visible while a creep is in its room and decays fast, so the useful thing a
// seeker with no target can do is refresh vision on the nearby room that's gone stalest — that
// is where an as-yet-unseen Score is most likely waiting. To make the fleet cover DIFFERENT
// rooms instead of trailing each other, targets are handed out by a deterministic sequential
// assignment: every seeker independently replays the same allocation — in a fixed (name) order,
// each seeker claims its best still-unclaimed room — and reads off its own result. This makes the
// fleet's patrol targets disjoint BY CONSTRUCTION, even when several are stacked on the spawn
// (each replay reserves the earlier names' rooms first, so a co-located pair splits immediately
// rather than both chasing the same stalest room). "Best" is stalest minus travel FROM THAT
// seeker, so each tends to claim rooms near itself (compact beats) while earlier names win when
// they contend for the same room.
//
// (This coordinates DESTINATIONS, not paths — two seekers with beats on opposite sides of home
// still cross the same rooms in transit, so occasional co-location mid-journey is expected and
// harmless; what matters is that their patrol targets are disjoint.)
//
// Returns undefined only when the region has no safe room to visit (home boxed in by hostiles) —
// the caller parks off the spawn in that case.
export function pickPatrolRoom(creep: Creep): string | undefined {
  const home = creep.memory.homeRoom;
  if (!home) return undefined;
  const myName = Game.rooms[home]?.controller?.owner?.username;

  const region = safeRegionRooms(home, myName, PATROL_RADIUS);
  if (region.length === 0) return undefined;

  // The live fleet sharing this home, in a stable (name) order so every seeker replays the same
  // allocation sequence — no shared reservation state needed, each just recomputes it locally.
  const fleet: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === ROLE_SCORE_HUNTER && c.memory.homeRoom === home) fleet.push(c);
  }
  fleet.sort((a, b) => (a.name < b.name ? -1 : 1));

  const seen = Memory.scorePatrol?.seen ?? {};
  const reserved = new Set<string>();
  for (const c of fleet) {
    const pick = bestRoom(region, seen, c.pos.roomName, reserved);
    if (c.name === creep.name) {
      // Everyone after us can't change our result, so stop. If the region had fewer free rooms
      // than seekers we may have got nothing — fall back to the stalest room ignoring
      // reservations so we still move (this only overlaps when there are genuinely more seekers
      // than rooms, which no coordination can avoid).
      return pick ?? bestRoom(region, seen, creep.pos.roomName, new Set());
    }
    if (pick) reserved.add(pick);
  }
  return undefined; // unreachable: the creep is always a member of its own home's fleet
}

// Stalest region room reachable from `fromRoom`, skipping the room the seeker is already in and
// any a higher-priority seeker has reserved. Travel is charged at ~50 ticks/room so a near-stale
// room beats a far-stale one.
function bestRoom(
  region: string[],
  seen: Record<string, number>,
  fromRoom: string,
  reserved: Set<string>
): string | undefined {
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const room of region) {
    if (room === fromRoom || reserved.has(room)) continue;
    const staleness = Game.time - (seen[room] ?? 0); // never seen ⇒ effectively huge ⇒ top pick
    const s = staleness - Game.map.getRoomLinearDistance(fromRoom, room) * 50;
    if (s > bestScore) {
      bestScore = s;
      best = room;
    }
  }
  return best;
}

// Safe rooms an observer should sweep for Scores: same safe region as the seekers patrol, but
// out to `range` rooms rather than the patrol radius, since the observer isn't limited by a
// creep's walking speed. Bounded by seeker reachability though — a Score the observer reveals
// is only worth anything if a staging seeker can sprint there before it decays (the claim's
// decay/TTL guards drop the rest). Used by the observer orchestrator.
export function getScoreScanRooms(homeRoomName: string, range: number): string[] {
  const myName = Game.rooms[homeRoomName]?.controller?.owner?.username;
  return safeRegionRooms(homeRoomName, myName, range);
}

// Rooms within `range` of home that are safe for a 50-energy creep to enter, gathered by BFS
// over actual room connections (so we never target a room that doesn't border the walk).
// Hostile-OWNED, threatened, and SK rooms are excluded; our own rooms, allies', reserved,
// and otherwise quiet unowned rooms are still fair game.
function safeRegionRooms(home: string, myName: string | undefined, range: number): string[] {
  const result: string[] = [];
  const visited = new Set<string>([home]);
  let frontier = [home];
  for (let depth = 0; depth < range; depth++) {
    const next: string[] = [];
    for (const rn of frontier) {
      const exits = Game.map.describeExits(rn);
      for (const nb of Object.values(exits)) {
        if (!nb || visited.has(nb)) continue;
        visited.add(nb);
        // Hostile-owned, currently threatened, and SK rooms are walls: not a destination,
        // and not expanded through, so the region only ever contains rooms reachable via a
        // safe corridor.
        if (isHostileOwned(nb, myName) || isSourceKeeperRoom(nb) || isThreatenedRoom(nb)) continue;
        result.push(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return result;
}

function isThreatenedRoom(roomName: string): boolean {
  const intel = Memory.intel?.[roomName];
  if (!intel) return false;
  // Only avoid rooms known to contain combat-capable hostiles or a real standing threat.
  if ((intel.hostileCombatParts ?? 0) > 0) return true;
  return (intel.threatLevel ?? 0) > 0;
}

function isHostileOwned(roomName: string, myName: string | undefined): boolean {
  const owner = Memory.intel?.[roomName]?.owner;
  if (!owner) return false; // unowned or reserved-only — safe to walk
  if (owner === myName) return false; // our own room
  if (isAlly(owner)) return false; // ally's room
  return true;
}

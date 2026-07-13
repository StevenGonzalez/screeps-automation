import { ROLE_SCORE_HUNTER } from "../config/config.roles";
import { isAlly } from "../services/services.allies";
import { isSourceKeeperRoom } from "../services/services.combat";

declare global {
  interface Memory {
    scoreTargets?: Record<string, ScoreTarget>;
    scorePatrol?: { seen: Record<string, number> };
  }
  const FIND_SCORES: number;
}

interface ScoreTarget {
  roomName: string;
  x: number;
  y: number;
  value: number;
  expiresAt: number;
  claimedBy?: string;
}

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
  if (findConstant === undefined) return;

  const targets = Memory.scoreTargets ?? (Memory.scoreTargets = {});
  const patrol = Memory.scorePatrol ?? (Memory.scorePatrol = { seen: {} });

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
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
    for (const id in targets) {
      if (targets[id].roomName === roomName && !seenIds.has(id)) delete targets[id];
    }
  }

  for (const id in targets) {
    if (Game.time > targets[id].expiresAt) delete targets[id];
  }

  for (const id in targets) {
    const claimant = targets[id].claimedBy;
    if (claimant && !Game.creeps[claimant]) targets[id].claimedBy = undefined;
  }

  for (const rn in patrol.seen) {
    if (Game.time - patrol.seen[rn] > SEEN_TTL) delete patrol.seen[rn];
  }
}

const SEEN_TTL = 50000;

// No observer: hunters ARE the sensor grid, so they patrol a wide region to maximize fresh
// room-coverage per tick. (With an observer, hunters don't patrol at all — see pickPatrolRoom.)
export const SCORE_SCOUT_RADIUS = 4;

export function homeHasObserver(home: string): boolean {
  return !!Game.rooms[home]?.memory?.observerId;
}

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

// Score is collected simply by moving a creep onto its tile, so a score in the creep's current
// room is free points regardless of any remote target it has claimed. Returns the nearest one.
export function findNearestScoreInRoom(creep: Creep): RoomPosition | undefined {
  const findConstant = getScoreFindConstant();
  if (findConstant === undefined) return undefined;
  const scores = (creep.room.find as (c: number) => ScoreObject[])(findConstant);
  let best: ScoreObject | undefined;
  let bestRange = Infinity;
  for (const s of scores) {
    const range = creep.pos.getRangeTo(s.pos);
    if (range < bestRange) {
      bestRange = range;
      best = s;
    }
  }
  return best?.pos;
}

function estimateTravelTicks(fromRoom: string, toRoom: string): number {
  if (fromRoom === toRoom) return 0;
  return Game.map.getRoomLinearDistance(fromRoom, toRoom) * 50 + 25;
}

const TRAVEL_SAFETY_MARGIN = 1.3;

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
    if (travel >= remaining) continue;
    if (travel >= (creep.ticksToLive ?? CREEP_LIFE_TIME)) continue;

    const rate = t.value / Math.max(travel, 1);
    if (rate > bestRate) {
      bestRate = rate;
      bestId = id;
    }
  }
  if (bestId) targets[bestId].claimedBy = creep.name;
  return bestId;
}

export function pickPatrolRoom(creep: Creep): string | undefined {
  const home = creep.memory.homeRoom;
  if (!home) return undefined;
  // With an observer, discovery is the observer's job. Hunters become pure collectors: they idle
  // near home and dash to whatever the observer finds, so there's no patrol to assign.
  if (homeHasObserver(home)) return undefined;
  const myName = Game.rooms[home]?.controller?.owner?.username;

  const region = safeRegionRooms(home, myName, SCORE_SCOUT_RADIUS);
  if (region.length === 0) return undefined;

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
      return pick ?? bestRoom(region, seen, creep.pos.roomName, new Set());
    }
    if (pick) reserved.add(pick);
  }
  return undefined;
}

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
    const staleness = Game.time - (seen[room] ?? 0);
    const s = staleness - Game.map.getRoomLinearDistance(fromRoom, room) * 50;
    if (s > bestScore) {
      bestScore = s;
      best = room;
    }
  }
  return best;
}

export function getScoreScanRooms(homeRoomName: string, range: number): string[] {
  const myName = Game.rooms[homeRoomName]?.controller?.owner?.username;
  return safeRegionRooms(homeRoomName, myName, range);
}

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
        if (isHostileOwned(nb, myName) || isSourceKeeperRoom(nb) || isDeathTrapRoom(nb)) continue;
        result.push(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return result;
}

// A hotly contested season means score sits in rooms with hostiles; a naked hunter moves every tick
// and can dash in for a touch, so we no longer concede a room over any single hostile. We only avoid
// rooms with a genuine war-party, where an unescorted hunter is just a donation (escorts come later).
const SCORE_THREAT_TOLERANCE = 12;

function isDeathTrapRoom(roomName: string): boolean {
  const intel = Memory.intel?.[roomName];
  if (!intel) return false;
  return (intel.hostileCombatParts ?? 0) >= SCORE_THREAT_TOLERANCE;
}

function isHostileOwned(roomName: string, myName: string | undefined): boolean {
  const owner = Memory.intel?.[roomName]?.owner;
  if (!owner) return false;
  if (owner === myName) return false;
  if (isAlly(owner)) return false;
  return true;
}

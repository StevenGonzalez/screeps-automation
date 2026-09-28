import { getThreatInfo, isSourceKeeperRoom } from "../services/services.combat";
import { isAlly } from "../services/services.allies";
import { TOWN_DAY_LENGTH, TOWN_PHASES } from "../config/config.town";
import {
  bedTiles,
  isNightfall,
  parkIdle,
  parkOn,
  parseTile,
  townClock,
} from "../services/services.town";

// The townsfolk of the castle's quarter. They carry one bow and one pair of
// boots each, so no single one of them matters much, but together they are
// the castle's second line:
//
//   militia  sleep in the cottages at night and stand the watch posts by day.
//            When raiders come, every militiaman runs for the rampart nearest
//            the fight and looses arrows from under it; with no rampart free
//            they bar themselves in their beds.
//   lookout  stands a few tiles inside a neighbouring room so the castle sees
//            its approaches, and runs home when anything armed comes near.

const BOW_RANGE = 3;
// How close an armed hostile may come before a lookout abandons its post, and
// how long it stays home after.
const LOOKOUT_DANGER_RANGE = 6;
const LOOKOUT_RETREAT_TICKS = 300;
// How far inside the neighbouring room a lookout stands.
const LOOKOUT_DEPTH = 3;

const PHASE_CALLS: Record<string, string[]> = {
  dawn: ["cock-a-doo!", "morning!", "to the watch"],
  day: ["all's well", "quiet day", "eyes open"],
  dusk: ["lamps lit", "home time", "supper!"],
  night: ["zzz", "g'night", "bar the door"],
};

export function runTownsfolk(creep: Creep): void {
  if (creep.memory.job === "lookout") runLookout(creep);
  else runMilitia(creep);
}

function armed(c: Creep): boolean {
  return c.body.some(
    (p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
  );
}

function runMilitia(creep: Creep): void {
  const home = creep.memory.homeRoom ?? creep.room.name;
  if (creep.room.name !== home) {
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    return;
  }
  const room = creep.room;
  const hostiles = getThreatInfo(room).hostiles;

  // Whatever else it is doing, a militiaman shoots the weakest raider in reach.
  const inReach = hostiles.filter((h) => creep.pos.inRangeTo(h, BOW_RANGE));
  if (inReach.length > 0) {
    creep.rangedAttack(inReach.reduce((a, b) => (a.hits < b.hits ? a : b)));
  }

  const safeMode = (room.controller?.safeMode ?? 0) > 0;
  if (hostiles.length > 0 && !safeMode) {
    if (!creep.memory.working) {
      // Drop the bed or post held so far and pick the rampart nearest the fight.
      creep.memory.working = true;
      delete creep.memory.townSpot;
      creep.say("To arms!", true);
    }
    const nearest = creep.pos.findClosestByRange(hostiles);
    if (nearest && parkOn(creep, wallStations(room, creep), nearest.pos)) return;
    parkOn(creep, bedTiles(room.memory.town));
    return;
  }
  creep.memory.working = false;

  const clock = townClock(Game.time);
  callThePhase(creep);
  if (isNightfall(clock.phase)) {
    if (parkOn(creep, bedTiles(room.memory.town))) return;
    parkIdle(creep, "square");
    return;
  }
  if (parkIdle(creep, "watch")) return;
  parkOn(creep, bedTiles(room.memory.town));
}

// On the first tick of each part of the day the whole town says so at once.
function callThePhase(creep: Creep): void {
  const t = Game.time % TOWN_DAY_LENGTH;
  const phase = TOWN_PHASES.find((p) => p.start === t);
  if (!phase) return;
  const lines = PHASE_CALLS[phase.name];
  let hash = 0;
  for (let i = 0; i < creep.name.length; i++) hash = (hash + creep.name.charCodeAt(i)) | 0;
  creep.say(lines[Math.abs(hash) % lines.length], true);
}

/**
 * Ramparts a militiaman can fight from: built perimeter ramparts and watch
 * posts nobody else is standing on.
 */
function wallStations(room: Room, self: Creep): string[] {
  const ring = new Set(room.memory.perimeterTiles ?? []);
  for (const p of room.memory.town?.posts ?? []) ring.add(p);
  const standing = new Set<string>();
  for (const c of room.find(FIND_MY_CREEPS)) {
    if (c.name !== self.name) standing.add(`${c.pos.x},${c.pos.y}`);
  }
  const out: string[] = [];
  for (const s of room.find(FIND_MY_STRUCTURES)) {
    if (s.structureType !== STRUCTURE_RAMPART) continue;
    const k = `${s.pos.x},${s.pos.y}`;
    if (ring.has(k) && !standing.has(k)) out.push(k);
  }
  return out;
}

function runLookout(creep: Creep): void {
  const home = creep.memory.homeRoom ?? creep.room.name;
  const target = creep.memory.targetRoom;

  if (!target || (creep.memory.retreatUntil !== undefined && Game.time < creep.memory.retreatUntil)) {
    if (creep.room.name !== home) {
      creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
    } else {
      parkIdle(creep, "square");
    }
    return;
  }

  if (creep.room.name === target) {
    // A room someone else has claimed since the lookout set out has towers to
    // fear, not just creeps.
    const owner = creep.room.controller?.owner?.username;
    const claimed = !!owner && !creep.room.controller?.my && !isAlly(owner);
    const danger =
      claimed ||
      creep.room
        .find(FIND_HOSTILE_CREEPS)
        .some(
          (h) => !isAlly(h.owner?.username) && armed(h) && creep.pos.inRangeTo(h, LOOKOUT_DANGER_RANGE)
        );
    if (danger) {
      creep.memory.retreatUntil = Game.time + LOOKOUT_RETREAT_TICKS;
      creep.say("Raiders!", true);
      creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 5 });
      return;
    }
  }

  const post = lookoutPost(creep, home, target);
  if (!post) {
    if (creep.room.name !== target) creep.moveTo(new RoomPosition(25, 25, target), { reusePath: 20 });
    return;
  }
  if (!creep.pos.isEqualTo(post)) creep.moveTo(post, { reusePath: 50 });
}

/**
 * A tile a few steps inside `target` from the exit it shares with `home`,
 * computed from terrain once and kept in memory.
 */
export function lookoutPost(creep: Creep, home: string, target: string): RoomPosition | null {
  const cached = creep.memory.lookoutPos;
  if (cached) {
    const { x, y } = parseTile(cached);
    return new RoomPosition(x, y, target);
  }
  const exits = Game.map.describeExits(target);
  if (!exits) return null;
  let side: string | undefined;
  for (const dir in exits) {
    if ((exits as Record<string, string>)[dir] === home) side = dir;
  }
  if (!side) return null;
  const terrain = Game.map.getRoomTerrain(target);
  // Exit tiles on the shared edge, and the step that leads away from it.
  const edge: Array<[number, number]> = [];
  let inward: [number, number] = [0, 0];
  for (let i = 1; i < 49; i++) {
    let x = i;
    let y = i;
    if (side === String(TOP)) { y = 0; inward = [0, 1]; }
    else if (side === String(BOTTOM)) { y = 49; inward = [0, -1]; }
    else if (side === String(LEFT)) { x = 0; inward = [1, 0]; }
    else { x = 49; inward = [-1, 0]; }
    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) edge.push([x, y]);
  }
  if (edge.length === 0) return null;
  const mid = edge[Math.floor(edge.length / 2)];
  const gx = mid[0] + inward[0] * LOOKOUT_DEPTH;
  const gy = mid[1] + inward[1] * LOOKOUT_DEPTH;
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 2 || y < 2 || x > 47 || y > 47) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        creep.memory.lookoutPos = `${x},${y}`;
        return new RoomPosition(x, y, target);
      }
    }
  }
  return null;
}

/**
 * Neighbouring rooms worth a lookout: not ours, not someone else's, not a
 * source keeper room, and not a remote we already see through our own workers.
 */
export function lookoutTargets(room: Room, workedRemotes: Set<string>): string[] {
  const exits = Game.map.describeExits(room.name);
  if (!exits) return [];
  const me = room.controller?.owner?.username;
  const out: string[] = [];
  for (const dir in exits) {
    const name = (exits as Record<string, string>)[dir];
    if (!name || workedRemotes.has(name) || isSourceKeeperRoom(name)) continue;
    if (Game.rooms[name]?.controller?.my) continue;
    const intel = Memory.intel?.[name];
    if (intel?.owner && intel.owner !== me) continue;
    if (intel?.reservedBy && intel.reservedBy !== me) continue;
    out.push(name);
  }
  return out;
}

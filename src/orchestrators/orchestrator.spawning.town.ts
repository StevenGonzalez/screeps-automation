import { ROLE_MINSTREL, ROLE_TOWNSFOLK } from "../config/config.roles";
import { TOWN } from "../config/config.town";
import { castleName, chronicle } from "../services/services.chronicle";
import { isEnergyEmergency } from "../services/services.creep";
import { bedTiles, isNightfall, townClock, townFeast } from "../services/services.town";
import { lookoutTargets } from "../roles/role.townsfolk";
import { trackedSpawn } from "./orchestrator.spawning.shared";
import { getPickedRemoteRoomNames } from "./orchestrator.spawning.remote";

// Townsfolk are the last thing a room spawns, and only a room with energy to
// spare spawns them at all: a militiaman costs 200 and a lookout 50, every
// 1500 ticks. A minstrel costs 50 a feast day.
const MILITIA_BODY: BodyPartConstant[] = [RANGED_ATTACK, MOVE];
const LOOKOUT_BODY: BodyPartConstant[] = [MOVE];
const MINSTREL_BODY: BodyPartConstant[] = [MOVE];

export type TownJob = { job: "militia" } | { job: "lookout"; targetRoom: string };

function townsfolkOf(room: Room): CreepMemory[] {
  const out: CreepMemory[] = [];
  for (const name in Game.creeps) {
    const mem = Game.creeps[name].memory;
    if (mem.role === ROLE_TOWNSFOLK && mem.homeRoom === room.name) out.push(mem);
  }
  return out;
}

function builtBeds(room: Room): number {
  const beds = new Set(bedTiles(room.memory.town));
  if (beds.size === 0) return 0;
  let n = 0;
  for (const s of room.find(FIND_MY_STRUCTURES)) {
    if (s.structureType === STRUCTURE_RAMPART && beds.has(`${s.pos.x},${s.pos.y}`)) n++;
  }
  return n;
}

// Whether the town has gold to spare for new people at all.
function townCanGrow(room: Room): boolean {
  if (!room.memory.town) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < TOWN.storageGate) return false;
  return Memory.empire?.posture !== "RECOVER" && !isEnergyEmergency(room);
}

/** The next townsperson the room should raise, or null. */
export function nextTownJob(room: Room): TownJob | null {
  const rcl = room.controller?.level ?? 0;
  if (!townCanGrow(room)) return null;

  const folk = townsfolkOf(room);
  const militia = folk.filter((m) => m.job !== "lookout").length;
  // One militiaman to a bed, and only beds that are built.
  const wantMilitia = Math.min(TOWN.militiaByRcl[rcl] ?? 0, builtBeds(room));
  if (militia < wantMilitia) return { job: "militia" };

  if (rcl < TOWN.lookoutRcl) return null;
  const posted = new Set(folk.filter((m) => m.job === "lookout").map((m) => m.targetRoom));
  if (posted.size >= TOWN.maxLookouts) return null;
  const open = lookoutTargets(room, getPickedRemoteRoomNames(room)).find((r) => !posted.has(r));
  return open ? { job: "lookout", targetRoom: open } : null;
}

/**
 * Whether a minstrel should come to the room's square: on a feast day, by
 * daylight, to a castle whose square is laid out and has none singing yet.
 */
export function wantsMinstrel(room: Room): boolean {
  if (!room.memory.town?.fountain || !townFeast(Game.time)) return false;
  if (isNightfall(townClock(Game.time).phase) || !townCanGrow(room)) return false;
  for (const name in Game.creeps) {
    const mem = Game.creeps[name].memory;
    if (mem.role === ROLE_MINSTREL && mem.homeRoom === room.name) return false;
  }
  return true;
}

function spawnMinstrel(room: Room, spawn: StructureSpawn): boolean {
  const memory: CreepMemory = { role: ROLE_MINSTREL, homeRoom: room.name };
  if (trackedSpawn(room, spawn, MINSTREL_BODY, { memory }) !== OK) return false;
  chronicle(`A minstrel comes to ${castleName(room.name)} Square for the ${townFeast(Game.time)}.`);
  return true;
}

export function spawnTownsfolk(room: Room, spawn: StructureSpawn): boolean {
  const next = nextTownJob(room);
  if (!next) return wantsMinstrel(room) && spawnMinstrel(room, spawn);
  const body = next.job === "militia" ? MILITIA_BODY : LOOKOUT_BODY;
  const memory: CreepMemory = {
    role: ROLE_TOWNSFOLK,
    job: next.job,
    homeRoom: room.name,
    ...(next.job === "lookout" ? { targetRoom: next.targetRoom } : {}),
  };
  return trackedSpawn(room, spawn, body, { memory }) === OK;
}

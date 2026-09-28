import { ROLE_TOWNSFOLK } from "../config/config.roles";
import { TOWN } from "../config/config.town";
import { isEnergyEmergency } from "../services/services.creep";
import { bedTiles } from "../services/services.town";
import { lookoutTargets } from "../roles/role.townsfolk";
import { trackedSpawn } from "./orchestrator.spawning.shared";
import { getPickedRemoteRoomNames } from "./orchestrator.spawning.remote";

// Townsfolk are the last thing a room spawns, and only a room with energy to
// spare spawns them at all: a militiaman costs 200 and a lookout 50, every
// 1500 ticks.
const MILITIA_BODY: BodyPartConstant[] = [RANGED_ATTACK, MOVE];
const LOOKOUT_BODY: BodyPartConstant[] = [MOVE];

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

/** The next townsperson the room should raise, or null. */
export function nextTownJob(room: Room): TownJob | null {
  const rcl = room.controller?.level ?? 0;
  const gate = TOWN.storageGateByRcl[rcl];
  if (gate === undefined || !room.memory.town) return null;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < gate) return null;
  if (Memory.empire?.posture === "RECOVER" || isEnergyEmergency(room)) return null;

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

export function spawnTownsfolk(room: Room, spawn: StructureSpawn): boolean {
  const next = nextTownJob(room);
  if (!next) return false;
  const body = next.job === "militia" ? MILITIA_BODY : LOOKOUT_BODY;
  const memory: CreepMemory = {
    role: ROLE_TOWNSFOLK,
    job: next.job,
    homeRoom: room.name,
    ...(next.job === "lookout" ? { targetRoom: next.targetRoom } : {}),
  };
  return trackedSpawn(room, spawn, body, `${ROLE_TOWNSFOLK}${Game.time}`, { memory }) === OK;
}

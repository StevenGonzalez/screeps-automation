/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

/**
 * Miner: static harvester designed to sit on a container by a source and mine continuously.
 * - Assigns a source with an available adjacent container tile.
 * - Moves once to the container tile and stays there.
 * - Harvests until death; does not withdraw/transfer.
 */
export function runMiner(creep: Creep): void {
  // Assign source if needed, ensuring unique assignments via room memory
  if (!creep.memory.sourceId) {
    tryAssignUniqueSource(creep);
  } else {
    const mem = getMiningMemory(creep.room.name);
    // Clean up stale locks
    for (const sid in mem.assignments) {
      const name = mem.assignments[sid];
      if (!Game.creeps[name]) delete mem.assignments[sid];
    }
    if (mem.assignments[creep.memory.sourceId] !== creep.name) {
      tryAssignUniqueSource(creep);
    }
  }

  const source = creep.memory.sourceId
    ? Game.getObjectById<Source>(creep.memory.sourceId as Id<Source>)
    : null;
  if (!source) return;

  // Target spot: a container next to the source (or its construction site); otherwise the best open tile
  let targetPos: RoomPosition | null = findContainerSpotNear(source.pos);
  if (!targetPos) {
    // fallback to any walkable adjacent tile
    targetPos = findOpenAdjacent(source.pos);
  }
  if (!targetPos) return;

  if (!creep.pos.isEqualTo(targetPos)) {
    creep.moveTo(targetPos, { visualizePathStyle: { stroke: "#ffaa00" } });
    CreepPersonality.speak(creep, "move");
    return;
  }

  const res = creep.harvest(source);
  if (res === OK) {
    CreepPersonality.speak(creep, "harvest");
  } else if (res === ERR_NOT_ENOUGH_RESOURCES) {
    // Idle but stay put
    CreepPersonality.speak(creep, "idle");
  }
}

function tryAssignUniqueSource(creep: Creep): void {
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  const mem = getMiningMemory(room.name);
  // Clean up stale
  for (const sid in mem.assignments) {
    const name = mem.assignments[sid];
    if (!Game.creeps[name]) delete mem.assignments[sid];
  }

  // Prefer eligible, unassigned sources
  for (const s of sources) {
    const eligible = hasContainerNear(s.pos) || hasContainerSiteNear(s.pos);
    if (!eligible) continue;
    if (!mem.assignments[s.id]) {
      mem.assignments[s.id] = creep.name;
      creep.memory.sourceId = s.id;
      return;
    }
  }
  // Fallback to any unassigned source
  for (const s of sources) {
    if (!mem.assignments[s.id]) {
      mem.assignments[s.id] = creep.name;
      creep.memory.sourceId = s.id;
      return;
    }
  }
  // Last resort: pick the least-contested source
  let best: Source | null = null;
  let bestCount = Infinity;
  for (const s of sources) {
    const count = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.role === "miner" && c.memory.sourceId === s.id,
    }).length;
    if (count < bestCount) {
      best = s;
      bestCount = count;
    }
  }
  if (best) {
    mem.assignments[best.id] = creep.name;
    creep.memory.sourceId = best.id;
  }
}

function getMiningMemory(roomName: string): {
  assignments: { [sourceId: string]: string };
} {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[roomName]) (Memory.rooms as any)[roomName] = {};
  const r = (Memory.rooms as any)[roomName];
  if (!r.mining) r.mining = {};
  if (!r.mining.assignments) r.mining.assignments = {};
  return r.mining as { assignments: { [sourceId: string]: string } };
}

function hasContainerNear(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  const found = room
    ?.lookForAtArea(
      LOOK_STRUCTURES,
      pos.y - 1,
      pos.x - 1,
      pos.y + 1,
      pos.x + 1,
      true
    )
    .some((i) => i.structure.structureType === STRUCTURE_CONTAINER);
  return !!found;
}

function hasContainerSiteNear(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  const found = room
    ?.lookForAtArea(
      LOOK_CONSTRUCTION_SITES,
      pos.y - 1,
      pos.x - 1,
      pos.y + 1,
      pos.x + 1,
      true
    )
    .some((i) => i.constructionSite.structureType === STRUCTURE_CONTAINER);
  return !!found;
}

function findContainerSpotNear(pos: RoomPosition): RoomPosition | null {
  // Prefer actual container tiles first
  const structs = pos
    .findInRange(FIND_STRUCTURES, 1)
    .filter((s) => s.structureType === STRUCTURE_CONTAINER);
  if (structs.length > 0) return structs[0].pos;
  // Next, any construction site for container
  const sites = pos
    .findInRange(FIND_CONSTRUCTION_SITES, 1)
    .filter((s) => s.structureType === STRUCTURE_CONTAINER);
  if (sites.length > 0) return sites[0].pos;
  return null;
}

function findOpenAdjacent(pos: RoomPosition): RoomPosition | null {
  const room = Game.rooms[pos.roomName];
  if (!room) return null;
  const terrain = room.getTerrain();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const tile = new RoomPosition(x, y, pos.roomName);
      // Avoid non-road structures occupying the tile
      const blocking = tile
        .lookFor(LOOK_STRUCTURES)
        .some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_RAMPART
        );
      if (!blocking) return tile;
    }
  }
  return null;
}

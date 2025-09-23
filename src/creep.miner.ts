/// <reference types="@types/screeps" />
import { CreepPersonality } from "./creep.personality";

/**
 * Miner: static harvester designed to sit on a container by a source and mine continuously.
 * - Assigns a source with an available adjacent container tile.
 * - Moves once to the container tile and stays there.
 * - Harvests until death; does not withdraw/transfer.
 */
export function runMiner(creep: Creep): void {
  // Assign source if needed
  if (!creep.memory.sourceId) {
    const sources = creep.room.find(FIND_SOURCES);
    // Prefer sources with a nearby container or construction site for one
    const choose =
      sources.find(
        (s) => hasContainerNear(s.pos) || hasContainerSiteNear(s.pos)
      ) || sources[0];
    if (choose) creep.memory.sourceId = choose.id;
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

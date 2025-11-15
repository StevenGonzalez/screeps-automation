/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";
import { hasContainerNear, hasContainerSiteNear } from "../utils/structure.utils";

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
    // If we've issued a handoff, don't re-lock; keep working without owning the lock
    const handoff = (creep.memory as any).handoff === true;
    if (!handoff && mem.assignments[creep.memory.sourceId] !== creep.name) {
      tryAssignUniqueSource(creep);
    }
  }

  const source = creep.memory.sourceId
    ? Game.getObjectById<Source>(creep.memory.sourceId as Id<Source>)
    : null;
  if (!source) return;

  // Target seat: per-source reserved tile (container/site preferred), cached in room memory
  let targetPos: RoomPosition | null = getSeatForSource(creep.room, source);
  if (!targetPos) return;

  // Near-death handoff: release the lock early so the next miner can claim this source
  const ttl = creep.ticksToLive ?? 1500;
  if (ttl <= 50 && !(creep.memory as any).handoff) {
    const miningMem = getMiningMemory(creep.room.name);
    if (
      creep.memory.sourceId &&
      miningMem.assignments[creep.memory.sourceId] === creep.name
    ) {
      delete miningMem.assignments[creep.memory.sourceId];
    }
    (creep.memory as any).handoff = true;
  }

  if (!creep.pos.isEqualTo(targetPos)) {
    creep.moveTo(targetPos, { ...visualPath("harvest") });
    CreepPersonality.speak(creep, "move");
    return;
  }

  const res = creep.harvest(source);
  if (res === OK) {
    CreepPersonality.speak(creep, "harvest");
    // Opportunistic: if there's a link adjacent and the adjacent container is near full, feed the link
    tryFeedAdjacentLink(creep, source);
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
  seats?: { [sourceId: string]: { x: number; y: number } };
} {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[roomName]) (Memory.rooms as any)[roomName] = {};
  const r = (Memory.rooms as any)[roomName];
  if (!r.mining) r.mining = {};
  if (!r.mining.assignments) r.mining.assignments = {};
  if (!r.mining.seats) r.mining.seats = {};
  return r.mining as {
    assignments: { [sourceId: string]: string };
    seats: { [sourceId: string]: { x: number; y: number } };
  };
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

function getSeatForSource(room: Room, source: Source): RoomPosition | null {
  const mem = getMiningMemory(room.name);
  if (!mem.seats) (mem as any).seats = {} as any;
  const seatMap = mem.seats as { [id: string]: { x: number; y: number } };
  const seat = seatMap[source.id];
  if (seat && seat.x !== undefined && seat.y !== undefined) {
    return new RoomPosition(seat.x, seat.y, room.name);
  }
  // Determine and store a new seat
  let pos = findContainerSpotNear(source.pos);
  if (!pos) pos = findOpenAdjacent(source.pos);
  if (pos) {
    seatMap[source.id] = { x: pos.x, y: pos.y } as any;
    return pos;
  }
  return null;
}

/**
 * If miner is seated by the source and there is a container and a link adjacent,
 * and the container is nearly full, move some energy from the container into the link.
 * This keeps source containers from clogging and kickstarts the link network.
 */
function tryFeedAdjacentLink(creep: Creep, source: Source): void {
  // Only attempt every few ticks to reduce CPU
  if (Game.time % 5 !== 0) return;
  // Require the ability to carry energy; otherwise skip
  if (!creep.getActiveBodyparts(CARRY)) return;
  // Must be on our reserved seat near the source
  if (!creep.memory.sourceId || creep.memory.sourceId !== source.id) return;
  // Look for adjacent container and link
  const structs = creep.pos.findInRange(FIND_STRUCTURES, 1) as AnyStructure[];
  const container = structs.find(
    (s) => s.structureType === STRUCTURE_CONTAINER
  ) as StructureContainer | undefined;
  const link = structs.find((s) => s.structureType === STRUCTURE_LINK) as
    | StructureLink
    | undefined;
  if (!container || !link) return;

  const containerEnergy = container.store.getUsedCapacity(RESOURCE_ENERGY);
  // Thresholds: if container is getting full and link has room, transfer some energy
  if (
    containerEnergy >= 1500 &&
    link.store.getFreeCapacity(RESOURCE_ENERGY) >= 100 &&
    !link.cooldown
  ) {
    // Withdraw from container then transfer to link
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      const w = creep.withdraw(container, RESOURCE_ENERGY);
      if (w === ERR_NOT_IN_RANGE) {
        // Shouldn't happen if seated, but just in case
        creep.moveTo(container);
        return;
      }
    }
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      creep.transfer(link, RESOURCE_ENERGY);
    }
  }
}

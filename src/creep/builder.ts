/// <reference types="@types/screeps" />
import { visualPath } from "../path.styles";
import { CreepPersonality } from "./personality";
import { RoomCache } from "../room/cache";

export function runBuilder(
  creep: Creep,
  constructionPlan: any,
  intel: any
): void {
  // Toggle with hysteresis to prevent flip-flopping
  // Switch to gathering only when completely empty
  if (
    creep.memory.working &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
  )
    creep.memory.working = false;
  // Switch to working when at least 50% full to prevent loops
  // This prevents builders from turning around for small amounts of energy
  if (
    !creep.memory.working &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) * 0.5
  )
    creep.memory.working = true;

  if (creep.memory.working) {
    // From plan
    if (constructionPlan?.recommendations?.immediate?.length) {
      const siteId = constructionPlan.recommendations.immediate[0];
      const target = Game.getObjectById<ConstructionSite>(
        siteId as Id<ConstructionSite>
      );
      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { ...visualPath("build") });
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "build");
        }
        return;
      }
    }

    // Prioritize construction sites by importance:
    // 1. Spawns, extensions, towers (critical structures)
    // 2. Storage, terminal (important economy)
    // 3. Containers (nice to have for economy)
    // 4. Links, labs (optimization)
    // 5. Roads (low priority - can wait)
    let sites = RoomCache.constructionSites(creep.room);

    // Priority 1: Critical structures
    let target = creep.pos.findClosestByPath(
      sites.filter(
        (s: ConstructionSite) =>
          s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_TOWER
      )
    );

    // Priority 2: Important economy structures
    if (!target) {
      target = creep.pos.findClosestByPath(
        sites.filter(
          (s: ConstructionSite) =>
            s.structureType === STRUCTURE_STORAGE ||
            s.structureType === STRUCTURE_TERMINAL
        )
      );
    }

    // Priority 3: Containers
    if (!target) {
      target = creep.pos.findClosestByPath(
        sites.filter(
          (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
        )
      );
    }

    // Priority 4: Labs and links
    if (!target) {
      target = creep.pos.findClosestByPath(
        sites.filter(
          (s: ConstructionSite) =>
            s.structureType === STRUCTURE_LAB ||
            s.structureType === STRUCTURE_LINK
        )
      );
    }

    // Priority 5: Everything else (including roads)
    if (!target) {
      target = creep.pos.findClosestByPath(sites);
    }
    // If no path to any site, try to clean up unreachable sites (e.g., trapped in wall pockets)
    if (!target && sites.length > 0) {
      for (const s of sites) {
        if (!hasAccessibleAdjacent(s.pos)) {
          // Remove once; it's our site so it's safe to clean up
          s.remove();
          // Optional: could log, but avoid spamming logs
        }
      }
      // Recompute after cleanup
      sites = RoomCache.constructionSites(creep.room);
      target =
        creep.pos.findClosestByPath(sites) ||
        creep.pos.findClosestByRange(sites);
    }
    if (target) {
      if (creep.build(target as ConstructionSite) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { ...visualPath("build") });
        CreepPersonality.speak(creep, "move");
      } else {
        CreepPersonality.speak(creep, "build");
      }
    } else if (creep.room.controller) {
      // Fallback: upgrade controller so builders don't idle
      const res = creep.upgradeController(creep.room.controller);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, {
          ...visualPath("build"),
        });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "upgrade");
      }
    }
  } else {
    // Refill - but don't compete with haulers for critical energy
    // Check if spawn/extensions need energy (haulers should handle this first)
    const needyStructures = creep.room.find(FIND_MY_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) &&
        (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    // Only pull from storage/containers, not from dropped resources if extensions need filling
    // This prevents builders from competing with haulers for critical energy
    const stores = creep.room.find(FIND_STRUCTURES, {
      filter: (s: AnyStructure) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    }) as AnyStoreStructure[];

    const target = creep.pos.findClosestByPath(stores);
    if (target) {
      const res = creep.withdraw(target, RESOURCE_ENERGY);
      if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { ...visualPath("withdraw") });
        CreepPersonality.speak(creep, "move");
      } else if (res === OK) {
        CreepPersonality.speak(creep, "withdraw");
      }
    } else if (needyStructures.length === 0) {
      // Only pick up dropped resources if spawn/extensions are full
      // This prevents builders from stealing energy haulers need
      const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      const d = creep.pos.findClosestByPath(dropped);
      if (d) {
        if (creep.pickup(d) === ERR_NOT_IN_RANGE) {
          creep.moveTo(d, { ...visualPath("withdraw") });
          CreepPersonality.speak(creep, "move");
        } else {
          CreepPersonality.speak(creep, "withdraw");
        }
      } else {
        // Last resort: harvest from sources (only if no dropped energy and extensions are full)
        const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (src) {
          const res = creep.harvest(src);
          if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(src, { ...visualPath("harvest") });
            CreepPersonality.speak(creep, "move");
          } else if (res === OK) {
            CreepPersonality.speak(creep, "harvest");
          }
        } else {
          CreepPersonality.speak(creep, "frustrated");
        }
      }
    } else {
      // Extensions need energy - wait for haulers to handle it, or harvest as last resort
      const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src) {
        const res = creep.harvest(src);
        if (res === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { ...visualPath("harvest") });
          CreepPersonality.speak(creep, "move");
        } else if (res === OK) {
          CreepPersonality.speak(creep, "harvest");
        }
      } else {
        CreepPersonality.speak(creep, "frustrated");
      }
    }
  }
}

// A construction site is only buildable if a creep can stand on an adjacent tile.
// Guard against positions that are walkable themselves but surrounded by walls/obstacles.
function hasAccessibleAdjacent(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return false;
  const terrain = room.getTerrain();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      const here = new RoomPosition(x, y, pos.roomName);
      const structs = here.lookFor(LOOK_STRUCTURES);
      // Treat roads and containers as walkable; ramparts are walkable when ours/public (assume own room)
      const blocked = structs.some((s) => {
        if (s.structureType === STRUCTURE_ROAD) return false;
        if (s.structureType === STRUCTURE_CONTAINER) return false;
        if (s.structureType === STRUCTURE_RAMPART) return false; // our ramparts are passable
        return true;
      });
      if (!blocked) return true;
    }
  }
  return false;
}

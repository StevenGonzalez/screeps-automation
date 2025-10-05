/// <reference types="@types/screeps" />
import { style } from "./path.styles";
import { CreepPersonality } from "./creep.personality";

export function runDefender(creep: Creep, defensePlan: any, intel: any): void {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

  if (hostiles.length > 0) {
    // Prioritize targets: Healers > Close threats > Wounded enemies
    let target: Creep | null = null;

    // Find healers (high priority)
    const healers = hostiles.filter((h) => h.body.some((p) => p.type === HEAL));

    // Find threats near critical structures
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    const storage = creep.room.storage;
    const criticalThreats = hostiles.filter((h) => {
      if (spawn && h.pos.getRangeTo(spawn) <= 5) return true;
      if (storage && h.pos.getRangeTo(storage) <= 5) return true;
      return false;
    });

    // Filter out kiters near edges (let towers handle them)
    const viableTargets = hostiles.filter((h) => {
      const healParts = h.body.filter((p) => p.type === HEAL).length;
      const nearEdge =
        h.pos.x <= 3 || h.pos.x >= 46 || h.pos.y <= 3 || h.pos.y >= 46;

      // Ignore healers at the edge - they're just baiting us
      if (healParts > 2 && nearEdge) {
        if (Game.time % 50 === 0) {
          console.log(`🛡️ Defender ignoring edge-kiter ${h.owner.username}`);
        }
        return false;
      }
      return true;
    });

    // Target priority: Critical threats with heals > Healers > Critical threats > Wounded > Closest
    if (criticalThreats.length > 0) {
      const healersNearCritical = criticalThreats.filter((h) =>
        healers.includes(h)
      );
      if (healersNearCritical.length > 0) {
        target = creep.pos.findClosestByRange(healersNearCritical);
      } else {
        target = creep.pos.findClosestByRange(criticalThreats);
      }
    } else if (
      healers.length > 0 &&
      viableTargets.some((v) => healers.includes(v))
    ) {
      target = creep.pos.findClosestByRange(
        healers.filter((h) => viableTargets.includes(h))
      );
    } else if (viableTargets.length > 0) {
      // Target wounded enemies first
      const wounded = viableTargets.filter((h) => h.hits < h.hitsMax);
      if (wounded.length > 0) {
        target = creep.pos.findClosestByRange(wounded);
      } else {
        target = creep.pos.findClosestByRange(viableTargets);
      }
    }

    if (target) {
      const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK);
      const hasAttack = creep.body.some((p) => p.type === ATTACK);
      const range = creep.pos.getRangeTo(target);

      // Perform attacks based on available parts
      if (hasRanged) {
        creep.rangedAttack(target);
      }

      if (hasAttack) {
        const attackResult = creep.attack(target);
        if (attackResult === ERR_NOT_IN_RANGE) {
          // Only chase if target is not too close to edge
          const targetNearEdge =
            target.pos.x <= 4 ||
            target.pos.x >= 45 ||
            target.pos.y <= 4 ||
            target.pos.y >= 45;

          if (targetNearEdge && range > 5) {
            // Don't chase - guard position instead
            if (spawn) {
              creep.moveTo(spawn, {
                range: 3,
                visualizePathStyle: style("flee"),
              });
              CreepPersonality.speak(creep, "idle");
            }
          } else {
            // Safe to engage
            creep.moveTo(target, {
              visualizePathStyle: style("attack"),
              maxRooms: 1,
              reusePath: 3,
            });
            CreepPersonality.speak(creep, "move");
          }
        } else if (attackResult === OK) {
          CreepPersonality.speak(creep, "attack");
        }
      } else if (hasRanged) {
        // If ranged only, maintain optimal distance
        if (range < 3) {
          // Too close, back up - move away from target
          const direction = creep.pos.getDirectionTo(target);
          const oppositeDirection = ((direction + 3) % 8) + 1;
          creep.move(oppositeDirection as DirectionConstant);
        } else if (range > 3 && range < 8) {
          // Move to range 3 if not too far
          creep.moveTo(target, {
            visualizePathStyle: style("attack"),
            maxRooms: 1,
            range: 3,
            reusePath: 3,
          });
        } else {
          // Too far, guard spawn instead
          if (spawn) {
            creep.moveTo(spawn, {
              range: 3,
              visualizePathStyle: style("flee"),
            });
          }
        }
        CreepPersonality.speak(creep, "attack");
      }

      return;
    } else if (hostiles.length > 0) {
      // All hostiles are kiters - guard spawn instead of chasing
      const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
      if (spawn) {
        if (creep.pos.getRangeTo(spawn) > 3) {
          creep.moveTo(spawn, {
            range: 3,
            visualizePathStyle: style("flee"),
          });
        }
        CreepPersonality.speak(creep, "idle");
      }
      return;
    }
  }

  // Patrol behavior when no hostiles - guard spawn area
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > 5) {
    creep.moveTo(spawn, { range: 3 });
    CreepPersonality.speak(creep, "move");
  } else {
    CreepPersonality.speak(creep, "idle");
  }
}

import { ROLE_MINERAL_MINER } from "../config/config.roles";

/**
 * Mineral Miner (Prospector)
 * Static miner positioned on mineral container to harvest and deposit minerals
 */

export function runMineralMiner(creep: Creep): void {
  const mineralId = creep.room.memory.mineralId;
  if (!mineralId) return;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral || mineral.mineralAmount === 0) return;

  const containerId = creep.room.memory.mineralContainerId;
  if (!containerId) return;

  const container = Game.getObjectById(containerId) as StructureContainer | null;
  if (!container) return;

  // Position on container for mining
  if (!creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container.pos);
    return;
  }

  // Harvest mineral
  const harvestResult = creep.harvest(mineral);

  if (harvestResult === ERR_NOT_IN_RANGE) {
    // Should not happen if positioned correctly, but handle it
    creep.moveTo(mineral);
  } else if (harvestResult === OK) {
    // Successfully harvested, deposit into container when full
    if (creep.store.getFreeCapacity() === 0) {
      // Deposit harvested minerals into container
      for (const resourceType in creep.store) {
        const res = creep.drop(
          resourceType as ResourceConstant,
          creep.store[resourceType as ResourceConstant]
        );
        if (res !== OK && res !== ERR_NOT_ENOUGH_RESOURCES) {
          break;
        }
      }
    }
  }
  // For other results (ERR_TIRED, ERR_NO_BODYPART), just idle - will retry next tick
}

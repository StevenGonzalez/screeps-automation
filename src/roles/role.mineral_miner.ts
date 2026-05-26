import { ROLE_MINERAL_MINER } from "../config/config.roles";

export function runMineralMiner(creep: Creep): void {
  const mineralId = creep.room.memory.mineralId;
  if (!mineralId) return;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral || mineral.mineralAmount === 0) return;

  const containerId = creep.room.memory.mineralContainerId;
  if (!containerId) return;

  const container = Game.getObjectById(containerId) as StructureContainer | null;
  if (!container) return;

  if (!creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container.pos, { reusePath: 50 });
    return;
  }

  if (creep.store.getFreeCapacity() === 0) {
    for (const resourceType in creep.store) {
      const amount = creep.store[resourceType as ResourceConstant];
      if (amount > 0) {
        const res = creep.transfer(container, resourceType as ResourceConstant);
        if (res !== OK && res !== ERR_NOT_ENOUGH_RESOURCES) break;
      }
    }
    return;
  }

  const result = creep.harvest(mineral);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(mineral, { reusePath: 50 });
  }
}

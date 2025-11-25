// src/creeps/roles/miner.ts
import { MemoryManager } from '../../memory/memoryManager';

export function run(creep: Creep) {
  const containerId = (creep.memory as any).containerId as string | undefined;
  
  if (!containerId) {
    console.log(`Miner ${creep.name} has no container assignment`);
    return;
  }

  const container = Game.getObjectById(containerId) as StructureContainer | null;
  if (!container) {
    console.log(`Miner ${creep.name} container ${containerId} not found`);
    return;
  }

  const source = container.pos.findInRange(FIND_SOURCES, 1)[0];
  if (!source) {
    console.log(`Miner ${creep.name} no source near container`);
    return;
  }

  if (!creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
    return;
  }

  creep.harvest(source);
}

export default { run };

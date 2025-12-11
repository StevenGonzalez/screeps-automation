// src/creeps/roles/miner.ts
import { MemoryManager } from '../../memory/memoryManager';

export function run(creep: Creep) {
  const containerId = (creep.memory as any).containerId as string | undefined;
  
  if (!containerId) {
    console.log(`Miner ${creep.name} has no container assignment`);
    return;
  }

  let container = Game.getObjectById(containerId) as StructureContainer | null;
  let containerPos: RoomPosition | null = null;
  
  // Check if it's a built container
  if (container) {
    containerPos = container.pos;
  } else {
    // Check if it's still a construction site
    const site = Game.getObjectById(containerId) as ConstructionSite | null;
    if (site && site.structureType === STRUCTURE_CONTAINER) {
      containerPos = site.pos;
    } else {
      console.log(`Miner ${creep.name} container ${containerId} not found`);
      return;
    }
  }

  const source = containerPos.findInRange(FIND_SOURCES, 1)[0];
  if (!source) {
    console.log(`Miner ${creep.name} no source near container`);
    return;
  }

  // If not at container position, move there
  if (!creep.pos.isEqualTo(containerPos)) {
    // Check if someone is blocking the container position
    const blockingCreeps = containerPos.lookFor(LOOK_CREEPS);
    if (blockingCreeps.length > 0) {
      // We're trying to get to our spot
      creep.say('🚧');
    }
    
    creep.moveTo(containerPos, { 
      visualizePathStyle: { stroke: '#ffaa00' }, 
      reusePath: 5  // Shorter reuse for miners getting to position
    });
    
    // Try to harvest even while moving if in range
    if (creep.pos.isNearTo(source)) {
      creep.harvest(source);
    }
    return;
  }

  // At container position, harvest
  creep.harvest(source);
}

export default { run };

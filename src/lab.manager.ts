declare const RESOURCE_UH: ResourceConstant;
declare const RESOURCE_O: ResourceConstant;
declare const RESOURCE_UHO2: ResourceConstant;

/**
 * Lab Manager: Handles reactions, boosting, mineral/energy management, cooldown, and advanced assignments.
 */

export function runLabManager(room: Room) {
  const labs = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_LAB,
  }) as StructureLab[];
  if (labs.length < 3) return; // Need at least 3 for reactions
  // 1. Assign input/output labs (track in memory for persistence)
  if (!room.memory.labAssignments) {
    room.memory.labAssignments = {
      inputA: labs[0].id,
      inputB: labs[1].id,
      output: labs[2].id,
    };
  }
  const inputA =
    labs.find((l) => l.id === room.memory.labAssignments?.inputA) || labs[0];
  const inputB =
    labs.find((l) => l.id === room.memory.labAssignments?.inputB) || labs[1];
  const output =
    labs.find((l) => l.id === room.memory.labAssignments?.output) || labs[2];

  // 2. Auto-run reaction for UH + O -> UHO2 (defense boost), with cooldown check
  if (
    inputA.mineralType === RESOURCE_UH &&
    inputB.mineralType === RESOURCE_O &&
    output.cooldown === 0 &&
    inputA.store[RESOURCE_UH] > 0 &&
    inputB.store[RESOURCE_O] > 0
  ) {
    output.runReaction(inputA, inputB);
    console.log(`[Lab] Ran reaction UH + O -> UHO2 in ${room.name}`);
  }

  // 3. Advanced reaction chain (example: UHO2 -> XUHO2)
  // Add more reactions as needed

  // 4. Auto-boost creeps with UHO2 if available, with cooldown and energy check
  const boostLab = labs.find(
    (l) =>
      l.mineralType === RESOURCE_UHO2 &&
      l.store.energy > 100 &&
      l.cooldown === 0
  );
  if (boostLab) {
    const creeps = room.find(FIND_MY_CREEPS, {
      filter: (c) => c.memory.boost && !c.memory.isBoosted,
    });
    for (const creep of creeps) {
      if (creep.pos.isNearTo(boostLab)) {
        boostLab.boostCreep(creep);
        creep.memory.isBoosted = true;
        console.log(`[Lab] Boosted creep ${creep.name} in ${room.name}`);
      }
    }
  }
}

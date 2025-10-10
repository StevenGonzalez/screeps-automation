import { RoomCache } from "../room/cache";

/**
 * Lab Manager: Handles reactions, boosting, and lab assignments
 *
 * Reaction Queue System:
 * - Supports chained reactions (e.g., UH + O -> UHO2, then UHO2 + X -> XUHO2)
 * - Auto-empties labs when switching reactions
 * - Prioritizes producing common boosts for military operations
 */

// Custom reaction recipes mapping
const LAB_REACTIONS: { [key: string]: [ResourceConstant, ResourceConstant] } = {
  // Tier 1
  OH: [RESOURCE_OXYGEN, RESOURCE_HYDROGEN],
  ZK: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM],
  UL: [RESOURCE_UTRIUM, RESOURCE_LEMERGIUM],
  G: [RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM], // Ghodium requires ZK first

  // Tier 2 - Common boosts
  UO: [RESOURCE_UTRIUM, RESOURCE_OXYGEN],
  UH: [RESOURCE_UTRIUM, RESOURCE_HYDROGEN],
  ZO: [RESOURCE_ZYNTHIUM, RESOURCE_OXYGEN],
  ZH: [RESOURCE_ZYNTHIUM, RESOURCE_HYDROGEN],
  KO: [RESOURCE_KEANIUM, RESOURCE_OXYGEN],
  KH: [RESOURCE_KEANIUM, RESOURCE_HYDROGEN],
  LO: [RESOURCE_LEMERGIUM, RESOURCE_OXYGEN],
  LH: [RESOURCE_LEMERGIUM, RESOURCE_HYDROGEN],
  GH: [RESOURCE_GHODIUM, RESOURCE_HYDROGEN],
  GO: [RESOURCE_GHODIUM, RESOURCE_OXYGEN],

  // Tier 3 - Powerful boosts
  UHO2: ["UH" as ResourceConstant, RESOURCE_OXYGEN], // Attack +100%
  UH2O: ["UH" as ResourceConstant, "OH" as ResourceConstant], // Attack +200%
  KHO2: ["KH" as ResourceConstant, RESOURCE_OXYGEN], // Carry +100%
  KH2O: ["KH" as ResourceConstant, "OH" as ResourceConstant], // Carry +200%
  ZHO2: ["ZH" as ResourceConstant, RESOURCE_OXYGEN], // Dismantle +100%
  ZH2O: ["ZH" as ResourceConstant, "OH" as ResourceConstant], // Dismantle +200%
  LHO2: ["LH" as ResourceConstant, RESOURCE_OXYGEN], // Heal +100%
  LH2O: ["LH" as ResourceConstant, "OH" as ResourceConstant], // Heal +200%
  GHO2: ["GH" as ResourceConstant, RESOURCE_OXYGEN], // Upgrade +80%
  GH2O: ["GH" as ResourceConstant, "OH" as ResourceConstant], // Upgrade +100%
};

// Default production queue (prioritize combat and upgrading boosts)
const DEFAULT_REACTION_QUEUE: ResourceConstant[] = [
  "UH" as ResourceConstant, // First make Tier 2 compounds
  "LH" as ResourceConstant,
  "GH" as ResourceConstant,
  "KH" as ResourceConstant,
  "UHO2" as ResourceConstant, // Then Tier 3 boosts
  "LH2O" as ResourceConstant, // Heal boost
  "GH2O" as ResourceConstant, // Upgrade boost
  "KHO2" as ResourceConstant, // Carry boost
];

export function runLabManager(room: Room) {
  const labs = RoomCache.labs(room);
  if (labs.length < 3) return; // Need at least 3 for reactions

  const mem = room.memory as any;

  // Initialize lab assignments if needed
  if (!mem.labAssignments) {
    mem.labAssignments = {
      inputA: labs[0].id,
      inputB: labs[1].id,
      output: labs.slice(2).map((l: StructureLab) => l.id),
    };
  }

  // Initialize reaction queue
  if (!mem.reactionQueue) {
    mem.reactionQueue = DEFAULT_REACTION_QUEUE;
  }

  const inputA = Game.getObjectById(
    mem.labAssignments.inputA as Id<StructureLab>
  );
  const inputB = Game.getObjectById(
    mem.labAssignments.inputB as Id<StructureLab>
  );

  // Handle both array and single ID formats for output
  const outputProp = mem.labAssignments.output;
  const outputIds = Array.isArray(outputProp) ? outputProp : [outputProp];

  const outputLabs = outputIds
    .map((id: string) => Game.getObjectById(id as Id<StructureLab>))
    .filter((lab: StructureLab | null) => lab) as StructureLab[];

  if (!inputA || !inputB || outputLabs.length === 0) return;

  // Get current target compound
  const currentTarget = mem.currentReaction || mem.reactionQueue[0];
  if (!currentTarget) return;

  // Check if we have enough of the current target (1000 units)
  const terminal = room.terminal;
  const storage = room.storage;
  const currentAmount =
    (terminal?.store[currentTarget as ResourceConstant] || 0) +
    (storage?.store[currentTarget as ResourceConstant] || 0);

  if (currentAmount >= 1000) {
    // Move to next reaction in queue
    const currentIndex = mem.reactionQueue.indexOf(currentTarget);
    const nextIndex = (currentIndex + 1) % mem.reactionQueue.length;
    mem.currentReaction = mem.reactionQueue[nextIndex];
    console.log(
      `[Lab] Completed ${currentTarget}, switching to ${mem.currentReaction}`
    );
    return;
  }

  // Get the recipe for current target
  const recipe = LAB_REACTIONS[currentTarget];
  if (!recipe) {
    console.log(`[Lab] ⚠️ Unknown recipe for ${currentTarget}`);
    return;
  }

  const [ingredientA, ingredientB] = recipe;

  // Check if labs need to be emptied (wrong minerals loaded)
  if (inputA.mineralType && inputA.mineralType !== ingredientA) {
    // Need to empty this lab
    if (Game.time % 10 === 0) {
      console.log(
        `[Lab] Input A has ${inputA.mineralType}, needs ${ingredientA}. Waiting for hauler to empty it.`
      );
    }
    return;
  }

  if (inputB.mineralType && inputB.mineralType !== ingredientB) {
    if (Game.time % 10 === 0) {
      console.log(
        `[Lab] Input B has ${inputB.mineralType}, needs ${ingredientB}. Waiting for hauler to empty it.`
      );
    }
    return;
  }

  // Run reactions on all output labs
  for (const outputLab of outputLabs) {
    if (outputLab.cooldown > 0) continue;

    // Check if output lab needs emptying
    if (outputLab.mineralType && outputLab.mineralType !== currentTarget) {
      if (Game.time % 10 === 0) {
        console.log(
          `[Lab] Output lab has ${outputLab.mineralType}, needs empty for ${currentTarget}`
        );
      }
      continue;
    }

    // Check if we have ingredients
    if (!inputA.store[ingredientA] || !inputB.store[ingredientB]) {
      if (Game.time % 50 === 0) {
        console.log(
          `[Lab] Waiting for ${ingredientA}(${
            inputA.store[ingredientA] || 0
          }) and ${ingredientB}(${inputB.store[ingredientB] || 0})`
        );
      }
      continue;
    }

    // Check if output lab has space
    if (outputLab.store.getFreeCapacity(currentTarget) === 0) continue;

    // Run the reaction!
    const result = outputLab.runReaction(inputA, inputB);
    if (result === OK) {
      if (Game.time % 20 === 0) {
        console.log(
          `⚗️ [Lab] ${ingredientA} + ${ingredientB} → ${currentTarget} (${currentAmount}/1000)`
        );
      }
    }
  }

  // Boost creeps that need it
  boostCreeps(room, labs);
}

function boostCreeps(room: Room, labs: StructureLab[]) {
  // Find creeps that need boosting
  const creepsNeedingBoost = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.memory.needsBoost && !c.memory.boosted,
  });

  for (const creep of creepsNeedingBoost) {
    const boostType = creep.memory.boostType as ResourceConstant;
    if (!boostType) continue;

    // Find lab with the needed boost
    const boostLab = labs.find(
      (l) =>
        l.mineralType === boostType &&
        l.store[boostType] >= 30 && // Need at least 30 mineral per body part
        l.cooldown === 0
    );

    if (!boostLab) continue;

    // Creep needs to be next to lab
    if (creep.pos.isNearTo(boostLab)) {
      const result = boostLab.boostCreep(creep);
      if (result === OK) {
        creep.memory.boosted = true;
        console.log(`💉 [Lab] Boosted ${creep.name} with ${boostType}`);
      }
    } else {
      // Move to lab
      creep.moveTo(boostLab, { range: 1 });
    }
  }
}

/**
 * Get lab resource requirements for haulers
 * Returns labs that need filling or emptying
 */
export function getLabRequirements(room: Room): {
  toFill: { lab: StructureLab; resource: ResourceConstant; amount: number }[];
  toEmpty: { lab: StructureLab; resource: ResourceConstant }[];
} {
  const result = {
    toFill: [] as {
      lab: StructureLab;
      resource: ResourceConstant;
      amount: number;
    }[],
    toEmpty: [] as { lab: StructureLab; resource: ResourceConstant }[],
  };

  const labs = RoomCache.labs(room);
  if (labs.length < 3 || !room.memory.labAssignments) return result;

  const currentTarget =
    (room.memory as any).currentReaction ||
    (room.memory as any).reactionQueue?.[0];
  if (!currentTarget) return result;

  const recipe = LAB_REACTIONS[currentTarget];
  if (!recipe) return result;

  const [ingredientA, ingredientB] = recipe;
  const inputA = Game.getObjectById(
    room.memory.labAssignments.inputA as Id<StructureLab>
  );
  const inputB = Game.getObjectById(
    room.memory.labAssignments.inputB as Id<StructureLab>
  );

  // Handle both array and single ID formats for output
  const outputProp = room.memory.labAssignments.output;
  const outputIds = Array.isArray(outputProp) ? outputProp : [outputProp];

  const outputLabs = outputIds
    .map((id: string) => Game.getObjectById(id as Id<StructureLab>))
    .filter((lab: StructureLab | null) => lab) as StructureLab[];

  if (!inputA || !inputB) return result;

  // Check input labs
  const TARGET_INPUT_AMOUNT = 2000; // Keep input labs well-stocked

  // Input A
  if (inputA.mineralType && inputA.mineralType !== ingredientA) {
    // Wrong mineral, needs emptying
    result.toEmpty.push({ lab: inputA, resource: inputA.mineralType });
  } else if ((inputA.store[ingredientA] || 0) < TARGET_INPUT_AMOUNT) {
    // Needs filling
    const needed = TARGET_INPUT_AMOUNT - (inputA.store[ingredientA] || 0);
    result.toFill.push({ lab: inputA, resource: ingredientA, amount: needed });
  }

  // Input B
  if (inputB.mineralType && inputB.mineralType !== ingredientB) {
    result.toEmpty.push({ lab: inputB, resource: inputB.mineralType });
  } else if ((inputB.store[ingredientB] || 0) < TARGET_INPUT_AMOUNT) {
    const needed = TARGET_INPUT_AMOUNT - (inputB.store[ingredientB] || 0);
    result.toFill.push({ lab: inputB, resource: ingredientB, amount: needed });
  }

  // Check output labs
  for (const outputLab of outputLabs) {
    if (outputLab.mineralType && outputLab.mineralType !== currentTarget) {
      // Wrong mineral, needs emptying
      result.toEmpty.push({ lab: outputLab, resource: outputLab.mineralType });
    } else {
      const capacity = outputLab.store.getCapacity(
        currentTarget as ResourceConstant
      );
      const amount = outputLab.store[currentTarget as ResourceConstant] || 0;
      if (capacity && amount >= capacity * 0.9) {
        // Nearly full, needs emptying
        result.toEmpty.push({
          lab: outputLab,
          resource: currentTarget as ResourceConstant,
        });
      }
    }
  }

  return result;
}

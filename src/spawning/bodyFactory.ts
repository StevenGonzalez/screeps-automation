// src/spawning/bodyFactory.ts

export function bestBodyForRole(role: string, energy: number): { body: BodyPartConstant[]; cost: number } {
  const partCost: Record<BodyPartConstant, number> = {
    [WORK]: 100,
    [CARRY]: 50,
    [MOVE]: 50,
    [ATTACK]: 80,
    [RANGED_ATTACK]: 150,
    [HEAL]: 250,
    [TOUGH]: 10,
    [CLAIM]: 600,
  } as any;

  const repeatPattern = (pattern: BodyPartConstant[], availableEnergy: number) => {
    const body: BodyPartConstant[] = [];
    const patternCost = pattern.reduce((s, p) => s + (partCost[p] || 0), 0);
    let cost = 0;
    while (cost + patternCost <= availableEnergy && body.length + pattern.length <= 50) {
      body.push(...pattern);
      cost += patternCost;
    }
    return { body, cost };
  };

  if (role === 'harvester') {
    const pattern: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, CARRY, MOVE], cost: partCost[WORK] + partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'upgrader') {
    // Upgraders work right next to container and controller, so maximize WORK parts
    // Pattern: 2 WORK, 1 CARRY, 1 MOVE = 250 energy (down from 350)
    // More efficient scaling and less energy drain
    const pattern: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, MOVE, CARRY], cost: partCost[WORK] + partCost[MOVE] + partCost[CARRY] };
    return { body, cost };
  }

  if (role === 'builder') {
    // Pattern: 1 WORK, 2 CARRY, 1 MOVE = 250 energy
    // Better balance for building - more carry for energy, less move cost
    const pattern: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, CARRY, MOVE], cost: partCost[WORK] + partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'miner') {
    // Miners sit on container and harvest. Sources regenerate 3000 energy every 300 ticks.
    // Perfect mining: 3000/300 = 10 energy/tick. Each WORK harvests 2/tick, so 5 WORK parts optimal.
    // Build towards 5 WORK + minimal MOVE for initial positioning
    const targetWork = 5;
    const body: BodyPartConstant[] = [];
    let cost = 0;
    
    // Add WORK parts up to 5
    let workCount = 0;
    while (workCount < targetWork && cost + partCost[WORK] <= energy && body.length < 50) {
      body.push(WORK);
      cost += partCost[WORK];
      workCount++;
    }
    
    // Add 1 MOVE per 2 WORK parts (enough to move unencumbered)
    const moveNeeded = Math.ceil(workCount / 2);
    let moveCount = 0;
    while (moveCount < moveNeeded && cost + partCost[MOVE] <= energy && body.length < 50) {
      body.push(MOVE);
      cost += partCost[MOVE];
      moveCount++;
    }
    
    if (body.length === 0) return { body: [WORK, MOVE], cost: partCost[WORK] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'hauler') {
    const pattern: BodyPartConstant[] = [CARRY, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [CARRY, MOVE], cost: partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'repairer') {
    // Balanced composition: 1 WORK, 1 CARRY, 1 MOVE
    // Provides good repair speed while maintaining mobility and energy capacity
    const pattern: BodyPartConstant[] = [WORK, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, CARRY, MOVE], cost: partCost[WORK] + partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  // default minimal mover
  return { body: [MOVE, CARRY], cost: partCost[MOVE] + partCost[CARRY] };
}

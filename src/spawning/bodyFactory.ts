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
    const pattern: BodyPartConstant[] = [WORK, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, MOVE, CARRY], cost: partCost[WORK] + partCost[MOVE] + partCost[CARRY] };
    return { body, cost };
  }

  if (role === 'builder') {
    const pattern: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, CARRY, MOVE], cost: partCost[WORK] + partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'miner') {
    const pattern: BodyPartConstant[] = [WORK, WORK, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [WORK, MOVE], cost: partCost[WORK] + partCost[MOVE] };
    return { body, cost };
  }

  if (role === 'hauler') {
    const pattern: BodyPartConstant[] = [CARRY, CARRY, MOVE];
    const { body, cost } = repeatPattern(pattern, energy);
    if (body.length === 0) return { body: [CARRY, MOVE], cost: partCost[CARRY] + partCost[MOVE] };
    return { body, cost };
  }

  // default minimal mover
  return { body: [MOVE, CARRY], cost: partCost[MOVE] + partCost[CARRY] };
}

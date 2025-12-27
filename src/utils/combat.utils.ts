/**
 * Combat Utilities
 *
 * Shared utility functions for combat calculations
 */

/**
 * Calculate the total attack power of a creep based on body parts
 */
export function calculateAttackPower(bodyParts: BodyPartConstant[]): number {
  return (
    bodyParts.filter((part) => part === ATTACK).length * 30 +
    bodyParts.filter((part) => part === RANGED_ATTACK).length * 10
  );
}

/**
 * Calculate the total heal capability of a creep based on body parts
 */
export function calculateHealCapability(bodyParts: BodyPartConstant[]): number {
  return bodyParts.filter((part) => part === HEAL).length * 12;
}

/**
 * Calculate the defensive capacity (toughness) of a creep
 */
export function calculateToughness(bodyParts: BodyPartConstant[]): number {
  return bodyParts.filter((part) => part === TOUGH).length * 100;
}

/**
 * Count specific body part types in a creep
 */
export function countBodyParts(creep: Creep, partType: BodyPartConstant): number {
  return creep.body.filter((p) => p.type === partType).length;
}

/**
 * Get comprehensive body part counts for a creep
 */
export function getBodyPartCounts(creep: Creep): {
  heal: number;
  tough: number;
  move: number;
  attack: number;
  rangedAttack: number;
  work: number;
  carry: number;
} {
  return {
    heal: countBodyParts(creep, HEAL),
    tough: countBodyParts(creep, TOUGH),
    move: countBodyParts(creep, MOVE),
    attack: countBodyParts(creep, ATTACK),
    rangedAttack: countBodyParts(creep, RANGED_ATTACK),
    work: countBodyParts(creep, WORK),
    carry: countBodyParts(creep, CARRY),
  };
}

/**
 * Check if a creep is a fast/mobile unit
 */
export function isFastCreep(creep: Creep): boolean {
  const moveParts = countBodyParts(creep, MOVE);
  return moveParts >= creep.body.length * 0.4;
}

/**
 * Check if a creep is near room edge (within 5 tiles)
 */
export function isNearRoomEdge(pos: RoomPosition): boolean {
  return pos.x <= 5 || pos.x >= 44 || pos.y <= 5 || pos.y >= 44;
}

/**
 * Detect if a creep is a healer/kiter (harassment pattern)
 */
export function isHealerKiter(creep: Creep): boolean {
  const healParts = countBodyParts(creep, HEAL);
  const attackParts = countBodyParts(creep, ATTACK) + countBodyParts(creep, RANGED_ATTACK);
  return healParts > 0 && attackParts <= 3 && healParts >= attackParts * 0.75;
}

/**
 * Detect if a creep is likely a harassment/kiting unit
 */
export function isLikelyHarassmentUnit(creep: Creep): boolean {
  const healParts = countBodyParts(creep, HEAL);
  if (healParts === 0) return false;
  
  return (isHealerKiter(creep) || isFastCreep(creep)) && isNearRoomEdge(creep.pos);
}

/**
 * Detect if a creep is a drain tank (TOUGH + high HP)
 * These creeps bait towers into wasting energy
 */
export function isDrainTank(creep: Creep): boolean {
  const toughParts = countBodyParts(creep, TOUGH);
  const healParts = countBodyParts(creep, HEAL);
  
  // Tank characteristics: lots of TOUGH, high HP, maybe some heal
  return toughParts >= 10 || (toughParts >= 5 && creep.hits > 2000);
}

/**
 * Calculate how much energy it would take to kill a creep with tower fire
 * Accounts for healing from the creep and nearby healers
 */
export function estimateEnergyToKill(
  creep: Creep,
  towerDistance: number,
  nearbyHealers: Creep[] = []
): number {
  // Tower damage: 600 at range <=5, linear falloff to 150 at range 20+
  let towerDamage = 600;
  if (towerDistance > 5) {
    towerDamage = Math.max(150, 600 - (towerDistance - 5) * 30);
  }
  
  // Calculate heal rate (self + nearby healers)
  const selfHeal = countBodyParts(creep, HEAL) * 12;
  const externalHeal = nearbyHealers.reduce((sum, healer) => {
    return sum + countBodyParts(healer, HEAL) * 12;
  }, 0);
  const totalHealRate = selfHeal + externalHeal;
  
  // Net damage per tower shot
  const netDamage = Math.max(1, towerDamage - totalHealRate);
  
  // Energy needed (10 energy per shot)
  const shotsNeeded = Math.ceil(creep.hits / netDamage);
  return shotsNeeded * 10;
}

/**
 * Check if attacking a creep would be energy-efficient
 * Returns false if it would waste too much energy
 */
export function isEfficientTarget(
  creep: Creep,
  tower: StructureTower,
  room: Room,
  maxEnergyToSpend: number = 500
): boolean {
  const distance = tower.pos.getRangeTo(creep);
  
  // Find nearby healers
  const nearbyHealers = room.find(FIND_HOSTILE_CREEPS, {
    filter: (h) => {
      if (h.id === creep.id) return false;
      if (countBodyParts(h, HEAL) === 0) return false;
      return h.pos.getRangeTo(creep) <= 3;
    },
  });
  
  const energyNeeded = estimateEnergyToKill(creep, distance, nearbyHealers);
  
  // Don't attack if:
  // 1. Would take more than maxEnergyToSpend
  // 2. Would use more than half our tower energy
  // 3. Net damage is too low (< 100)
  
  if (energyNeeded > maxEnergyToSpend) {
    return false;
  }
  
  const towerEnergy = tower.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energyNeeded > towerEnergy * 0.5) {
    return false;
  }
  
  // Calculate net damage
  let towerDamage = 600;
  if (distance > 5) {
    towerDamage = Math.max(150, 600 - (distance - 5) * 30);
  }
  const totalHeal = countBodyParts(creep, HEAL) * 12 + 
    nearbyHealers.reduce((sum, h) => sum + countBodyParts(h, HEAL) * 12, 0);
  
  return (towerDamage - totalHeal) >= 100;
}

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

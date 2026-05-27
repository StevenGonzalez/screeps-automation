const KITE_RANGE = 3;

export function runWizard(creep: Creep) {
  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  const range = creep.pos.getRangeTo(hostile);
  const inRangeHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);

  // Fire every tick we're within range — movement doesn't block ranged attacks
  if (inRangeHostiles.length >= 3) {
    creep.rangedMassAttack();
  } else if (range <= KITE_RANGE) {
    creep.rangedAttack(hostile);
  }

  // Kite: step away if hostile is adjacent, close in if out of range
  if (range < KITE_RANGE) {
    creep.move(hostile.pos.getDirectionTo(creep.pos));
  } else if (range > KITE_RANGE + 1) {
    creep.moveTo(hostile, { range: KITE_RANGE, reusePath: 5 });
  }
}

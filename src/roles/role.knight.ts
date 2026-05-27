export function runKnight(creep: Creep) {
  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }
  if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
    creep.moveTo(hostile, { reusePath: 3 });
  }
}

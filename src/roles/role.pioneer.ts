export function runPioneer(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  if (creep.room.name !== targetRoom) {
    const exit = creep.room.findExitTo(targetRoom);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
      creep.suicide();
      return;
    }
    const exitPos = creep.pos.findClosestByRange(exit);
    if (exitPos) creep.moveTo(exitPos, { reusePath: 50 });
    return;
  }

  // Toggle working state on empty/full
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (!source) {
      const ctrl = creep.room.controller;
      if (ctrl && !creep.pos.isNearTo(ctrl)) creep.moveTo(ctrl, { reusePath: 20 });
      return;
    }
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 10 });
    }
    return;
  }

  // Build anything in the room — spawns first by proximity
  const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { reusePath: 10 });
    }
    return;
  }

  // Spawn exists but no sites — fill it so it can start spawning
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  // Nothing urgent — upgrade controller to keep room from decaying
  const ctrl = creep.room.controller;
  if (ctrl) {
    if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
      creep.moveTo(ctrl, { reusePath: 20 });
    }
  }
}

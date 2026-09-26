// Strips a hostile controller in a room a military op has already cleared.
// Each attackController takes CONTROLLER_CLAIM_DOWNGRADE ticks per CLAIM part
// off an owned controller and then blocks further attacks for
// CONTROLLER_ATTACK_BLOCKED_UPGRADE ticks, so it takes a relay of these creeps.
export function runUnclaimer(creep: Creep): void {
  const targetRoom = creep.memory.targetRoom;
  const target = targetRoom ? Memory.unclaimTargets?.[targetRoom] : undefined;
  if (!targetRoom || !target) {
    creep.suicide();
    return;
  }

  if (creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50, range: 20 });
    return;
  }

  const ctrl = creep.room.controller;
  if (!ctrl || ctrl.my || (!ctrl.owner && !ctrl.reservation)) {
    delete Memory.unclaimTargets![targetRoom];
    creep.suicide();
    return;
  }

  target.blockedUntil = Game.time + (ctrl.upgradeBlocked ?? 0);
  if (!creep.pos.isNearTo(ctrl)) {
    creep.moveTo(ctrl, { range: 1, reusePath: 10 });
    return;
  }
  const result = creep.attackController(ctrl);
  if (result === OK && ctrl.owner) {
    // One hit per creep on an owned controller; the next one is already due.
    target.blockedUntil = Game.time + CONTROLLER_ATTACK_BLOCKED_UPGRADE;
    creep.suicide();
  }
}

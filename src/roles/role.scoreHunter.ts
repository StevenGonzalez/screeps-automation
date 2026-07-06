import {
  claimNearestScoreTarget,
  getScoreTarget,
  pickPatrolRoom,
} from "../orchestrators/orchestrator.score";

export function runScoreHunter(creep: Creep): void {
  let targetId = creep.memory.targetId;
  let target = targetId ? getScoreTarget(targetId) : undefined;

  if (targetId && !target) {
    creep.memory.targetId = undefined;
    targetId = undefined;
  }

  if (!targetId) {
    targetId = claimNearestScoreTarget(creep);
    if (!targetId) {
      patrol(creep);
      return;
    }
    creep.memory.targetId = targetId;
    target = getScoreTarget(targetId);
  }

  if (!target) return;

  const pos = new RoomPosition(target.x, target.y, target.roomName);
  if (!creep.pos.isEqualTo(pos)) {
    creep.moveTo(pos, { reusePath: 20, visualizePathStyle: { stroke: "#ffff00" } });
  }
}

function patrol(creep: Creep): void {
  if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
    creep.memory.targetRoom = pickPatrolRoom(creep);
  }

  const dest = creep.memory.targetRoom;
  if (dest && creep.room.name !== dest) {
    creep.moveTo(new RoomPosition(25, 25, dest), { reusePath: 30 });
    return;
  }

  if (!dest) {
    const ctrl = creep.room.controller;
    if (ctrl && !creep.pos.inRangeTo(ctrl, 3)) creep.moveTo(ctrl, { range: 3, reusePath: 30 });
  }
}

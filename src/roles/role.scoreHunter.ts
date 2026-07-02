/**
 * Score Hunter (Season only, see orchestrator.score.ts): a single-MOVE creep whose entire
 * job is to walk onto a "Score" object. Collection is automatic on touch — no harvest/pickup
 * call needed, so there's nothing else for this role to do.
 *
 * Assignment: creep.memory.targetId   = claimed score id (key into Memory.scoreTargets)
 *             creep.memory.homeRoom   = room to idle in while nothing is unclaimed
 */

import { claimNearestScoreTarget, getScoreTarget } from "../orchestrators/orchestrator.score";

export function runScoreHunter(creep: Creep): void {
  let targetId = creep.memory.targetId;
  let target = targetId ? getScoreTarget(targetId) : undefined;

  // Assigned target vanished (we collected it, someone else did, or it decayed) — drop it
  // and try to pick up something else the same tick instead of idling for a tick first.
  if (targetId && !target) {
    creep.memory.targetId = undefined;
    targetId = undefined;
  }

  if (!targetId) {
    targetId = claimNearestScoreTarget(creep);
    if (!targetId) {
      idleAtHome(creep);
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
  // Arrival collects automatically; if the object is gone next tick the lookup above clears
  // the stale assignment and this creep re-claims whatever's next.
}

function idleAtHome(creep: Creep): void {
  const home = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom] : undefined;
  const spawn = home?.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) creep.moveTo(spawn, { reusePath: 20 });
}

/**
 * Score Hunter (Season only, see orchestrator.score.ts): a single-MOVE creep that either
 * walks onto a claimed "Score" object (collection is automatic on touch — no harvest/pickup
 * call needed) or, with nothing claimed, patrols nearby rooms as the search arm: without an
 * observer, the only way to ever discover a Score is a creep physically standing in the room
 * when one spawns.
 *
 * Assignment: creep.memory.targetId   = claimed score id (key into Memory.scoreTargets)
 *             creep.memory.targetRoom = current patrol destination while nothing is claimed
 *             creep.memory.homeRoom   = anchors the patrol radius
 */

import {
  claimNearestScoreTarget,
  getScoreTarget,
  pickPatrolRoom,
} from "../orchestrators/orchestrator.score";

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
  // Arrival collects automatically; if the object is gone next tick the lookup above clears
  // the stale assignment and this creep re-claims whatever's next.
}

// Sweep nearby rooms for Scores. Passing through a room refreshes vision, which is all
// orchestrator.score.ts needs to spot a Score there — the search is a side effect of being
// present, not an explicit scan. Which room to head for is decided fleet-wide by pickPatrolRoom
// (stalest safe room no peer already owns), so the seekers spread out and cover the region
// rather than trailing each other.
function patrol(creep: Creep): void {
  if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
    creep.memory.targetRoom = pickPatrolRoom(creep);
  }

  const dest = creep.memory.targetRoom;
  if (dest && creep.room.name !== dest) {
    creep.moveTo(new RoomPosition(25, 25, dest), { reusePath: 30 });
    return;
  }

  // No safe room to patrol (home boxed in by hostile-owned neighbours). Don't squat on the
  // spawn pad blocking it — step off toward the controller and hold until a target frees up.
  if (!dest) {
    const ctrl = creep.room.controller;
    if (ctrl && !creep.pos.inRangeTo(ctrl, 3)) creep.moveTo(ctrl, { range: 3, reusePath: 30 });
  }
}

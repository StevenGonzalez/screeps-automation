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

import { claimNearestScoreTarget, getScoreTarget } from "../orchestrators/orchestrator.score";

// How far (in rooms) a patroller wanders from home while searching. Kept short: a Score can
// decay in as little as 100 ticks, so ranging far away just means arriving after it's gone.
const SCORE_PATROL_RADIUS = 2;

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

// Wander a loop of rooms near home. Passing through refreshes vision, which is all
// orchestrator.score.ts needs to spot a Score there — the search itself is a side effect of
// just being present, not an explicit scan.
function patrol(creep: Creep): void {
  const homeRoomName = creep.memory.homeRoom;
  if (!homeRoomName) return;

  if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
    creep.memory.targetRoom = pickNextPatrolRoom(creep, homeRoomName) ?? homeRoomName;
  }

  if (creep.room.name !== creep.memory.targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, creep.memory.targetRoom), { reusePath: 30 });
  }
}

function pickNextPatrolRoom(creep: Creep, homeRoomName: string): string | undefined {
  const exits = Game.map.describeExits(creep.room.name);
  if (!exits) return undefined;

  const candidates = Object.values(exits).filter((name): name is string => {
    if (!name) return false;
    if (Game.map.getRoomLinearDistance(homeRoomName, name) > SCORE_PATROL_RADIUS) return false;
    // Don't wander into a room a scout has already logged as player-owned — a 50-energy
    // creep gains nothing dying to that room's defenses.
    if (Memory.intel?.[name]?.owner) return false;
    return true;
  });

  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

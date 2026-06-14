import { seekBoost } from "../services/services.combat";
import { clearRemoteInvader } from "../services/services.creep";
import { getDefenseOp, getOffensiveOp, runDefensiveKnight, runOffensiveKnight } from "../orchestrators/orchestrator.military";

const RETREAT_THRESHOLD = 0.2;

export function runKnight(creep: Creep) {
  if (creep.memory.boostCompound && seekBoost(creep)) return;

  // Offensive squad: tagged creep follows military orchestrator orders
  if (creep.memory.offensiveTarget) {
    const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
    if (op) {
      runOffensiveKnight(creep, op);
      return;
    }
    delete creep.memory.offensiveTarget; // stale from a completed/cancelled op
  }

  // Standing defense: assigned to an auto-declared defensive op for an owned room
  if (creep.memory.defensiveTarget) {
    if (getDefenseOp(creep.memory.defensiveTarget)) {
      runDefensiveKnight(creep, creep.memory.defensiveTarget);
      return;
    }
    delete creep.memory.defensiveTarget; // op ended (threat cleared)
  }

  // Child-room bootstrap defender: travel to the assigned room and clear it. Once
  // there it falls through to the generic engage-nearest-hostile logic below.
  if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, creep.memory.targetRoom), { reusePath: 20 });
    return;
  }

  // Defensive: retreat to spawn when critically injured so towers/clerics can heal
  if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      if (!creep.pos.isNearTo(spawn)) creep.moveTo(spawn, { reusePath: 5 });
      return;
    }
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    // Reached the assigned room and it's clear — a remote defender has secured it, so lift
    // the Invader flag and let the miners/haulers come back (no-op for a child-room defender,
    // which has no remote-room entry).
    if (creep.memory.targetRoom === creep.room.name) clearRemoteInvader(creep);
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

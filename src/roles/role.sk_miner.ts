import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeper } from "../services/services.combat";
import { getSkOp, isOpPaused } from "../orchestrators/orchestrator.sourcekeeper";

/**
 * Delver: mines a single source in a Source Keeper room. Carries no CARRY parts, so
 * harvested energy drops where it stands for Wains to collect. Keeps mining while a
 * Huntsman is nearby to kill spawning keepers; only when no guardian is protecting it
 * (or the room is contested) does it fall all the way back home.
 */
const KEEPER_DANGER_RANGE = 4;
const GUARDIAN_GUARD_RANGE = 6;

export function runSkMiner(creep: Creep) {
  const opId = creep.memory.skOpId;
  const op = opId !== undefined ? getSkOp(opId) : undefined;
  if (!op) {
    delete creep.memory.skOpId;
    delete creep.memory.skSourceId;
    creep.suicide();
    return;
  }

  // Contested by an enemy player — abandon the room until it clears.
  if (isOpPaused(op)) {
    moveToRoom(creep, op.homeRoom);
    return;
  }

  if (creep.room.name !== op.roomName) {
    moveToRoom(creep, op.roomName);
    return;
  }

  // Back off only when a keeper is closing in AND no guardian is here to kill it —
  // otherwise trust the Huntsman and keep mining (avoids respawn-cycle oscillation).
  const keeper = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
    filter: (c) => isSourceKeeper(c),
  });
  if (keeper && creep.pos.getRangeTo(keeper) <= KEEPER_DANGER_RANGE) {
    const guardianNear = creep.pos
      .findInRange(FIND_MY_CREEPS, GUARDIAN_GUARD_RANGE, {
        filter: (c) => c.memory.role === ROLE_SK_GUARDIAN && c.memory.skOpId === op.id,
      })
      .length > 0;
    // Trust the guardian and keep mining — UNLESS we're actually losing the fight. If HP
    // has dropped below 40% the guardian isn't killing the keeper fast enough, so retreat
    // rather than sit at range 1 and die (a respawn is cheaper than feeding the keeper).
    if (!guardianNear || creep.hits < creep.hitsMax * 0.4) {
      moveToRoom(creep, op.homeRoom); // fully retreat rather than corner-dance
      return;
    }
  }

  const source = creep.memory.skSourceId
    ? (Game.getObjectById(creep.memory.skSourceId) as Source | null)
    : null;
  if (!source) {
    // No assignment yet, or not enough vision — drift to the centre to gain it.
    const center = new RoomPosition(25, 25, op.roomName);
    if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { range: 5, reusePath: 20 });
    return;
  }

  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { range: 1, reusePath: 20 });
  }
}

function moveToRoom(creep: Creep, targetRoom: string): void {
  const exit = creep.room.findExitTo(targetRoom);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) return;
  const exitPos = creep.pos.findClosestByRange(exit);
  if (exitPos) creep.moveTo(exitPos, { reusePath: 30 });
}

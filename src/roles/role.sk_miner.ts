import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeper } from "../services/services.combat";
import { getSkOp, isOpPaused } from "../orchestrators/orchestrator.sourcekeeper";

const KEEPER_DANGER_RANGE = 4;
// After fleeing a keeper, stay out of the room this long before trying again.
const RETREAT_HOLD_TICKS = 50;
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

  if (isOpPaused(op)) {
    moveToRoom(creep, op.homeRoom);
    return;
  }

  if (creep.room.name !== op.roomName) {
    // Just fled a keeper: wait off the exit instead of walking straight back in.
    if ((creep.memory.retreatUntil ?? 0) > Game.time) {
      if (creep.pos.x <= 2 || creep.pos.x >= 47 || creep.pos.y <= 2 || creep.pos.y >= 47) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 10 });
      }
      return;
    }
    moveToRoom(creep, op.roomName);
    return;
  }

  const keeper = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
    filter: (c) => isSourceKeeper(c),
  });
  if (keeper && creep.pos.getRangeTo(keeper) <= KEEPER_DANGER_RANGE) {
    const guardianNear = creep.pos
      .findInRange(FIND_MY_CREEPS, GUARDIAN_GUARD_RANGE, {
        filter: (c) => c.memory.role === ROLE_SK_GUARDIAN && c.memory.skOpId === op.id,
      })
      .length > 0;
    if (!guardianNear || creep.hits < creep.hitsMax * 0.4) {
      creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS;
      moveToRoom(creep, op.homeRoom);
      return;
    }
  }

  const source = creep.memory.skSourceId
    ? (Game.getObjectById(creep.memory.skSourceId) as Source | null)
    : null;
  if (!source) {
    const center = new RoomPosition(25, 25, op.roomName);
    if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { range: 5, reusePath: 20 });
    return;
  }

  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { range: 1, reusePath: 20 });
  }
}

function moveToRoom(creep: Creep, targetRoom: string): void {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

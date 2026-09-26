import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeper } from "../services/services.combat";
import { getSkOp, isOpPaused } from "../orchestrators/orchestrator.sourcekeeper";

const KEEPER_DANGER_RANGE = 5;
// After fleeing a keeper, stay out of the room this long before trying again.
const RETREAT_HOLD_TICKS = 50;
const GUARDIAN_GUARD_RANGE = 6;
const DELIVER_TTL = 150;

export function runSkHauler(creep: Creep) {
  const opId = creep.memory.skOpId;
  const op = opId !== undefined ? getSkOp(opId) : undefined;
  if (!op) {
    delete creep.memory.skOpId;
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.memory.homeRoom) {
      deposit(creep, creep.memory.homeRoom);
    } else {
      creep.suicide();
    }
    return;
  }

  if (isOpPaused(op)) {
    deposit(creep, op.homeRoom);
    return;
  }

  // Fill up before the trip home, like the remote hauler; near death, bring
  // home whatever is carried.
  const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (creep.memory.working && carried === 0) {
    creep.memory.working = false;
  } else if (
    !creep.memory.working &&
    (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
      (carried > 0 && (creep.ticksToLive ?? Infinity) < DELIVER_TTL))
  ) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    deposit(creep, op.homeRoom);
  } else {
    collect(creep, op);
  }
}

function collect(creep: Creep, op: SourceKeeperOp): void {
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
    if (!guardianNear) {
      creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS;
      moveToRoom(creep, op.homeRoom);
      return;
    }
  }

  const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    ignoreCreeps: true,
    filter: (s): s is StructureContainer =>
      s.structureType === STRUCTURE_CONTAINER &&
      (s as StructureContainer).store[RESOURCE_ENERGY] > 0,
  }) as StructureContainer | null;
  if (container) {
    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(container, { reusePath: 20 });
    }
    return;
  }

  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    ignoreCreeps: true,
    filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount >= 50,
  }) as Resource | null;
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 10 });
    return;
  }

  const center = new RoomPosition(25, 25, op.roomName);
  if (!creep.pos.inRangeTo(center, 6)) creep.moveTo(center, { range: 6, reusePath: 20 });
}

function deposit(creep: Creep, homeRoom: string): void {
  if (creep.room.name !== homeRoom) {
    moveToRoom(creep, homeRoom);
    return;
  }
  const storage = creep.room.storage;
  const target =
    storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ? storage
      : (creep.pos.findClosestByPath(FIND_STRUCTURES, {
          ignoreCreeps: true,
          filter: (s): s is AnyStoreStructure =>
            (s.structureType === STRUCTURE_CONTAINER ||
              s.structureType === STRUCTURE_STORAGE) &&
            "store" in s &&
            (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        }) as AnyStoreStructure | null);
  if (target) {
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 50 });
    }
    return;
  }
  const spawn = creep.room
    .find(FIND_MY_SPAWNS)
    .find((s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn, { reusePath: 50 });
    }
  }
}

function moveToRoom(creep: Creep, targetRoom: string): void {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

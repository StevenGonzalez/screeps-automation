import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeper } from "../services/services.combat";
import { getSkOp, isOpPaused } from "../orchestrators/orchestrator.sourcekeeper";

/**
 * Carrier: hauls energy from a Source Keeper room back to the home storage. Collects
 * dropped energy and from any containers near the sources, and falls back to home
 * (carrying whatever it has) when a keeper closes in without a guardian, or when an
 * enemy player contests the room. It has no combat parts.
 */
const KEEPER_DANGER_RANGE = 5;
const GUARDIAN_GUARD_RANGE = 6;

export function runSkHauler(creep: Creep) {
  const opId = creep.memory.skOpId;
  const op = opId !== undefined ? getSkOp(opId) : undefined;
  if (!op) {
    // Op gone — deliver any cargo home before retiring, don't throw it away.
    delete creep.memory.skOpId;
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.memory.homeRoom) {
      deposit(creep, creep.memory.homeRoom);
    } else {
      creep.suicide();
    }
    return;
  }

  // Contested — get the cargo (and the creep) home.
  if (isOpPaused(op)) {
    deposit(creep, op.homeRoom);
    return;
  }

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    collect(creep, op);
  } else {
    deposit(creep, op.homeRoom);
  }
}

function collect(creep: Creep, op: SourceKeeperOp): void {
  if (creep.room.name !== op.roomName) {
    moveToRoom(creep, op.roomName);
    return;
  }

  // Flee the room when a keeper closes in and no guardian is covering us.
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
      moveToRoom(creep, op.homeRoom);
      return;
    }
  }

  // Containers near sources first, then dropped piles.
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

  // Nothing to grab yet — wait near the centre, clear of the lairs.
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
  // Storage and all containers are full — offload into a spawn that still has room so the
  // hauler doesn't park beside a spawn holding a full load forever (which stalls the whole
  // SK haul). If everything is full too, idle (rare; nothing to do but wait).
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
  // Route to the target room centre via PathFinder's multi-room pathing. Aiming moveTo at a
  // bare exit tile (findExitTo + findClosestByRange) parks creeps on the border or bounces
  // them between two rooms — see role.reserver.ts / role.remote_miner.ts.
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

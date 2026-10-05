import { ROLE_DEPOSIT_MINER } from "../config/config.roles";
import { heraldCaravan } from "../services/services.herald";

// Ticks per room of travel home, plus slack for the last leg to storage.
const TICKS_PER_ROOM = 50;
const RETURN_SLACK = 50;

export function runDepositHauler(creep: Creep) {
  if (creep.store.getFreeCapacity() === 0) { deliverHome(creep); return; }

  const opId = creep.memory.depositOpId;
  const op = opId !== undefined
    ? (Memory.depositOps ?? []).find((o) => o.id === opId)
    : undefined;

  if (!op || op.phase === "done") {
    if (creep.store.getUsedCapacity() > 0) { deliverHome(creep); return; }
    creep.suicide();
    return;
  }

  if (creep.room.name !== op.roomName) {
    travelToRoom(creep, op.roomName);
    return;
  }

  // Head home only when full (checked above) or when waiting longer would
  // leave too little life for the trip back.
  if (creep.store.getUsedCapacity() > 0 && (creep.ticksToLive ?? Infinity) < returnTripTicks(creep)) {
    deliverHome(creep);
    return;
  }

  const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (r) => r.resourceType === op.depositType,
  });
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped, { reusePath: 5, visualizePathStyle: {} });
    }
    return;
  }

  const holder = [
    ...creep.room.find(FIND_TOMBSTONES),
    ...creep.room.find(FIND_RUINS),
  ].find((h) => (h.store[op.depositType] ?? 0) > 0);
  if (holder) {
    if (creep.withdraw(holder, op.depositType) === ERR_NOT_IN_RANGE) {
      creep.moveTo(holder, { reusePath: 5, visualizePathStyle: {} });
    }
    return;
  }

  // Nothing loose to collect: wait beside the miner so it can hand over cargo.
  const miner = creep.room
    .find(FIND_MY_CREEPS)
    .find((c) => c.memory.role === ROLE_DEPOSIT_MINER && c.memory.depositOpId === op.id);
  const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
  if (miner) {
    if (!creep.pos.isNearTo(miner)) creep.moveTo(miner, { range: 1, reusePath: 5, visualizePathStyle: {} });
  } else if (deposit && creep.pos.getRangeTo(deposit) > 2) {
    creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
  }
}

function returnTripTicks(creep: Creep): number {
  const home = creep.memory.homeRoom;
  if (!home) return RETURN_SLACK;
  return Game.map.getRoomLinearDistance(creep.room.name, home) * TICKS_PER_ROOM + RETURN_SLACK;
}

function deliverHome(creep: Creep) {
  const home = creep.memory.homeRoom;
  if (home && creep.room.name !== home) { travelToRoom(creep, home); return; }
  const target = creep.room.storage ?? creep.room.terminal;
  if (!target) return;
  const res = Object.keys(creep.store)[0] as ResourceConstant | undefined;
  if (!res) return;
  const amount = creep.store[res];
  const result = creep.transfer(target, res);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
  } else if (result === OK && home && creep.memory.targetRoom) {
    heraldCaravan(home, creep.memory.targetRoom, res, amount);
  }
}

function travelToRoom(creep: Creep, roomName: string | undefined) {
  if (!roomName || creep.room.name === roomName) return;
  creep.moveTo(new RoomPosition(25, 25, roomName), {
    reusePath: 10,
    range: 20,
    visualizePathStyle: {},
  });
}

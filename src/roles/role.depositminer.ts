import { ROLE_DEPOSIT_HAULER } from "../config/config.roles";

export function runDepositMiner(creep: Creep) {
  const opId = creep.memory.depositOpId;
  if (opId === undefined) { creep.suicide(); return; }

  const op = (Memory.depositOps ?? []).find((o) => o.id === opId);
  if (!op || op.phase === "done") { deliverAndRetire(creep); return; }

  if (creep.room.name !== op.roomName) {
    travelToRoom(creep, op.roomName);
    return;
  }

  const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
  if (!deposit) return;

  // Hand cargo straight to an adjacent hauler of this op whenever one is here.
  // Without one, hold it until the next harvest wouldn't fit, then drop, since
  // a ground pile decays while the hauler is away. Harvest is a separate
  // intent, so either costs no mining time.
  const harvestYield = creep.getActiveBodyparts(WORK) * HARVEST_DEPOSIT_POWER;
  if ((creep.store[op.depositType] ?? 0) > 0) {
    const hauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
      filter: (c) =>
        c.memory.role === ROLE_DEPOSIT_HAULER &&
        c.memory.depositOpId === opId &&
        c.store.getFreeCapacity() > 0,
    })[0];
    if (hauler) creep.transfer(hauler, op.depositType);
    else if (creep.store.getFreeCapacity() < harvestYield) creep.drop(op.depositType);
  }

  if (creep.pos.getRangeTo(deposit) > 1) {
    creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
    return;
  }
  creep.harvest(deposit);
}

function deliverAndRetire(creep: Creep) {
  if (creep.store.getUsedCapacity() === 0) { creep.suicide(); return; }
  const home = creep.memory.homeRoom;
  if (home && creep.room.name !== home) { travelToRoom(creep, home); return; }
  const target = creep.room.storage ?? creep.room.terminal;
  if (!target) { creep.suicide(); return; }
  const res = Object.keys(creep.store)[0] as ResourceConstant | undefined;
  if (!res) { creep.suicide(); return; }
  if (creep.transfer(target, res) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
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

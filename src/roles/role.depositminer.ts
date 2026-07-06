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

  if (creep.store.getFreeCapacity() === 0) creep.drop(op.depositType);

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

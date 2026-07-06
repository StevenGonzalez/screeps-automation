// Carter — ferries a deposit's raw resource from the highway room back home to storage,
// where the factory consumes it for tier-2 commodities. Picks up the piles the quarrier
// drops; once full (or the op ends) it delivers and returns.

export function runDepositHauler(creep: Creep) {
  // A full load goes home first, regardless of op state.
  if (creep.store.getFreeCapacity() === 0) { deliverHome(creep); return; }

  const opId = creep.memory.depositOpId;
  const op = opId !== undefined
    ? (Memory.depositOps ?? []).find((o) => o.id === opId)
    : undefined;

  if (!op || op.phase === "done") {
    // Op finished — deliver whatever we carry, then retire.
    if (creep.store.getUsedCapacity() > 0) { deliverHome(creep); return; }
    creep.suicide();
    return;
  }

  if (creep.room.name !== op.roomName) {
    travelToRoom(creep, op.roomName);
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

  // Nothing to grab yet: take a partial load home, otherwise stage by the deposit so the
  // next dropped pile is collected the moment it lands.
  if (creep.store.getUsedCapacity() > 0) { deliverHome(creep); return; }
  const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
  if (deposit && creep.pos.getRangeTo(deposit) > 2) {
    creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
  }
}

function deliverHome(creep: Creep) {
  const home = creep.memory.homeRoom;
  if (home && creep.room.name !== home) { travelToRoom(creep, home); return; }
  const target = creep.room.storage ?? creep.room.terminal;
  if (!target) return;
  const res = Object.keys(creep.store)[0] as ResourceConstant | undefined;
  if (!res) return;
  if (creep.transfer(target, res) === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
  }
}

function travelToRoom(creep: Creep, roomName: string | undefined) {
  if (!roomName || creep.room.name === roomName) return;
  // Route to the room centre via PathFinder's multi-room pathing. Aiming moveTo at a bare exit
  // tile (findExitTo + findClosestByRange) parks creeps on the border or bounces them between
  // two rooms — see role.reserver.ts / role.remote_miner.ts.
  creep.moveTo(new RoomPosition(25, 25, roomName), {
    reusePath: 10,
    range: 20,
    visualizePathStyle: {},
  });
}

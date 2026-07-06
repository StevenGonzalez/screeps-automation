// Quarrier — works a highway deposit (silicon/metal/biomass/mist). One WORK-heavy miner
// per deposit: harvesting triggers a deposit-wide cooldown, so a single big body out-yields
// several small ones. It accumulates into its CARRY buffer and drops the load when full so
// harvesting never stalls; the carter hauls the dropped piles home.

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
  if (!deposit) return; // gone — the orchestrator ends the op once it confirms with vision

  // Drop the buffer when full so the carter can collect it and we keep harvesting.
  if (creep.store.getFreeCapacity() === 0) creep.drop(op.depositType);

  if (creep.pos.getRangeTo(deposit) > 1) {
    creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
    return;
  }
  // ERR_TIRED during the deposit cooldown is expected — just hold the tile and retry.
  creep.harvest(deposit);
}

// Op over: carry any buffered resource home, then suicide.
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
  // Route to the room centre via PathFinder's multi-room pathing. Aiming moveTo at a bare exit
  // tile (findExitTo + findClosestByRange) parks creeps on the border or bounces them between
  // two rooms — see role.reserver.ts / role.remote_miner.ts.
  creep.moveTo(new RoomPosition(25, 25, roomName), {
    reusePath: 10,
    range: 20,
    visualizePathStyle: {},
  });
}

import { seekBoost, isSourceKeeper } from "../services/services.combat";
import { getSkOp, isOpPaused } from "../orchestrators/orchestrator.sourcekeeper";

const KITE_RANGE = 3;

export function runSkGuardian(creep: Creep) {
  if ((creep.memory.boostCompound || creep.memory.boostQueue?.length) && seekBoost(creep)) return;

  const opId = creep.memory.skOpId;
  const op = opId !== undefined ? getSkOp(opId) : undefined;
  if (!op) {
    delete creep.memory.skOpId;
    idleAtSpawn(creep);
    return;
  }

  if (isOpPaused(op)) {
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    if (creep.room.name !== op.homeRoom) moveToRoom(creep, op.homeRoom);
    return;
  }

  if (creep.room.name !== op.roomName) {
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    moveToRoom(creep, op.roomName);
    return;
  }

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) => isSourceKeeper(c) || c.owner.username === "Invader",
  });

  healSelfOrAlly(creep);

  const target = creep.pos.findClosestByRange(hostiles);
  if (target) {
    const range = creep.pos.getRangeTo(target);
    const cluster = creep.pos.findInRange(hostiles, KITE_RANGE);
    if (cluster.length >= 2 || range === 1) creep.rangedMassAttack();
    else creep.rangedAttack(target);

    if (range < KITE_RANGE) creep.move(target.pos.getDirectionTo(creep.pos));
    else if (range > KITE_RANGE) creep.moveTo(target, { range: KITE_RANGE, reusePath: 3 });
    return;
  }

  const lairs = creep.room.find(FIND_STRUCTURES, {
    filter: (s): s is StructureKeeperLair => s.structureType === STRUCTURE_KEEPER_LAIR,
  });
  const pending = lairs.filter((l) => l.ticksToSpawn !== undefined);
  if (pending.length > 0) {
    const next = pending.reduce((a, b) => (a.ticksToSpawn! < b.ticksToSpawn! ? a : b));
    if (!creep.pos.isNearTo(next)) creep.moveTo(next, { range: 1, reusePath: 10 });
    return;
  }

  const center = new RoomPosition(25, 25, op.roomName);
  if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { range: 5, reusePath: 20 });
}

function healSelfOrAlly(creep: Creep): void {
  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
    return;
  }
  const ally = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
    filter: (c) => c.hits < c.hitsMax,
  })[0];
  if (!ally) return;
  if (creep.pos.isNearTo(ally)) creep.heal(ally);
  else creep.rangedHeal(ally);
}

function idleAtSpawn(creep: Creep): void {
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) creep.moveTo(spawn, { reusePath: 20 });
}

function moveToRoom(creep: Creep, targetRoom: string): void {
  creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

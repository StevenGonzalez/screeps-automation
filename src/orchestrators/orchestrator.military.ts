import { ROLE_KNIGHT, ROLE_WIZARD, ROLE_CLERIC } from "../config/config.roles";

const RETREAT_HP_THRESHOLD = 0.20;
const RALLY_RANGE = 8;
const CLEARED_TICKS_NEEDED = 10;
const FORMING_TIMEOUT = 1500;
const KITE_RANGE = 3;

// ── Main loop ─────────────────────────────────────────────────────────────────

export function loop(): void {
  const op = Memory.militaryOp;
  if (!op) return;

  const homeRoom = Game.rooms[op.homeRoom];
  if (!homeRoom?.controller?.my) return;

  const members = getSquadMembers(op);

  switch (op.phase) {
    case "forming":    runForming(op, members); break;
    case "rallying":   runRallying(op, homeRoom, members); break;
    case "attacking":  runAttacking(op, members); break;
    case "retreating": runRetreating(op, homeRoom, members); break;
  }
}

// ── Phase logic ───────────────────────────────────────────────────────────────

function runForming(op: MilitaryOp, members: Creep[]): void {
  if (Game.time - op.startedAt > FORMING_TIMEOUT) {
    console.log(`[Military] ${op.targetRoom}: Forming timeout — squad could not be assembled, aborting`);
    cancelOp();
    return;
  }

  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Squad formed (${members.length} creeps) — rallying at spawn`);
  }
}

function runRallying(op: MilitaryOp, homeRoom: Room, members: Creep[]): void {
  if (!squadMet(op, members)) {
    op.phase = "forming";
    console.log(`[Military] ${op.targetRoom}: Squad incomplete during rally — reforming`);
    return;
  }

  const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return;

  const allRallied = members.every(
    (c) => c.room.name === op.homeRoom && c.pos.getRangeTo(spawn) <= RALLY_RANGE
  );

  if (allRallied) {
    op.phase = "attacking";
    console.log(`[Military] ${op.targetRoom}: Squad rallied — ATTACK!`);
  }
}

function runAttacking(op: MilitaryOp, members: Creep[]): void {
  if (members.length === 0) {
    op.phase = "forming";
    op.clearedSince = undefined;
    console.log(`[Military] ${op.targetRoom}: All squad members lost — reforming`);
    return;
  }

  const needsRetreat = members.some((c) => c.hits < c.hitsMax * RETREAT_HP_THRESHOLD);
  if (needsRetreat) {
    op.phase = "retreating";
    op.clearedSince = undefined;
    console.log(`[Military] ${op.targetRoom}: Heavy casualties — retreating to regroup`);
    return;
  }

  const targetRoom = Game.rooms[op.targetRoom];
  if (targetRoom) {
    const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) {
      if (!op.clearedSince) {
        op.clearedSince = Game.time;
      } else if (Game.time - op.clearedSince >= CLEARED_TICKS_NEEDED) {
        console.log(`[Military] ${op.targetRoom}: Room cleared! Operation complete.`);
        completeOp(op);
      }
    } else {
      op.clearedSince = undefined;
    }
  }
}

function runRetreating(op: MilitaryOp, homeRoom: Room, members: Creep[]): void {
  if (members.length === 0) {
    op.phase = "forming";
    return;
  }

  const allHome = members.every((c) => c.room.name === op.homeRoom);
  if (!allHome) return;

  if (squadMet(op, members)) {
    op.phase = "rallying";
    console.log(`[Military] ${op.targetRoom}: Regrouped — re-rallying for another push`);
  } else {
    op.phase = "forming";
    console.log(`[Military] ${op.targetRoom}: Squad depleted after retreat — reforming`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
  );
}

function squadMet(op: MilitaryOp, members: Creep[]): boolean {
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length >= op.requiredKnights &&
    members.filter((c) => c.memory.role === ROLE_WIZARD).length >= op.requiredWizards &&
    members.filter((c) => c.memory.role === ROLE_CLERIC).length >= op.requiredClerics
  );
}

function completeOp(op: MilitaryOp): void {
  clearSquadTargets(op.targetRoom);
  delete Memory.militaryOp;
}

function clearSquadTargets(targetRoom: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.offensiveTarget === targetRoom) {
      delete creep.memory.offensiveTarget;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function cancelOp(): void {
  const op = Memory.militaryOp;
  if (!op) return;
  clearSquadTargets(op.targetRoom);
  delete Memory.militaryOp;
}

// ── Per-creep offensive behavior (called from role files) ─────────────────────

export function runOffensiveKnight(creep: Creep, op: MilitaryOp): void {
  if (op.phase === "forming" || op.phase === "rallying") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "retreating") {
    retreatToHome(creep, op.homeRoom);
    return;
  }

  // attacking phase: travel to target room then fight
  if (creep.room.name !== op.targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 5 });
    return;
  }

  // Seek a cleric if critically injured rather than pressing the attack
  if (creep.hits < creep.hitsMax * RETREAT_HP_THRESHOLD) {
    const cleric = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (c: Creep) =>
        c.memory.role === ROLE_CLERIC && c.memory.offensiveTarget === op.targetRoom,
    });
    if (cleric && !creep.pos.isNearTo(cleric)) {
      creep.moveTo(cleric, { reusePath: 3 });
      return;
    }
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const center = new RoomPosition(25, 25, op.targetRoom);
    if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { reusePath: 20 });
    return;
  }
  if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
    creep.moveTo(hostile, { reusePath: 3 });
  }
}

export function runOffensiveWizard(creep: Creep, op: MilitaryOp): void {
  if (op.phase === "forming" || op.phase === "rallying") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "retreating") {
    retreatToHome(creep, op.homeRoom);
    return;
  }

  if (creep.room.name !== op.targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 5 });
    return;
  }

  const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
  if (!hostile) {
    const center = new RoomPosition(25, 25, op.targetRoom);
    if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { reusePath: 20 });
    return;
  }

  const range = creep.pos.getRangeTo(hostile);
  const inRangeHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);

  if (inRangeHostiles.length >= 3) {
    creep.rangedMassAttack();
  } else if (range <= KITE_RANGE) {
    creep.rangedAttack(hostile);
  }

  if (range < KITE_RANGE) {
    creep.move(hostile.pos.getDirectionTo(creep.pos));
  } else if (range > KITE_RANGE + 1) {
    creep.moveTo(hostile, { range: KITE_RANGE, reusePath: 5 });
  }
}

export function runOffensiveCleric(creep: Creep, op: MilitaryOp): void {
  if (op.phase === "forming" || op.phase === "rallying") {
    parkNearHomeSpawn(creep, op.homeRoom);
    return;
  }

  if (op.phase === "retreating") {
    creep.heal(creep);
    retreatToHome(creep, op.homeRoom);
    return;
  }

  // In transit: heal self
  if (creep.room.name !== op.targetRoom) {
    creep.heal(creep);
    creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 5 });
    return;
  }

  // In target room: heal most-injured squad member
  const injured = creep.room.find(FIND_MY_CREEPS, {
    filter: (c) =>
      (c.memory.offensiveTarget === op.targetRoom || c.id === creep.id) &&
      c.hits < c.hitsMax,
  });

  if (injured.length === 0) {
    // No injuries — shadow the lead knight
    const knight = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (c: Creep) =>
        c.memory.role === ROLE_KNIGHT && c.memory.offensiveTarget === op.targetRoom,
    });
    if (knight && !creep.pos.isNearTo(knight)) {
      creep.moveTo(knight, { reusePath: 5 });
    } else {
      const center = new RoomPosition(25, 25, op.targetRoom);
      if (!creep.pos.inRangeTo(center, 5)) creep.moveTo(center, { reusePath: 20 });
    }
    return;
  }

  const target = injured.reduce((a, b) =>
    a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b
  );

  const dist = creep.pos.getRangeTo(target);
  if (dist <= 1) {
    creep.heal(target);
  } else {
    if (dist <= 3) creep.rangedHeal(target);
    creep.moveTo(target, { reusePath: 3 });
  }
}

// ── Movement helpers ──────────────────────────────────────────────────────────

function parkNearHomeSpawn(creep: Creep, homeRoomName: string): void {
  if (creep.room.name !== homeRoomName) {
    creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 10 });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > RALLY_RANGE) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}

function retreatToHome(creep: Creep, homeRoomName: string): void {
  if (creep.room.name !== homeRoomName) {
    creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 5 });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && !creep.pos.isNearTo(spawn)) {
    creep.moveTo(spawn, { reusePath: 20 });
  }
}

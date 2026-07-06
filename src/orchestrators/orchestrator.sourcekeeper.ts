import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeperRoom } from "../services/services.combat";

export const SK_CONTEST_COOLDOWN = 1000;
const SK_DISCOVERY_TIMEOUT = 3000;
const SK_MIN_HOME_RCL = 7;
const SK_MIN_HOME_ENERGY = 40_000;
const SK_MIN_HOME_CAPACITY = 2_500;

export const SK_MAX_CONCURRENT = 4;
export const SK_MAX_PER_HOME = 2;

export function loop(): void {
  const ops = Memory.skOps;
  if (!ops || ops.length === 0) return;
  for (const op of ops) updateOp(op);
  const survivors = ops.filter((op) => {
    if (op.discovered || Game.time - op.startedAt <= SK_DISCOVERY_TIMEOUT) return true;
    console.log(`[SK] ${op.roomName}: never reached the room within ${SK_DISCOVERY_TIMEOUT} ticks - abandoning`);
    for (const name in Game.creeps) {
      if (Game.creeps[name].memory.skOpId === op.id) {
        delete Game.creeps[name].memory.skOpId;
        delete Game.creeps[name].memory.skSourceId;
      }
    }
    return false;
  });
  if (survivors.length !== ops.length) Memory.skOps = survivors;
}

function updateOp(op: SourceKeeperOp): void {
  const room = Game.rooms[op.roomName];

  if (room && !op.discovered) {
    op.sourceIds = room.find(FIND_SOURCES).map((s) => s.id);
    op.discovered = true;
    console.log(`[SK] ${op.roomName}: discovered ${op.sourceIds.length} sources`);
  }

  if (room) {
    const playerHostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) =>
        c.owner.username !== "Source Keeper" && c.owner.username !== "Invader",
    });
    if (playerHostiles.length > 0) op.lastFailure = Game.time;
  }

  const guardianAlive = getSkMembers(op.id).some(
    (c) => c.memory.role === ROLE_SK_GUARDIAN
  );
  op.phase = guardianAlive && op.discovered ? "active" : "forming";
}

export function isOpPaused(op: SourceKeeperOp): boolean {
  return op.lastFailure !== undefined && Game.time - op.lastFailure < SK_CONTEST_COOLDOWN;
}

export function getSkMembers(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    if (Game.creeps[name].memory.skOpId === opId) result.push(Game.creeps[name]);
  }
  return result;
}

export function getSkOp(id: number): SourceKeeperOp | undefined {
  return Memory.skOps?.find((o) => o.id === id);
}

export function launchSkOp(roomName: string): string | null {
  if (!isSourceKeeperRoom(roomName)) return `${roomName} is not a Source Keeper room`;

  if (!Memory.skOps) Memory.skOps = [];
  if (Memory.skOps.some((o) => o.roomName === roomName)) {
    return `already mining ${roomName}`;
  }

  if (Memory.skOps.length >= SK_MAX_CONCURRENT) {
    return `at the empire-wide SK op limit (${SK_MAX_CONCURRENT}) - cancel one first`;
  }

  const opsPerHome: Record<string, number> = {};
  for (const o of Memory.skOps) opsPerHome[o.homeRoom] = (opsPerHome[o.homeRoom] ?? 0) + 1;

  const candidates = Object.values(Game.rooms).filter(
    (r) =>
      r.controller?.my &&
      (r.controller.level ?? 0) >= SK_MIN_HOME_RCL &&
      (r.storage?.store[RESOURCE_ENERGY] ?? 0) >= SK_MIN_HOME_ENERGY &&
      r.energyCapacityAvailable >= SK_MIN_HOME_CAPACITY &&
      (opsPerHome[r.name] ?? 0) < SK_MAX_PER_HOME
  );
  if (candidates.length === 0) {
    return `no owned room at RCL ${SK_MIN_HOME_RCL}+ with ${SK_MIN_HOME_ENERGY}+ stored energy, ${SK_MIN_HOME_CAPACITY}+ spawn capacity, and free SK capacity to fund it`;
  }

  const home = candidates.reduce((best, r) =>
    Game.map.getRoomLinearDistance(r.name, roomName) <
    Game.map.getRoomLinearDistance(best.name, roomName)
      ? r
      : best
  );
  if (Game.map.getRoomLinearDistance(home.name, roomName) > 2) {
    return `nearest capable home with free SK capacity (${home.name}) is too far from ${roomName}`;
  }

  if (!Memory.nextSkOpId) Memory.nextSkOpId = 1;
  Memory.skOps.push({
    id: Memory.nextSkOpId++,
    roomName,
    homeRoom: home.name,
    phase: "forming",
    startedAt: Game.time,
    discovered: false,
    sourceIds: [],
  });
  return null;
}

export function cancelSkOp(roomName: string): boolean {
  if (!Memory.skOps) return false;
  const op = Memory.skOps.find((o) => o.roomName === roomName);
  if (!op) return false;
  for (const name in Game.creeps) {
    if (Game.creeps[name].memory.skOpId === op.id) {
      delete Game.creeps[name].memory.skOpId;
      delete Game.creeps[name].memory.skSourceId;
    }
  }
  Memory.skOps = Memory.skOps.filter((o) => o.id !== op.id);
  return true;
}

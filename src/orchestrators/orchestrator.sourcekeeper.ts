/**
 * Source Keeper mining. SK rooms hold 2-3 sources (4000 energy, ~3× a normal remote)
 * plus a mineral, guarded by Source Keepers that respawn from lairs. This orchestrator
 * runs persistent operations: a Huntsman guardian clears and camps the keeper lairs
 * while Delvers mine the sources and Wains haul the energy home.
 *
 * Operations are commanded from the console (Game.arca.sk) rather than auto-started —
 * SK rooms vary wildly in difficulty and committing blind is how squads get fed to
 * keepers. The orchestrator only manages lifecycle: source discovery, phase, and
 * pausing when an enemy player contests the room.
 */
import { ROLE_SK_GUARDIAN } from "../config/config.roles";
import { isSourceKeeperRoom } from "../services/services.combat";

// Min ticks an op pauses spawning after spotting an enemy player in the room.
export const SK_CONTEST_COOLDOWN = 1000;
// Abandon an op that can't even get eyes on the room (guardian never arrives) so it
// stops blocking re-launch and burning guardian spawns into a death trap.
const SK_DISCOVERY_TIMEOUT = 3000;
const SK_MIN_HOME_RCL = 7;
const SK_MIN_HOME_ENERGY = 40_000;

// Concurrency bounds. SK ops are funded per home room and never conflict across
// different homes, so multiple run in parallel — but each op spawns a guardian +
// a delver/wain per source, so we cap the total empire-wide (CPU/spawn pressure)
// and per home room (one home can't sustain three SK squads at once).
export const SK_MAX_CONCURRENT = 4;       // empire-wide ceiling
export const SK_MAX_PER_HOME = 2;         // ceiling per funding home room

export function loop(): void {
  const ops = Memory.skOps;
  if (!ops || ops.length === 0) return;
  for (const op of ops) updateOp(op);
  // Drop ops that never gained vision of their room within the timeout.
  const survivors = ops.filter((op) => {
    if (op.discovered || Game.time - op.startedAt <= SK_DISCOVERY_TIMEOUT) return true;
    console.log(`[SK] ${op.roomName}: never reached the room within ${SK_DISCOVERY_TIMEOUT} ticks — abandoning`);
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

  // Discover sources the first time we can see the room.
  if (room && !op.discovered) {
    op.sourceIds = room.find(FIND_SOURCES).map((s) => s.id);
    op.discovered = true;
    console.log(`[SK] ${op.roomName}: discovered ${op.sourceIds.length} sources`);
  }

  // Pause the op while an enemy player contests the room (keepers/invaders are fine).
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

// ── Console API ─────────────────────────────────────────────────────────────────

// Starts an SK mining op against `roomName`, funded by the nearest capable owned room.
// Returns an error string, or null on success.
export function launchSkOp(roomName: string): string | null {
  if (!isSourceKeeperRoom(roomName)) return `${roomName} is not a Source Keeper room`;

  if (!Memory.skOps) Memory.skOps = [];
  if (Memory.skOps.some((o) => o.roomName === roomName)) {
    return `already mining ${roomName}`;
  }

  // Empire-wide concurrency ceiling.
  if (Memory.skOps.length >= SK_MAX_CONCURRENT) {
    return `at the empire-wide SK op limit (${SK_MAX_CONCURRENT}) — cancel one first`;
  }

  // Count active ops per home room so we can skip homes already at their cap.
  const opsPerHome: Record<string, number> = {};
  for (const o of Memory.skOps) opsPerHome[o.homeRoom] = (opsPerHome[o.homeRoom] ?? 0) + 1;

  const candidates = Object.values(Game.rooms).filter(
    (r) =>
      r.controller?.my &&
      (r.controller.level ?? 0) >= SK_MIN_HOME_RCL &&
      (r.storage?.store[RESOURCE_ENERGY] ?? 0) >= SK_MIN_HOME_ENERGY &&
      (opsPerHome[r.name] ?? 0) < SK_MAX_PER_HOME
  );
  if (candidates.length === 0) {
    return `no owned room at RCL ${SK_MIN_HOME_RCL}+ with ${SK_MIN_HOME_ENERGY}+ stored energy and free SK capacity to fund it`;
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

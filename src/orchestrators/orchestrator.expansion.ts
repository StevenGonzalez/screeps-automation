import { getThreatInfo } from "../services/services.combat";

// Closes the growth loop: when GCL frees a colony slot and a healthy home room
// can fund it, automatically claim the best scouted candidate — no console command.
// Reuses the existing Memory.expansion state machine (claiming → bootstrapping →
// established) untouched; this orchestrator only *sets* Memory.expansion, exactly
// as Game.arca.claim() does. Disabled by default; toggle with Game.arca.autoexpand(true).

const EXPANSION_CANDIDATE_SOURCES_WEIGHT = 40;
const EXPANSION_CANDIDATE_DIST_PENALTY = 5;

// Only re-evaluate occasionally — candidates change slowly and ranking is cheap,
// but there's no reason to scan every tick.
const AUTO_EXPAND_CHECK_INTERVAL = 50;

// A funding room must clear these bars before it's allowed to seed a colony, so
// auto-expansion never overextends into a room it can't defend or develop.
const MIN_HOME_RCL = 4;                 // RCL 4 = storage + ≥1300 energy capacity
const MIN_HOME_STORAGE_ENERGY = 50_000; // buffer left after funding conqueror + settlers
const MIN_BUCKET = 5_000;               // don't start a multi-hundred-tick op when CPU-starved

export interface ExpansionCandidate {
  room: string;
  homeRoom: string;
  score: number;
  sources: number;
  dist: number;
}

// Rank non-hostile, unowned rooms from every owned room's scout data. Shared with
// Game.arca.expand() so the console and the auto-expander always agree on choice.
export function rankExpansionCandidates(): ExpansionCandidate[] {
  const candidates: ExpansionCandidate[] = [];

  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    for (const remote of room.memory.remoteRooms ?? []) {
      if (remote.hostile) continue;
      const targetRoom = Game.rooms[remote.roomName];
      if (targetRoom?.controller?.my) continue; // already ours
      if (targetRoom?.controller?.owner) continue; // someone else's
      const dist = Game.map.getRoomLinearDistance(rn, remote.roomName);
      const score =
        remote.sources.length * EXPANSION_CANDIDATE_SOURCES_WEIGHT -
        dist * EXPANSION_CANDIDATE_DIST_PENALTY;
      candidates.push({
        room: remote.roomName,
        homeRoom: rn,
        score,
        sources: remote.sources.length,
        dist,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// A home room healthy enough to seed and defend a child colony.
function isHomeRoomHealthy(room: Room): boolean {
  if (!room.controller?.my) return false;
  if ((room.controller.level ?? 0) < MIN_HOME_RCL) return false;
  if ((room.storage?.store[RESOURCE_ENERGY] ?? 0) < MIN_HOME_STORAGE_ENERGY) return false;
  // Don't fund expansion while the funding room is itself under attack.
  if (getThreatInfo(room).score > 0) return false;
  return true;
}

export function loop() {
  if (Memory.autoExpand !== true) return;
  if (Game.time % AUTO_EXPAND_CHECK_INTERVAL !== 0) return;

  // Never start a second expansion — let the active one finish (the memory
  // orchestrator clears the record ~1000 ticks after "established").
  if (Memory.expansion) return;

  if (Game.cpu.bucket < MIN_BUCKET) return;

  // GCL headroom: only expand if the global level allows another room.
  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (Game.gcl.level <= ownedRooms.length) return;

  // Pick the highest-scoring candidate whose funding room is healthy.
  for (const cand of rankExpansionCandidates()) {
    const home = Game.rooms[cand.homeRoom];
    if (!home || !isHomeRoomHealthy(home)) continue;

    Memory.expansion = {
      roomName: cand.room,
      homeRoom: cand.homeRoom,
      phase: "claiming",
      startedAt: Game.time,
    };
    console.log(
      `[AutoExpand] Claiming ${cand.room} (score=${cand.score}, sources=${cand.sources}, ` +
      `dist=${cand.dist}) funded by ${cand.homeRoom} — GCL ${Game.gcl.level}/${ownedRooms.length + 1}`
    );
    return;
  }
}

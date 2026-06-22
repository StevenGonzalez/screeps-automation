/**
 * Central strategy coordinator: sets the empire-wide posture once per tick and
 * publishes it to Memory.empire, which the other systems (expansion, military,
 * spawning, towers) READ to gate their behavior. This orchestrator only computes
 * and publishes posture — it never gates those systems directly.
 *
 * Posture precedence (highest wins): RECOVER > TURTLE > WAR > EXPAND.
 *   RECOVER — CPU bucket critically low, OR an owned room lost its last spawn /
 *             is critically crippled, OR multiple owned rooms simultaneously under
 *             HIGH threat. Stop expanding, conserve, rebuild.
 *   TURTLE  — at least one owned room under HIGH threat but the empire is otherwise
 *             functional. Prioritize defense, pause expansion.
 *   WAR     — economy healthy AND the WarCouncil has set Memory.empire.warTargetRoom
 *             (we only READ it). An offensive campaign is sanctioned.
 *   EXPAND  — default: healthy, no major threats, no active war target.
 *
 * Per-room overrides: a single threatened owned room is marked roomPosture[room] =
 * "TURTLE" even when the empire as a whole stays EXPAND/WAR. Stale entries (rooms no
 * longer threatened) are cleared each tick.
 *
 * Systems treat a missing Memory.empire as posture "EXPAND" (the safe default).
 */

import { getThreatSeverity } from "../services/services.combat";

// CPU bucket below this means the game is about to throttle us — fall back to RECOVER
// so we stop spending on expansion/offense and let the bucket refill.
const BUCKET_RECOVER_THRESHOLD = 3000;

// Hysteresis: once in RECOVER, stay there until the bucket climbs back above this higher
// mark, so posture can't flap EXPAND↔RECOVER every few ticks around the entry threshold.
const BUCKET_RECOVER_EXIT = 6000;

// Posture moves slowly; recompute every few ticks rather than every tick to avoid an
// every-tick owned-room scan and a Memory.empire rewrite (which dirties Memory — a per-tick
// serialize cost) on a CPU-constrained account.
const STRATEGY_INTERVAL = 5;

// Two or more owned rooms under HIGH threat at once is an empire-wide emergency
// (not a single-room defense), so the whole empire goes RECOVER.
const MULTI_THREAT_RECOVER_COUNT = 2;

export function loop() {
  // Throttled: posture is slow-moving, so recompute it every STRATEGY_INTERVAL ticks. The
  // bucket can't crater within a handful of ticks, so RECOVER still engages in time.
  if (Game.time % STRATEGY_INTERVAL !== 0) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);

  // Per-room threat severity (computed once, reused below).
  const highThreatRooms: string[] = [];
  let crippled = false;
  for (const room of ownedRooms) {
    // A room that is mine but has lost its last spawn is critically crippled: it can
    // no longer raise creeps to defend or rebuild itself.
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) crippled = true;

    if (getThreatSeverity(room) === "high") highThreatRooms.push(room.name);
  }

  const bucket = typeof Game.cpu.bucket === "number" ? Game.cpu.bucket : Number.POSITIVE_INFINITY;
  // Hysteresis: if we're already recovering, require the bucket to climb past the higher exit
  // mark before leaving RECOVER — otherwise posture flaps around the 3000 entry line.
  const wasRecovering = Memory.empire?.posture === "RECOVER";
  const bucketCritical = bucket < (wasRecovering ? BUCKET_RECOVER_EXIT : BUCKET_RECOVER_THRESHOLD);
  const multiThreat = highThreatRooms.length >= MULTI_THREAT_RECOVER_COUNT;

  // WarCouncil sets this on a previous tick; we only READ it here.
  const warTargetRoom = Memory.empire?.warTargetRoom;

  // ── Decide posture (precedence: RECOVER > TURTLE > WAR > EXPAND) ──────────────
  let posture: EmpirePosture;
  let reason: string;
  if (bucketCritical || crippled || multiThreat) {
    posture = "RECOVER";
    reason = bucketCritical
      ? `CPU bucket ${bucket} below ${BUCKET_RECOVER_THRESHOLD}`
      : crippled
        ? "owned room lost its last spawn"
        : `${highThreatRooms.length} owned rooms under HIGH threat`;
  } else if (highThreatRooms.length > 0) {
    posture = "TURTLE";
    reason = `${highThreatRooms[0]} under HIGH threat`;
  } else if (warTargetRoom) {
    posture = "WAR";
    reason = `war target ${warTargetRoom}`;
  } else {
    posture = "EXPAND";
    reason = "healthy, no threats or war target";
  }

  // ── Per-room overrides: a single threatened room turtles regardless of empire ─
  const roomPosture: Record<string, EmpirePosture> = {};
  for (const name of highThreatRooms) roomPosture[name] = "TURTLE";

  const prev = Memory.empire;
  const empire: EmpireMemory = {
    posture,
    updatedAt: Game.time,
    reason,
    roomPosture,
  };
  // Preserve war-target fields the WarCouncil owns — we read but never clear them here.
  if (prev?.warTargetRoom) empire.warTargetRoom = prev.warTargetRoom;
  if (prev?.warTargetPlayer) empire.warTargetPlayer = prev.warTargetPlayer;

  // Log only on posture CHANGE (not every tick) to keep the console quiet.
  if (!prev || prev.posture !== posture) {
    console.log(`[Strategy] Posture ${prev?.posture ?? "EXPAND"} → ${posture} (${reason})`);
  }

  Memory.empire = empire;
}

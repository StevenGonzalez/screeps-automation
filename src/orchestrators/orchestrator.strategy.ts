import { getThreatSeverity } from "../services/services.combat";
import { inPixelRefill } from "./orchestrator.pixels";

const BUCKET_RECOVER_THRESHOLD = 3000;

const BUCKET_RECOVER_EXIT = 6000;

const STRATEGY_INTERVAL = 5;

const MULTI_THREAT_RECOVER_COUNT = 2;

const SPAWNLESS_CRIPPLED_LEVEL = 4;

export function loop() {
  if (Game.time % STRATEGY_INTERVAL !== 0) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);

  const highThreatRooms: string[] = [];
  let crippled = false;
  for (const room of ownedRooms) {
    const spawns = room.find(FIND_MY_SPAWNS);
    // Only a room that has had a spawn and lost it is crippled. A colony still
    // bootstrapping its first spawn is expected to have none. Rooms that lost
    // their spawn before hadSpawn existed are caught by level: no bootstrap
    // gets this far without building one.
    const mem = room.memory as RoomMemory & { hadSpawn?: boolean };
    const level = room.controller?.level ?? 0;
    if (spawns.length > 0) mem.hadSpawn = true;
    else if (
      level >= 2 &&
      (mem.hadSpawn || level >= SPAWNLESS_CRIPPLED_LEVEL) &&
      Memory.expansion?.roomName !== room.name
    ) {
      crippled = true;
    }

    if (getThreatSeverity(room) === "high") highThreatRooms.push(room.name);
  }

  const bucket = typeof Game.cpu.bucket === "number" ? Game.cpu.bucket : Number.POSITIVE_INFINITY;
  const wasRecovering = Memory.empire?.posture === "RECOVER";
  const bucketLimit = wasRecovering ? BUCKET_RECOVER_EXIT : BUCKET_RECOVER_THRESHOLD;
  // A bucket drained by our own pixel and refilling is not a CPU emergency.
  const bucketCritical = bucket < bucketLimit && !inPixelRefill();
  const multiThreat = highThreatRooms.length >= MULTI_THREAT_RECOVER_COUNT;

  const warTargetRoom = Memory.empire?.warTargetRoom;

  let posture: EmpirePosture;
  let reason: string;
  if (bucketCritical || crippled || multiThreat) {
    posture = "RECOVER";
    reason = bucketCritical
      ? `CPU bucket ${bucket} below ${bucketLimit}`
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

  const roomPosture: Record<string, EmpirePosture> = {};
  for (const name of highThreatRooms) roomPosture[name] = "TURTLE";

  const prev = Memory.empire;
  const empire: EmpireMemory = {
    posture,
    updatedAt: Game.time,
    reason,
    roomPosture,
  };
  if (prev?.warTargetRoom) empire.warTargetRoom = prev.warTargetRoom;
  if (prev?.warTargetPlayer) empire.warTargetPlayer = prev.warTargetPlayer;

  if (!prev || prev.posture !== posture) {
    console.log(`[Strategy] Posture ${prev?.posture ?? "EXPAND"} -> ${posture} (${reason})`);
  }

  Memory.empire = empire;
}

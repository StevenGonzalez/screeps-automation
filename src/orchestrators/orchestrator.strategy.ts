import { getThreatSeverity } from "../services/services.combat";

const BUCKET_RECOVER_THRESHOLD = 3000;

const BUCKET_RECOVER_EXIT = 6000;

const STRATEGY_INTERVAL = 5;

const MULTI_THREAT_RECOVER_COUNT = 2;

export function loop() {
  if (Game.time % STRATEGY_INTERVAL !== 0) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);

  const highThreatRooms: string[] = [];
  let crippled = false;
  for (const room of ownedRooms) {
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0 && (room.controller?.level ?? 0) >= 2) crippled = true;

    if (getThreatSeverity(room) === "high") highThreatRooms.push(room.name);
  }

  const bucket = typeof Game.cpu.bucket === "number" ? Game.cpu.bucket : Number.POSITIVE_INFINITY;
  const wasRecovering = Memory.empire?.posture === "RECOVER";
  const bucketCritical = bucket < (wasRecovering ? BUCKET_RECOVER_EXIT : BUCKET_RECOVER_THRESHOLD);
  const multiThreat = highThreatRooms.length >= MULTI_THREAT_RECOVER_COUNT;

  const warTargetRoom = Memory.empire?.warTargetRoom;

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

import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_HAULER,
  ROLE_MINER,
  ROLE_MINERAL_MINER,
  ROLE_REPAIRER,
  ROLE_UPGRADER,
} from "../config/config.roles";

const PHASE_LABEL: Record<string, string> = {
  bootstrap: "Bootstrap",
  developing: "Developing",
  established: "Established",
  powerhouse: "Powerhouse",
};

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    drawRoomHUD(room);
  }
}

function drawRoomHUD(room: Room) {
  const v = room.visual;
  const rcl = room.controller!.level;
  const progress = room.controller!.progress;
  const total = room.controller!.progressTotal;
  const phase = getRoomPhase(rcl);

  // HUD background panel at top-left
  const x = 0.5;
  let y = 0.8;
  const lineH = 0.85;
  const style: TextStyle = { font: 0.55, align: "left", color: "#e8e8e8", stroke: "#000000", strokeWidth: 0.08 };
  const dimStyle: TextStyle = { ...style, color: "#aaaaaa" };
  const warnStyle: TextStyle = { ...style, color: "#ff6644" };

  v.text(`RCL ${rcl}  ${PHASE_LABEL[phase]}`, x, y, { ...style, font: 0.6, color: "#ffffff" });
  y += lineH;

  // Controller progress bar
  if (rcl < 8 && total > 0) {
    const pct = progress / total;
    const barW = 6;
    v.rect(x, y - 0.6, barW, 0.55, { fill: "#333333", opacity: 0.7, stroke: "#555555", strokeWidth: 0.05 });
    v.rect(x, y - 0.6, barW * pct, 0.55, { fill: "#44aaff", opacity: 0.85, stroke: "transparent" });
    v.text(`${(pct * 100).toFixed(1)}%`, x + barW / 2, y, { ...style, align: "center", color: "#ffffff" });
    y += lineH;
  }

  // Energy
  const energy = room.energyAvailable;
  const energyCap = room.energyCapacityAvailable;
  const energyPct = energyCap > 0 ? energy / energyCap : 0;
  const energyColor = energyPct < 0.3 ? "#ff6644" : energyPct < 0.6 ? "#ffcc44" : "#88ff88";
  v.text(`Energy: ${energy}/${energyCap}`, x, y, { ...style, color: energyColor });
  y += lineH;

  // Storage
  if (room.storage) {
    const stored = room.storage.store[RESOURCE_ENERGY];
    v.text(`Storage: ${formatK(stored)}`, x, y, dimStyle);
    y += lineH;
  }

  // Creep counts
  const counts = countCreepsByRole(room);
  const roleOrder = [ROLE_MINER, ROLE_HAULER, ROLE_HARVESTER, ROLE_UPGRADER, ROLE_BUILDER, ROLE_REPAIRER, ROLE_MINERAL_MINER];
  const roleShort: Record<string, string> = {
    [ROLE_MINER]: "Miner",
    [ROLE_HAULER]: "Hauler",
    [ROLE_HARVESTER]: "Harvest",
    [ROLE_UPGRADER]: "Upgrade",
    [ROLE_BUILDER]: "Build",
    [ROLE_REPAIRER]: "Repair",
    [ROLE_MINERAL_MINER]: "Mineral",
  };

  let creepLine = "";
  for (const role of roleOrder) {
    const n = counts[role] ?? 0;
    if (n > 0) creepLine += `${roleShort[role]}:${n}  `;
  }
  if (creepLine) {
    v.text(creepLine.trim(), x, y, dimStyle);
    y += lineH;
  }

  // Threat warning
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    v.text(`THREAT: ${hostiles.length} hostile creep${hostiles.length > 1 ? "s" : ""}`, x, y, warnStyle);
    y += lineH;
  }

  // Spawn status
  const spawn = room.memory.spawnId ? Game.getObjectById(room.memory.spawnId) as StructureSpawn | null : null;
  if (spawn?.spawning) {
    const remaining = spawn.spawning.remainingTime;
    v.text(`Spawning: ${spawn.spawning.name} (${remaining}t)`, x, y, dimStyle);
  }
}

function getRoomPhase(rcl: number): string {
  if (rcl <= 2) return "bootstrap";
  if (rcl <= 4) return "developing";
  if (rcl <= 6) return "established";
  return "powerhouse";
}

function countCreepsByRole(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    const role = creep.memory.role;
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function formatK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

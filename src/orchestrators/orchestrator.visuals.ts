import {
  ROLE_BUILDER,
  ROLE_HARVESTER,
  ROLE_HAULER,
  ROLE_MINER,
  ROLE_MINERAL_MINER,
  ROLE_REPAIRER,
  ROLE_UPGRADER,
  ROLE_TOWNSFOLK,
} from "../config/config.roles";
import { cottageLayout, parseTile, spotHolder, townClock } from "../services/services.town";
import { readBlueprint } from "../planning/planner.blueprint";
import { describeBooks } from "../services/services.exchequer";

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
    drawTown(room);
    drawBlueprint(room);
  }
}

// Rooms whose blueprint is on show, to the tick the preview ends. Kept on the
// heap: a preview lost to a global reset is no loss.
const blueprintShownUntil: Record<string, number> = {};
const BLUEPRINT_PREVIEW_TICKS = 50;

/** Shows the room's blueprint for a while (Game.arca.blueprint). */
export function showBlueprint(roomName: string): void {
  blueprintShownUntil[roomName] = Game.time + BLUEPRINT_PREVIEW_TICKS;
}

// One colour per age, from the founding's pale gold to the empire's purple.
const AGE_COLOURS = ["", "#f5e6a8", "#f2c14e", "#f08a4b", "#e05a5a", "#5ab4e0", "#4fc49a", "#6b8cff", "#b06bff"];
const BLUEPRINT_LETTERS: Partial<Record<string, string>> = {
  spawn: "S", extension: "e", tower: "T", lab: "L", storage: "O", terminal: "M",
  factory: "F", observer: "B", powerSpawn: "P", nuker: "N", link: "K", container: "C", extractor: "X",
};

function drawBlueprint(room: Room): void {
  const until = blueprintShownUntil[room.name];
  if (until === undefined) return;
  if (Game.time > until) {
    delete blueprintShownUntil[room.name];
    return;
  }
  const bp = readBlueprint(room);
  if (!bp) return;
  const v = room.visual;
  for (const side of room.memory.blueprint?.lanes ?? []) {
    for (const p of bp.exits[side] ?? []) v.circle(p.x, p.y, { radius: 0.12, fill: "#cccccc", opacity: 0.5 });
  }
  for (const e of bp.entries) {
    const colour = AGE_COLOURS[e.rcl];
    if (e.type === STRUCTURE_ROAD) {
      v.circle(e.x, e.y, { radius: 0.15, fill: colour, opacity: 0.6 });
      continue;
    }
    v.rect(e.x - 0.4, e.y - 0.4, 0.8, 0.8, { fill: "transparent", stroke: colour, strokeWidth: 0.06, opacity: 0.8 });
    v.text(`${BLUEPRINT_LETTERS[e.type] ?? "?"}${e.rcl}`, e.x, e.y + 0.15, { font: 0.35, color: colour });
  }
}

function drawRoomHUD(room: Room) {
  const v = room.visual;
  const rcl = room.controller!.level;
  const progress = room.controller!.progress;
  const total = room.controller!.progressTotal;
  const phase = getRoomPhase(rcl);

  const x = 0.5;
  let y = 0.8;
  const lineH = 0.85;
  const style: TextStyle = { font: 0.55, align: "left", color: "#e8e8e8", stroke: "#000000", strokeWidth: 0.08 };
  const dimStyle: TextStyle = { ...style, color: "#aaaaaa" };
  const warnStyle: TextStyle = { ...style, color: "#ff6644" };

  v.text(`RCL ${rcl}  ${PHASE_LABEL[phase]}`, x, y, { ...style, font: 0.6, color: "#ffffff" });
  y += lineH;

  if (rcl < 8 && total > 0) {
    const pct = progress / total;
    const barW = 6;
    v.rect(x, y - 0.6, barW, 0.55, { fill: "#333333", opacity: 0.7, stroke: "#555555", strokeWidth: 0.05 });
    v.rect(x, y - 0.6, barW * pct, 0.55, { fill: "#44aaff", opacity: 0.85, stroke: "transparent" });
    v.text(`${(pct * 100).toFixed(1)}%`, x + barW / 2, y, { ...style, align: "center", color: "#ffffff" });
    y += lineH;
  }

  const energy = room.energyAvailable;
  const energyCap = room.energyCapacityAvailable;
  const energyPct = energyCap > 0 ? energy / energyCap : 0;
  const energyColor = energyPct < 0.3 ? "#ff6644" : energyPct < 0.6 ? "#ffcc44" : "#88ff88";
  v.text(`Gold: ${energy}/${energyCap}`, x, y, { ...style, color: energyColor });
  y += lineH;

  const books = Memory.exchequer?.[room.name];
  if (room.storage) {
    const stored = room.storage.store[RESOURCE_ENERGY];
    const trend = books?.trend;
    const trendText = trend === undefined ? "" : `  (${trend >= 0 ? "+" : ""}${trend.toFixed(1)}/t)`;
    v.text(`Treasury: ${formatK(stored)}${trendText}`, x, y, dimStyle);
    y += lineH;
  }

  if (books) {
    const [headline, income, spend] = describeBooks(books);
    v.text(headline, x, y, { ...style, color: "#f2c14e" });
    y += lineH;
    v.text(income.trim(), x + 0.4, y, { ...dimStyle, font: 0.45 });
    y += lineH * 0.8;
    v.text(spend.trim(), x + 0.4, y, { ...dimStyle, font: 0.45 });
    y += lineH;
  }

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

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    v.text(`THREAT: ${hostiles.length} hostile creep${hostiles.length > 1 ? "s" : ""}`, x, y, warnStyle);
    y += lineH;
  }

  if (room.memory.town) {
    const clock = townClock(Game.time);
    const icon = PHASE_ICON[clock.phase];
    const folk = counts[ROLE_TOWNSFOLK] ?? 0;
    const hh = String(clock.hour).padStart(2, "0");
    const phase = clock.phase[0].toUpperCase() + clock.phase.slice(1);
    v.text(`${icon} ${phase}, ${hh}:00  ${folk} townsfolk`, x, y, { ...style, color: "#ffe9a8" });
    y += lineH;
  }

  const spawn = room.memory.spawnId ? Game.getObjectById(room.memory.spawnId) as StructureSpawn | null : null;
  if (spawn?.spawning) {
    const remaining = spawn.spawning.remainingTime;
    v.text(`Spawning: ${spawn.spawning.name} (${remaining}t)`, x, y, dimStyle);
  }
}

const PHASE_ICON: Record<string, string> = { dawn: "🌅", day: "☀", dusk: "🌇", night: "🌙" };

// How dark the town gets through the day.
const NIGHT_SHADE: Record<string, number> = { dawn: 0.08, day: 0, dusk: 0.12, night: 0.22 };

function drawTown(room: Room): void {
  const town = room.memory.town;
  if (!town) return;
  const v = room.visual;
  const clock = townClock(Game.time);

  const shade = NIGHT_SHADE[clock.phase];
  if (shade > 0) v.rect(-0.5, -0.5, 50, 50, { fill: "#0a1030", opacity: shade });

  const label: TextStyle = { font: 0.45, color: "#ffe9a8", stroke: "#000000", strokeWidth: 0.06 };
  const lit = clock.phase === "dusk" || clock.phase === "night";

  for (const c of town.cottages) {
    const l = cottageLayout(c);
    // Roof over the floor, and a lamp in each occupied bed.
    v.rect(c.x + 0.5, c.y + 0.5, 3, 3, { fill: "#8a5a2b", opacity: 0.18, stroke: "#c08a4a", strokeWidth: 0.05 });
    for (const b of l.beds) {
      if (!spotHolder(room.name, b)) continue;
      const { x, y } = parseTile(b);
      v.circle(x, y, { radius: 0.18, fill: lit ? "#ffcc55" : "#c9a36b", opacity: lit ? 0.9 : 0.5 });
    }
    v.text(`House of ${c.name}`, c.x + 2, c.y - 0.3, label);
  }

  for (const p of town.posts) {
    const { x, y } = parseTile(p);
    const manned = spotHolder(room.name, p) !== undefined;
    v.poly(
      [[x, y + 0.35], [x, y - 0.4], [x + 0.35, y - 0.25], [x, y - 0.1]],
      { stroke: manned ? "#ff5544" : "#aa6655", strokeWidth: 0.06, fill: manned ? "#ff5544" : "transparent", opacity: 0.8 }
    );
  }

  if (town.fountain) {
    const { x, y } = parseTile(town.fountain);
    const ripple = 0.3 + 0.1 * Math.sin(Game.time / 3);
    v.circle(x, y, { radius: ripple + 0.15, fill: "transparent", stroke: "#66ccff", strokeWidth: 0.05, opacity: 0.6 });
    v.circle(x, y, { radius: 0.25, fill: "#3399ff", opacity: 0.6 });
    const name = room.memory.townName ?? room.name;
    v.text(`${name} Square`, x, y - 1.8, label);
  } else {
    for (const k of town.square) {
      const { x, y } = parseTile(k);
      v.circle(x, y, { radius: 0.12, fill: "#ffe9a8", opacity: 0.3 });
    }
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

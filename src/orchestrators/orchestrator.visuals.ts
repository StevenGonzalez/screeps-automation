import { ROLE_MINSTREL, ROLE_REMOTE_MINER, ROLE_TITLES, ROLE_TOWNSFOLK } from "../config/config.roles";
import { currentVerse } from "../roles/role.minstrel";
import {
  cottageLayout,
  isNightfall,
  parseTile,
  spotHolder,
  townClock,
  townDragon,
  townFeast,
  townHowl,
  townMoon,
  townSeason,
  townStorm,
} from "../services/services.town";
import { TOWN_MOON_DAYS, TOWN_MOON_NAMES, TOWN_HOWL_TICKS, TownSeason } from "../config/config.town";
import { LANDMARKS } from "../config/config.structures";
import { readBlueprint } from "../planning/planner.blueprint";
import { describeBooks } from "../services/services.exchequer";
import { MIN_HOME_STORAGE_ENERGY } from "./orchestrator.expansion";
import { castleName, chronicleDate, formatK, recentChronicle, wildsName } from "../services/services.chronicle";

const PHASE_LABEL: Record<string, string> = {
  bootstrap: "Bootstrap",
  developing: "Developing",
  established: "Established",
  powerhouse: "Powerhouse",
};

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    drawGraves(room);
    if (!room.controller?.my) continue;
    drawRoomHUD(room);
    drawChronicle(room);
    drawSeason(room);
    drawLandmarks(room);
    drawTown(room);
    drawDragon(room);
    drawBlueprint(room);
  }
  drawRealmMap();
}

const GRAVE_STONE: LineStyle = { color: "#c8c0b0", width: 0.08, opacity: 0.8 };
const GRAVE_LABEL: TextStyle = { font: 0.35, color: "#b8a88a", stroke: "#000000", strokeWidth: 0.05, opacity: 0.8 };

// A grave marker with a name over each tombstone one of ours left, in any room
// we can see, for as long as the tombstone lasts.
export function drawGraves(room: Room): void {
  const tombs = room.find(FIND_TOMBSTONES, { filter: (t) => t.creep.my });
  for (const t of tombs) {
    const { x, y } = t.pos;
    room.visual.line(x, y - 0.4, x, y + 0.3, GRAVE_STONE);
    room.visual.line(x - 0.2, y - 0.2, x + 0.2, y - 0.2, GRAVE_STONE);
    room.visual.text(t.creep.name, x, y - 0.55, GRAVE_LABEL);
  }
}

const MAP_GOLD = "#f2c14e";
const MAP_DANGER = "#e05a5a";
const MAP_KEEP = "#b06bff";

// The realm on the world map: each castle's name over its room with its level
// and treasury under it, a road to each remote its peddlers work (red while
// raiders or rivals hold it), the remote's own name, the name of any rival
// holding it, and the keep the castle is founding or saving for.
export function drawRealmMap(): void {
  const mv = Game.map.visual;
  const worked: Record<string, Set<string>> = {};
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role !== ROLE_REMOTE_MINER || !c.memory.homeRoom || !c.memory.targetRoom) continue;
    (worked[c.memory.homeRoom] ??= new Set()).add(c.memory.targetRoom);
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    const centre = new RoomPosition(25, 25, roomName);
    mv.text(castleName(roomName), new RoomPosition(25, 6, roomName), {
      color: MAP_GOLD,
      fontSize: 6,
      stroke: "#000000",
      strokeWidth: 0.6,
    });
    const gold = room.storage ? ` · ${formatK(room.storage.store[RESOURCE_ENERGY])} gold` : "";
    mv.text(`RCL ${room.controller.level}${gold}`, new RoomPosition(25, 45, roomName), { color: "#e8e8e8", fontSize: 4 });

    for (const remote of room.memory.remoteRooms ?? []) {
      // A remote claimed as a keep is drawn as a castle of its own.
      if (Game.rooms[remote.roomName]?.controller?.my) continue;
      const ours = worked[roomName]?.has(remote.roomName) ?? false;
      // A rival's hold is shown whether or not a peddler is still there.
      const held = remote.hostile && (remote.hostileUntil ?? 0) > Game.time;
      if (!ours && !held) continue;
      const raided = held || (remote.invaderUntil ?? 0) > Game.time;
      const colour = raided ? MAP_DANGER : MAP_GOLD;
      if (ours) {
        mv.line(centre, new RoomPosition(25, 25, remote.roomName), { color: colour, width: 1, opacity: 0.6, lineStyle: "dashed" });
      }
      const label = held ? `held by ${remote.rival ?? "strangers"}` : raided ? "raided" : "vendors";
      mv.text(wildsName(remote.roomName), new RoomPosition(25, 34, remote.roomName), { color: "#e8e8e8", fontSize: 4 });
      mv.text(label, new RoomPosition(25, 40, remote.roomName), { color: colour, fontSize: 4 });
    }
  }

  const exp = Memory.expansion;
  const savings = Memory.expansionSavings;
  const keep =
    exp && exp.phase !== "established"
      ? { from: exp.homeRoom, at: exp.roomName, label: `keep: ${keepProgress(exp)}` }
      : savings
        ? { from: savings.room, at: savings.target, label: "keep planned" }
        : undefined;
  if (keep) {
    const at = new RoomPosition(25, 25, keep.at);
    if (keep.from) mv.line(new RoomPosition(25, 25, keep.from), at, { color: MAP_KEEP, width: 1.5, opacity: 0.7, lineStyle: "dotted" });
    mv.circle(at, { radius: 8, fill: "transparent", stroke: MAP_KEEP, strokeWidth: 1, opacity: 0.8 });
    mv.text(keep.label, new RoomPosition(25, 12, keep.at), { color: MAP_KEEP, fontSize: 5 });
  }
}

// How far a keep being founded has come: claimed, its barracks rising, or its
// barracks standing while it grows.
function keepProgress(exp: NonNullable<Memory["expansion"]>): string {
  const room = Game.rooms[exp.roomName];
  if (exp.phase === "claiming" || !room?.controller?.my) return "claiming";
  if (room.find(FIND_MY_SPAWNS).length > 0) return `growing, RCL ${room.controller.level}`;
  const site = room.find(FIND_MY_CONSTRUCTION_SITES).find((s) => s.structureType === STRUCTURE_SPAWN);
  if (!site) return "pilgrims at work";
  return `barracks ${Math.floor((site.progress * 100) / site.progressTotal)}%`;
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

  v.text(`${castleName(room.name)}  ·  RCL ${rcl}  ${PHASE_LABEL[phase]}`, x, y, { ...style, font: 0.6, color: "#ffffff" });
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
    const keep = describeKeepPlan(room, stored);
    if (keep) {
      v.text(keep, x, y, { ...style, color: "#f2c14e" });
      y += lineH;
    }
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
  const [atHome, abroad] = describeCensus(room);
  if (atHome) {
    v.text(atHome, x, y, dimStyle);
    y += lineH;
  }
  if (abroad) {
    v.text(`Abroad: ${abroad}`, x, y, dimStyle);
    y += lineH;
  }

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    v.text(`RAIDERS: ${hostiles.length} about the castle`, x, y, warnStyle);
    y += lineH;
  }

  if (room.memory.town) {
    const clock = townClock(Game.time);
    const icon = PHASE_ICON[clock.phase];
    const folk = counts[ROLE_TOWNSFOLK] ?? 0;
    const hh = String(clock.hour).padStart(2, "0");
    const phase = clock.phase[0].toUpperCase() + clock.phase.slice(1);
    const season = townSeason(Game.time);
    const feast = townFeast(Game.time);
    const storm = townStorm(Game.time) ? ", storm" : "";
    const moon = isNightfall(clock.phase) ? `, ${TOWN_MOON_NAMES[townMoon(Game.time)]}` : "";
    const when = `${phase}, ${hh}:00 in ${season}${feast ? `, ${feast}` : ""}${storm}${moon}`;
    v.text(`${icon} ${when}  ${folk} townsfolk`, x, y, { ...style, color: "#ffe9a8" });
    y += lineH;
  }

  const spawn = room.memory.spawnId ? Game.getObjectById(room.memory.spawnId) as StructureSpawn | null : null;
  if (spawn?.spawning) {
    const remaining = spawn.spawning.remainingTime;
    v.text(`Mustering: ${spawn.spawning.name} (${remaining}t)`, x, y, dimStyle);
  }
}

// The keep this castle is founding, or saving the gold to found.
function describeKeepPlan(room: Room, stored: number): string | undefined {
  const exp = Memory.expansion;
  if (exp?.homeRoom === room.name && exp.phase !== "established") {
    return `Founding ${castleName(exp.roomName)} in the ${wildsName(exp.roomName)}: ${keepProgress(exp)}`;
  }
  const plan = Memory.expansionSavings;
  if (plan?.room === room.name) {
    return `Saving for a keep in the ${wildsName(plan.target)}: ${formatK(stored)}/${formatK(MIN_HOME_STORAGE_ENERGY)}`;
  }
  return undefined;
}

const CHRONICLE_LINES = 4;

// The latest entries of the Royal Chronicle, newest at the bottom, in the
// room's lower-left corner.
function drawChronicle(room: Room): void {
  const entries = recentChronicle(CHRONICLE_LINES);
  if (entries.length === 0) return;
  const v = room.visual;
  const style: TextStyle = { font: 0.45, align: "left", stroke: "#000000", strokeWidth: 0.06 };
  let y = 48.6 - entries.length * 0.65;
  v.text("Royal Chronicle", 0.5, y - 0.15, { ...style, font: 0.5, color: "#f2c14e" });
  entries.forEach((e, i) => {
    y += 0.65;
    const fresh = i === entries.length - 1;
    v.text(`${chronicleDate(e.t)}: ${e.text}`, 0.5, y, { ...style, color: fresh ? "#ffe9a8" : "#b8a88a" });
  });
}

const PHASE_ICON: Record<string, string> = { dawn: "🌅", day: "☀", dusk: "🌇", night: "🌙" };

// How dark the town gets through the day.
const NIGHT_SHADE: Record<string, number> = { dawn: 0.08, day: 0, dusk: 0.12, night: 0.22 };

const LANDMARK_LABEL: TextStyle = { font: 0.4, color: "#d8c8a0", stroke: "#000000", strokeWidth: 0.05, opacity: 0.75 };

function titleCase(s: string): string {
  return s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Each notable work of the castle labelled under it by the name the realm
// knows it by, and the treasury with its gold. Labs stand together, so they
// share one label under the middle of the group. Works still being built are
// drawn in scaffolding.
export function drawLandmarks(room: Room): void {
  const v = room.visual;
  const labs: Array<{ x: number; y: number }> = [];
  for (const s of room.find(FIND_MY_STRUCTURES)) {
    if (s.structureType === STRUCTURE_LAB) {
      labs.push(s.pos);
      continue;
    }
    const names = LANDMARKS[s.structureType];
    if (!names) continue;
    let text = titleCase(names[0]);
    if (s.structureType === STRUCTURE_STORAGE) {
      text += ` · ${formatK((s as StructureStorage).store[RESOURCE_ENERGY])} gold`;
    }
    v.text(text, s.pos.x, s.pos.y + 0.95, LANDMARK_LABEL);
  }
  if (labs.length > 0) {
    const [one, many] = LANDMARKS[STRUCTURE_LAB]!;
    const x = labs.reduce((sum, p) => sum + p.x, 0) / labs.length;
    const y = Math.max(...labs.map((p) => p.y));
    v.text(titleCase(labs.length === 1 ? one : many), x, y + 0.95, LANDMARK_LABEL);
  }
  for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
    const names = LANDMARKS[site.structureType];
    if (names) drawScaffold(v, site, names[0]);
  }
  if (room.controller) v.text("Throne", room.controller.pos.x, room.controller.pos.y + 0.95, LANDMARK_LABEL);
}

const SCAFFOLD: LineStyle = { color: "#8b6b43", width: 0.06, opacity: 0.8 };
const SCAFFOLD_STONE = "#9a9080";

// A work still being raised stands in scaffolding, its stone climbing from the
// ground as the work goes in, labelled with how far it has come.
function drawScaffold(v: RoomVisual, site: ConstructionSite, name: string): void {
  const { x, y } = site.pos;
  const share = site.progress / site.progressTotal;
  v.rect(x - 0.45, y + 0.45 - 0.9 * share, 0.9, 0.9 * share, { fill: SCAFFOLD_STONE, opacity: 0.5 });
  v.rect(x - 0.45, y - 0.45, 0.9, 0.9, { fill: "transparent", stroke: SCAFFOLD.color, strokeWidth: SCAFFOLD.width, opacity: SCAFFOLD.opacity });
  v.line(x - 0.45, y - 0.45, x + 0.45, y + 0.45, SCAFFOLD);
  v.line(x + 0.45, y - 0.45, x - 0.45, y + 0.45, SCAFFOLD);
  v.text(`${titleCase(name)} rising · ${Math.floor(share * 100)}%`, x, y + 0.95, LANDMARK_LABEL);
}

// The season over the castle: a faint tint and something drifting down through
// the air, or fireflies round the fountain on a summer night. Every mote's place
// is worked out from the tick alone, so the weather moves without memory.
const SEASON_TINT: Partial<Record<TownSeason, string>> = {
  spring: "#88cc77",
  autumn: "#cc7a33",
  winter: "#aaccff",
};

interface Drift {
  count: number;
  colours: string[];
  radius: number;
  // Tiles a mote falls each tick.
  fall: number;
}

const SEASON_DRIFT: Partial<Record<TownSeason, Drift>> = {
  spring: { count: 10, colours: ["#ffb7c5", "#ffd9e0"], radius: 0.1, fall: 0.12 },
  autumn: { count: 14, colours: ["#d9822b", "#a0522d", "#c9a227"], radius: 0.13, fall: 0.18 },
  winter: { count: 30, colours: ["#ffffff"], radius: 0.08, fall: 0.25 },
};

const RAINDROPS = 40;
// Tiles a raindrop falls each tick.
const RAIN_FALL = 1.4;
// Lightning strikes on one tick in this many of a storm.
const LIGHTNING_EVERY = 37;

const FIREFLIES = 8;
const LANTERNS = 12;
const LANTERN_COLOURS = ["#ff6b4a", "#ffd27f", "#7fd4ff"];

export function drawSeason(room: Room, time = Game.time): void {
  const v = room.visual;
  const season = townSeason(time);
  const fountain = room.memory.town?.fountain;

  // A feast day hangs a ring of lanterns round the fountain, their colours
  // turning slowly, with the feast's name under it.
  const feast = townFeast(time);
  if (feast && fountain) {
    const { x, y } = parseTile(fountain);
    const turn = Math.floor(time / 5);
    for (let i = 0; i < LANTERNS; i++) {
      const angle = (i * Math.PI * 2) / LANTERNS;
      v.circle(x + Math.cos(angle) * 2.4, y + Math.sin(angle) * 2.4, {
        radius: 0.14,
        fill: LANTERN_COLOURS[(i + turn) % LANTERN_COLOURS.length],
        opacity: 0.85,
      });
    }
    v.text(feast, x, y + 3.2, { font: 0.5, color: "#ffd27f", stroke: "#000000", strokeWidth: 0.06 });
  }

  if (townStorm(time)) {
    drawStorm(v, time);
    return;
  }

  const tint = SEASON_TINT[season];
  if (tint) v.rect(-0.5, -0.5, 50, 50, { fill: tint, opacity: 0.05 });

  const drift = SEASON_DRIFT[season];
  if (drift) {
    for (let i = 0; i < drift.count; i++) {
      // A low-discrepancy spread keeps the motes from bunching into columns.
      const sway = Math.sin((time + i * 13) / 8) * 0.8;
      const x = ((((i * 0.7548776662) % 1) * 50 + sway) % 50 + 50) % 50;
      const y = ((time * drift.fall + ((i * 0.5698402910) % 1) * 52) % 52) - 1;
      v.circle(x, y, { radius: drift.radius, fill: drift.colours[i % drift.colours.length], opacity: 0.7 });
    }
    return;
  }

  if (!fountain || !isNightfall(townClock(time).phase)) return;
  const { x, y } = parseTile(fountain);
  for (let i = 0; i < FIREFLIES; i++) {
    const angle = (i * Math.PI * 2) / FIREFLIES + time / 40;
    const reach = 2 + (i % 3) + Math.sin((time + i * 7) / 11) * 0.6;
    const glow = Math.max(0, Math.sin((time + i * 5) / 4));
    v.circle(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, {
      radius: 0.1,
      fill: "#d4ff66",
      opacity: 0.2 + 0.7 * glow,
    });
  }
}

// A storm: grey sky, slanting rain, and now and then a bolt of lightning with
// the whole room lit white for a tick.
function drawStorm(v: RoomVisual, time: number): void {
  v.rect(-0.5, -0.5, 50, 50, { fill: "#334455", opacity: 0.12 });
  for (let i = 0; i < RAINDROPS; i++) {
    const x = ((i * 0.7548776662) % 1) * 49 + 0.5;
    const y = ((time * RAIN_FALL + ((i * 0.5698402910) % 1) * 52) % 52) - 1;
    v.line(x, y, x - 0.25, y + 0.7, { color: "#9fb8d0", width: 0.04, opacity: 0.5 });
  }
  if (time % LIGHTNING_EVERY !== 0) return;
  v.rect(-0.5, -0.5, 50, 50, { fill: "#ffffff", opacity: 0.15 });
  let x = 5 + ((time * 7) % 40);
  const bolt: Array<[number, number]> = [[x, -0.5]];
  for (let y = 4; y <= 20; y += 4) {
    x += ((time + y) % 3) - 1;
    bolt.push([x, y]);
  }
  v.poly(bolt, { stroke: "#fffbe0", strokeWidth: 0.15, opacity: 0.9 });
}

export function drawTown(room: Room): void {
  const town = room.memory.town;
  if (!town) return;
  const v = room.visual;
  const clock = townClock(Game.time);

  const shade = NIGHT_SHADE[clock.phase];
  if (shade > 0) v.rect(-0.5, -0.5, 50, 50, { fill: "#0a1030", opacity: shade });

  const label: TextStyle = { font: 0.45, color: "#ffe9a8", stroke: "#000000", strokeWidth: 0.06 };
  const lit = clock.phase === "dusk" || clock.phase === "night";
  if (lit && !townStorm(Game.time)) drawMoon(v, townMoon(Game.time));
  drawHowl(v, Game.time);

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

  town.posts.forEach((p, i) => {
    const { x, y } = parseTile(p);
    const manned = spotHolder(room.name, p) !== undefined;
    v.poly(
      [[x, y + 0.35], [x, y - 0.4], [x + 0.35, y - 0.25], [x, y - 0.1]],
      { stroke: manned ? "#ff5544" : "#aa6655", strokeWidth: 0.06, fill: manned ? "#ff5544" : "transparent", opacity: 0.8 }
    );
    // A torch burns on every post after dark, flickering on its own beat.
    if (lit) {
      const flicker = 0.5 + 0.5 * Math.sin(Game.time * 1.7 + i * 2.3);
      v.circle(x - 0.25, y - 0.45, { radius: 0.55, fill: "#ff9933", opacity: 0.08 + 0.06 * flicker });
      v.circle(x - 0.25, y - 0.45, { radius: 0.1 + 0.05 * flicker, fill: "#ffcc55", opacity: 0.6 + 0.3 * flicker });
    }
  });

  if (town.fountain) {
    const { x, y } = parseTile(town.fountain);
    const ripple = 0.3 + 0.1 * Math.sin(Game.time / 3);
    v.circle(x, y, { radius: ripple + 0.15, fill: "transparent", stroke: "#66ccff", strokeWidth: 0.05, opacity: 0.6 });
    v.circle(x, y, { radius: 0.25, fill: "#3399ff", opacity: 0.6 });
    v.text(`${castleName(room.name)} Square`, x, y - 1.8, label);
    if (townFeast(Game.time)) drawSong(room, x, y);
  } else {
    for (const k of town.square) {
      const { x, y } = parseTile(k);
      v.circle(x, y, { radius: 0.12, fill: "#ffe9a8", opacity: 0.3 });
    }
  }
}

const MOON_X = 46;
const MOON_Y = 3;
const MOON_RADIUS = 1.1;
const MOON_LIGHT = "#f4f1d0";

// The moon in the north-east sky from dusk to dawn, lit as it is tonight:
// the lit limb on one side and the terminator's half-ellipse on the other,
// waxing from the right and waning from the left.
export function drawMoon(v: RoomVisual, age: number): void {
  v.circle(MOON_X, MOON_Y, { radius: MOON_RADIUS, fill: "#1a1f3a", stroke: "#3a4060", strokeWidth: 0.04, opacity: 0.5 });
  if (age === 0) return;
  const angle = (2 * Math.PI * age) / TOWN_MOON_DAYS;
  const waxing = angle <= Math.PI;
  const side = waxing ? 1 : -1;
  const reach = Math.cos(waxing ? angle : 2 * Math.PI - angle);
  const STEPS = 12;
  const lit: Array<[number, number]> = [];
  for (let i = 0; i <= STEPS; i++) {
    const a = (Math.PI * i) / STEPS;
    lit.push([MOON_X + side * MOON_RADIUS * Math.sin(a), MOON_Y - MOON_RADIUS * Math.cos(a)]);
  }
  for (let i = STEPS; i >= 0; i--) {
    const a = (Math.PI * i) / STEPS;
    lit.push([MOON_X + side * MOON_RADIUS * reach * Math.sin(a), MOON_Y - MOON_RADIUS * Math.cos(a)]);
  }
  v.poly(lit, { fill: MOON_LIGHT, stroke: "transparent", opacity: 0.85 });
  // A full moon throws a glow about itself.
  if (age === TOWN_MOON_DAYS / 2) v.circle(MOON_X, MOON_Y, { radius: MOON_RADIUS * 2.2, fill: MOON_LIGHT, opacity: 0.07 });
}

const HOWL_STYLE: TextStyle = { font: "italic 0.5 serif", color: "#a8b8d8", stroke: "#000000", strokeWidth: 0.05 };

// A wolf's howl out of the dark at the castle's edge: a pair of eyes and the
// howl rising and fading over them.
function drawHowl(v: RoomVisual, time: number): void {
  const howl = townHowl(time);
  if (!howl) return;
  const fade = 1 - howl.t / TOWN_HOWL_TICKS;
  v.circle(howl.x - 0.15, howl.y, { radius: 0.07, fill: "#ffdd55", opacity: 0.9 });
  v.circle(howl.x + 0.15, howl.y, { radius: 0.07, fill: "#ffdd55", opacity: 0.9 });
  v.text("Awoo-oo!", howl.x, howl.y - 0.7 - howl.t * 0.15, { ...HOWL_STYLE, opacity: 0.4 + 0.6 * fade });
}

const DRAGON: PolyStyle = { fill: "#160a0a", stroke: "#7a1414", strokeWidth: 0.08, opacity: 0.92 };
const DRAGON_SHADOW: PolyStyle = { fill: "#000000", opacity: 0.2 };

// The dragon seen from above, flying east, as [forward, sideways] offsets from
// its middle: horned head, neck, body and a tail with a spade at its tip, and
// two bat wings with ragged trailing edges. `span` is how far the wings reach
// out, `wag` how far the tail swings.
function dragonShapes(span: number, wag: number): Array<Array<[number, number]>> {
  const body: Array<[number, number]> = [
    [3.3, 0], [2.7, -0.18], [2.45, -0.5], [2.35, -0.2], [1.9, -0.18], [1, -0.35], [0.2, -0.5], [-0.8, -0.42],
    [-1.6, -0.2], [-2.6, -0.12 + wag * 0.3], [-3.6, -0.08 + wag * 0.8], [-4.2, -0.35 + wag], [-4.7, wag],
    [-4.2, 0.35 + wag], [-3.6, 0.08 + wag * 0.8], [-2.6, 0.12 + wag * 0.3], [-1.6, 0.2], [-0.8, 0.42],
    [0.2, 0.5], [1, 0.35], [1.9, 0.18], [2.35, 0.2], [2.45, 0.5], [2.7, 0.18],
  ];
  const wing = (side: number): Array<[number, number]> => [
    [0.7, 0.35 * side], [1, span * 0.55 * side], [0.1, span * side], [-0.35, span * 0.62 * side],
    [-0.8, span * 0.8 * side], [-1.1, span * 0.5 * side], [-1.5, span * 0.58 * side], [-1.2, 0.4 * side],
  ];
  return [wing(-1), wing(1), body];
}

// A dragon crossing the room: wings beating, tail swinging, eyes like embers,
// and its shadow sliding over the ground below.
export function drawDragon(room: Room, time = Game.time): void {
  const d = townDragon(time);
  if (!d) return;
  const v = room.visual;
  const shapes = dragonShapes(1.6 + 2.2 * Math.abs(Math.sin(time * 0.9)), 0.35 * Math.sin(time * 0.5));
  // Offsets are mirrored for a westward flight.
  const place = (shape: Array<[number, number]>, dx: number, dy: number) =>
    shape.map(([f, s]): [number, number] => [d.x + dx + f * d.dir, d.y + dy + s]);
  for (const shape of shapes) v.poly(place(shape, -1.5 * d.dir, 3), DRAGON_SHADOW);
  for (const shape of shapes) v.poly(place(shape, 0, 0), DRAGON);
  for (const side of [-0.1, 0.1]) v.circle(d.x + 2.75 * d.dir, d.y + side, { radius: 0.09, fill: "#ff5522", opacity: 1 });
}

const SONG: TextStyle = { font: "italic 0.45 serif", color: "#f5e6a8", stroke: "#000000", strokeWidth: 0.05 };

// While a minstrel sings in the square, the couplet it sings hangs over the
// square's sign and a note bobs over the minstrel's head.
function drawSong(room: Room, x: number, y: number): void {
  const minstrel = room.find(FIND_MY_CREEPS).find((c) => c.memory.role === ROLE_MINSTREL);
  if (!minstrel) return;
  const v = room.visual;
  const [first, second] = currentVerse(room, Game.time);
  // Clear of the ring of feast lanterns, 2.4 tiles out.
  v.text(first, x, y - 3.8, SONG);
  v.text(second, x, y - 3.2, SONG);
  const bob = 0.15 * Math.sin(Game.time / 2);
  v.text("♪", minstrel.pos.x + 0.5, minstrel.pos.y - 0.5 + bob, { font: 0.6, color: "#ffe9a8" });
}

function getRoomPhase(rcl: number): string {
  if (rcl <= 2) return "bootstrap";
  if (rcl <= 4) return "developing";
  if (rcl <= 6) return "established";
  return "powerhouse";
}

// The castle's people by title, most numerous first: those who serve at home,
// and those posted abroad (vendors, envoys, knights), wherever they stand this
// tick. Townsfolk have a line of their own.
export function describeCensus(room: Room): [string, string] {
  const home: Record<string, number> = {};
  const away: Record<string, number> = {};
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if ((c.memory.homeRoom ?? c.room.name) !== room.name) continue;
    const role = c.memory.role;
    if (role === ROLE_TOWNSFOLK) continue;
    const sent = c.memory.targetRoom !== undefined && c.memory.targetRoom !== room.name;
    const tally = sent ? away : home;
    tally[role] = (tally[role] ?? 0) + 1;
  }
  const line = (tally: Record<string, number>) =>
    Object.keys(tally)
      .sort((a, b) => tally[b] - tally[a] || a.localeCompare(b))
      .map((role) => {
        const title = ROLE_TITLES[role] ?? role;
        return `${tally[role]} ${tally[role] === 1 ? title : `${title}s`}`;
      })
      .join(" · ");
  return [line(home), line(away)];
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


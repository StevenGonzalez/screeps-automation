import { getThreatInfo, evaluateRoomThreatLevel } from "../services/services.combat";
import { heraldRival } from "../services/services.herald";
import { launchNukeFrom } from "./orchestrator.nuker";
import {
  onTargetCooldown,
  recommendComposition,
  launchOp,
  isCapableOffensiveHome,
  isAllyPlayer,
} from "./orchestrator.military.ops";

const INTEL_TTL = 6_000;

const WARCOUNCIL_SCAN_INTERVAL = 50;

const AUTO_ATTACK_INTERVAL = 1000;

const AUTO_ATTACK_MAX_THREAT = 4;

const AUTO_ATTACK_MAX_RANGE = 6;

const HOSTILE_MEMORY_TICKS = 20_000;

export function runWarCouncil(): void {
  if (!Memory.warCouncil) Memory.warCouncil = { autoAttack: false };
  const wc = Memory.warCouncil;

  if (Game.time - (wc.lastScan ?? 0) >= WARCOUNCIL_SCAN_INTERVAL) {
    scanIntel();
    wc.lastScan = Game.time;
  }

  if (wc.autoAttack) {
    considerAutoAttack(wc);
  }
}

function scanIntel(): void {
  if (!Memory.intel) Memory.intel = {};
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (room.controller?.my) {
      delete Memory.intel[rn];
      continue;
    }
    recordRoomIntel(room);
  }

  for (const rn in Memory.intel) {
    if (Game.time - (Memory.intel[rn].lastSeen ?? 0) > INTEL_TTL) delete Memory.intel[rn];
  }

  rebuildPlayerModel();
}

export function recordRoomIntel(room: Room): void {
  if (!Memory.intel) Memory.intel = {};
  const rn = room.name;

  const pack = (p: RoomPosition): number => p.x * 50 + p.y;

  const towerStructs = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  const spawnStructs = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN,
  }) as StructureSpawn[];

  const { hostiles } = getThreatInfo(room);
  let combatParts = 0;
  let healParts = 0;
  for (const h of hostiles) {
    for (const p of h.body) {
      if (p.type === ATTACK || p.type === RANGED_ATTACK) combatParts++;
      if (p.type === HEAL) healParts++;
    }
  }

  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);

  const storage = room.storage;
  const terminal = room.terminal;

  let barrierTotal = 0;
  let barrierMax = 0;
  const barriers = room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL,
  });
  for (const b of barriers) {
    barrierTotal += b.hits;
    if (b.hits > barrierMax) barrierMax = b.hits;
  }

  const nonEnergyLoad = (store: StoreDefinition): number => {
    let total = 0;
    for (const r in store) {
      if (r !== RESOURCE_ENERGY) total += store[r as ResourceConstant];
    }
    return total;
  };

  const owner = room.controller?.owner?.username;
  const rcl = room.controller?.level ?? 0;
  heraldRival(rn, Memory.intel[rn], owner, rcl);

  Memory.intel[rn] = {
    roomName: rn,
    lastSeen: Game.time,
    owner,
    reservedBy: room.controller?.reservation?.username,
    rcl,
    towers: towerStructs.length,
    spawns: spawnStructs.length,
    hostileCreeps: hostiles.length,
    hostileCombatParts: combatParts,
    hostileHealParts: healParts,
    safeMode: room.controller?.safeMode,
    threatLevel: evaluateRoomThreatLevel(room),
    controllerPos: room.controller ? pack(room.controller.pos) : undefined,
    spawnPos: spawnStructs.length > 0 ? spawnStructs.map((s) => pack(s.pos)) : undefined,
    towerPos: towerStructs.length > 0 ? towerStructs.map((t) => pack(t.pos)) : undefined,
    sourcePos: sources.length > 0 ? sources.map((s) => pack(s.pos)) : undefined,
    storagePos: storage ? pack(storage.pos) : undefined,
    storageEnergy: storage ? storage.store[RESOURCE_ENERGY] : undefined,
    storageMineral: storage ? nonEnergyLoad(storage.store) : undefined,
    terminalPos: terminal ? pack(terminal.pos) : undefined,
    terminalEnergy: terminal ? terminal.store[RESOURCE_ENERGY] : undefined,
    terminalMineral: terminal ? nonEnergyLoad(terminal.store) : undefined,
    barrierHpTotal: barriers.length > 0 ? barrierTotal : undefined,
    barrierHpMax: barriers.length > 0 ? barrierMax : undefined,
    mineralType: minerals.length > 0 ? minerals[0].mineralType : undefined,
  };
}

function rebuildPlayerModel(): void {
  if (!Memory.intel) return;
  if (!Memory.players) Memory.players = {};

  const fresh: Record<string, PlayerIntelData> = {};
  for (const rn in Memory.intel) {
    const intel: RoomIntelData = Memory.intel[rn];
    const owner = intel.owner;
    if (!owner) continue;

    const coords = parseRoomCoords(rn);
    if (!coords) continue;

    let p = fresh[owner];
    if (!p) {
      p = fresh[owner] = {
        username: owner,
        rooms: [],
        roomCount: 0,
        maxRcl: 0,
        totalTowers: 0,
        totalSpawns: 0,
        militaryStrength: 0,
        economicStrength: 0,
        centroidX: 0,
        centroidY: 0,
        lastSeen: 0,
      };
    }

    if (p.rooms.length < PLAYER_ROOM_CAP) p.rooms.push(rn);
    p.roomCount++;
    p.maxRcl = Math.max(p.maxRcl, intel.rcl);
    p.totalTowers += intel.towers;
    p.totalSpawns += intel.spawns;
    p.militaryStrength += roomMilitaryStrength(intel.towers, intel.barrierHpMax ?? 0, intel.rcl);
    p.economicStrength +=
      Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 1000) +
      (intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0);
    p.centroidX += coords.x;
    p.centroidY += coords.y;
    p.lastSeen = Math.max(p.lastSeen, intel.lastSeen);
  }

  for (const u in fresh) {
    const p = fresh[u];
    if (p.roomCount > 0) {
      p.centroidX = Math.round(p.centroidX / p.roomCount);
      p.centroidY = Math.round(p.centroidY / p.roomCount);
    }
  }

  const players = Memory.players;
  for (const u in fresh) players[u] = fresh[u];
  for (const u in players) {
    if (fresh[u]) continue;
    if (Game.time - players[u].lastSeen > INTEL_TTL) delete players[u];
  }
}

const PLAYER_ROOM_CAP = 30;

function roomMilitaryStrength(towers: number, barrierHpMax: number, rcl: number): number {
  return towers * 100 + Math.floor(barrierHpMax / 100_000) * 50 + rcl * 10;
}

// Our own strength on the same scale as Memory.players[*].militaryStrength.
function ownMilitaryStrength(): number {
  let total = 0;
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length;
    let barrierMax = 0;
    for (const s of room.find(FIND_STRUCTURES)) {
      if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL) continue;
      if (s.hits > barrierMax) barrierMax = s.hits;
    }
    total += roomMilitaryStrength(towers, barrierMax, room.controller.level);
  }
  return total;
}

function parseRoomCoords(roomName: string): { x: number; y: number } | null {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
  if (!m) return null;
  const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
  const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
  return { x, y };
}

const WAR_ECONOMY_ENERGY = 100_000;

const FORTRESS_BARRIER_HP = 5_000_000;

const NUKE_BARRIER_HP = 8_000_000;

const NUKE_MIN_TOWERS = 3;

const NUKE_MIN_RCL = 7;

const NUKE_MAX_LAUNCH = 2;

const AUTO_NUKE_INTERVAL = 1000;

const NUKE_ASSAULT_LEAD = 600;

function targetValue(intel: RoomIntelData): number {
  let value = 0;
  value += Math.floor(((intel.storageEnergy ?? 0) + (intel.terminalEnergy ?? 0)) / 2_000);
  value += Math.floor(((intel.storageMineral ?? 0) + (intel.terminalMineral ?? 0)) / 200);
  value += intel.rcl * 8;
  return Math.max(1, value);
}

function targetEffort(intel: RoomIntelData, dist: number): number {
  let effort = 1;
  effort += intel.towers * 6;
  effort += Math.floor((intel.barrierHpMax ?? 0) / 500_000);
  effort += intel.threatLevel * 3;
  effort += dist;
  return effort;
}

function considerAutoAttack(wc: WarCouncilMemory): void {
  if (Game.time - (wc.lastAutoAttackTick ?? 0) < AUTO_ATTACK_INTERVAL) return;
  if (!Memory.intel) return;

  maintainWarTarget();

  maintainNukedTargets(wc);
  pruneExpired(wc.targetCooldown, (until) => Game.time >= until);
  pruneExpired(wc.hostilePlayers, (seen) => Game.time - seen > HOSTILE_MEMORY_TICKS);

  const posture = Memory.empire?.posture;
  if (posture === "TURTLE" || posture === "RECOVER") return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;

  const freeHomes = ownedRooms.filter((r) => isCapableOffensiveHome(r));
  if (freeHomes.length === 0) return;

  const myNames = new Set(
    ownedRooms.map((r) => r.controller?.owner?.username).filter((u): u is string => !!u)
  );
  const capableHomeCount = freeHomes.length;
  let ourStrength: number | undefined;

  let best: RoomIntelData | null = null;
  let bestHome = freeHomes[0].name;
  let bestRatio = 0;
  for (const rn in Memory.intel) {
    const intel = Memory.intel[rn];
    if (!intel.owner || myNames.has(intel.owner)) continue;
    if (isAllyPlayer(intel.owner)) continue;
    if (onTargetCooldown(wc, rn) || onTargetCooldown(wc, intel.owner)) continue;
    // Outside of declared war, only strike players who have come at us first.
    if (posture !== "WAR" && !wasHostileToUs(wc, intel.owner)) continue;
    const theirStrength = Memory.players?.[intel.owner]?.militaryStrength ?? 0;
    ourStrength ??= ownMilitaryStrength();
    if (theirStrength > ourStrength) continue;
    if (intel.safeMode) continue;
    if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT) continue;
    if (nukeInbound(wc, rn)) continue;

    const home = freeHomes.reduce((b, r) =>
      Game.map.getRoomLinearDistance(r.name, rn) < Game.map.getRoomLinearDistance(b.name, rn) ? r : b
    );
    const dist = Game.map.getRoomLinearDistance(home.name, rn);
    if (dist > AUTO_ATTACK_MAX_RANGE) continue;

    const isFortress = (intel.barrierHpMax ?? 0) > FORTRESS_BARRIER_HP;
    if (isFortress) {
      const homeRoom = Game.rooms[home.name];
      const homeEnergy =
        (homeRoom?.storage?.store[RESOURCE_ENERGY] ?? 0) +
        (homeRoom?.terminal?.store[RESOURCE_ENERGY] ?? 0);
      if (capableHomeCount < 2 && homeEnergy < WAR_ECONOMY_ENERGY) continue;
    }

    const ratio = targetValue(intel) / targetEffort(intel, dist);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = intel;
      bestHome = home.name;
    }
  }

  if (!best) return;

  if (isNukeWorthyFortress(best) && considerAutoNuke(wc, best)) return;

  const fortified = best.towers >= 2 || (best.barrierHpMax ?? 0) > 1_000_000;
  const tactic: SquadTactic = fortified ? "siege" : "assault";
  const comp = recommendComposition(best.roomName, tactic);
  const err = launchOp(best.roomName, "box", tactic, comp, bestHome);
  if (!err) {
    wc.lastAutoAttackTick = Game.time;

    if (empireEconomyHealthy()) {
      if (!Memory.empire) {
        Memory.empire = { posture: posture ?? "EXPAND", updatedAt: Game.time };
      }
      Memory.empire.warTargetRoom = best.roomName;
      Memory.empire.warTargetPlayer = best.owner;
    }
    console.log(
      `[WarCouncil] Auto-launch (${tactic}): ${bestHome} -> ${best.roomName} ` +
        `(value/effort ${bestRatio.toFixed(2)}, owner ${best.owner})`
    );
  }
}

function isNukeWorthyFortress(intel: RoomIntelData): boolean {
  if (!intel.owner) return false;
  if (intel.rcl < NUKE_MIN_RCL) return false;
  if (intel.towers < NUKE_MIN_TOWERS) return false;
  if ((intel.barrierHpMax ?? 0) < NUKE_BARRIER_HP) return false;
  return true;
}

function unpackIntelPos(packed: number, roomName: string): RoomPosition | null {
  const x = Math.floor(packed / 50);
  const y = packed % 50;
  if (x < 0 || x > 49 || y < 0 || y > 49) return null;
  return new RoomPosition(x, y, roomName);
}

function nukeAimPoints(intel: RoomIntelData): RoomPosition[] {
  const packed: number[] = [];
  for (const p of intel.towerPos ?? []) packed.push(p);
  for (const p of intel.spawnPos ?? []) packed.push(p);
  if (packed.length === 0 && intel.controllerPos !== undefined) packed.push(intel.controllerPos);

  const seen = new Set<number>();
  const out: RoomPosition[] = [];
  for (const p of packed) {
    if (seen.has(p)) continue;
    seen.add(p);
    const pos = unpackIntelPos(p, intel.roomName);
    if (pos) out.push(pos);
    if (out.length >= NUKE_MAX_LAUNCH) break;
  }
  return out;
}

function nukeInbound(wc: WarCouncilMemory, roomName: string): boolean {
  const until = wc.nukedUntil?.[roomName];
  return until !== undefined && Game.time < until;
}

function maintainNukedTargets(wc: WarCouncilMemory): void {
  const map = wc.nukedUntil;
  if (!map) return;
  for (const rn in map) {
    if (Game.time >= map[rn]) delete map[rn];
  }
}

function pruneExpired(map: Record<string, number> | undefined, expired: (v: number) => boolean): void {
  if (!map) return;
  for (const k in map) if (expired(map[k])) delete map[k];
}

function considerAutoNuke(wc: WarCouncilMemory, intel: RoomIntelData): boolean {
  try {
    if (nukeInbound(wc, intel.roomName)) return true;
    if (Game.time - (wc.lastAutoNukeTick ?? -AUTO_NUKE_INTERVAL) < AUTO_NUKE_INTERVAL) {
      return false;
    }

    const aimPoints = nukeAimPoints(intel);
    if (aimPoints.length === 0) return false;

    let launched = 0;
    for (const point of aimPoints) {
      if (launched >= NUKE_MAX_LAUNCH) break;
      for (const rn in Game.rooms) {
        const home = Game.rooms[rn];
        if (!home.controller?.my) continue;
        const fireErr = launchNukeFrom(rn, point);
        if (!fireErr) {
          launched++;
          console.log(
            `[WarCouncil] Auto-NUKE: ${rn} -> ${intel.roomName} @${point.x},${point.y} ` +
              `(fortress: ${intel.towers} towers, barrier ${(intel.barrierHpMax ?? 0).toLocaleString()})`
          );
          break;
        }
      }
    }

    if (launched === 0) return false;

    wc.lastAutoNukeTick = Game.time;
    if (!wc.nukedUntil) wc.nukedUntil = {};
    const until = Game.time + Math.max(0, NUKE_LAND_TIME - NUKE_ASSAULT_LEAD);
    wc.nukedUntil[intel.roomName] = until;
    console.log(
      `[WarCouncil] ${intel.roomName}: ${launched} nuke(s) inbound - assault deferred until tick ${until}`
    );
    return true;
  } catch (e) {
    console.log(`[WarCouncil] Auto-nuke skipped (guarded error): ${String(e)}`);
    return false;
  }
}

function empireEconomyHealthy(): boolean {
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller?.my) continue;
    const energy =
      (room.storage?.store[RESOURCE_ENERGY] ?? 0) + (room.terminal?.store[RESOURCE_ENERGY] ?? 0);
    if (energy >= WAR_ECONOMY_ENERGY) return true;
  }
  return false;
}

function wasHostileToUs(wc: WarCouncilMemory, username: string): boolean {
  const seen = wc.hostilePlayers?.[username];
  return seen !== undefined && Game.time - seen <= HOSTILE_MEMORY_TICKS;
}

function maintainWarTarget(): void {
  const empire = Memory.empire;
  const warRoom = empire?.warTargetRoom;
  if (!empire || !warRoom) return;

  const opActive = Memory.militaryOps
    ? Object.values(Memory.militaryOps).some((op) => op.targetRoom === warRoom)
    : false;
  if (opActive) return;

  const room = Game.rooms[warRoom];
  const intel = Memory.intel?.[warRoom];
  const tookIt = room?.controller?.my === true;
  const safeNow = (room?.controller?.safeMode ?? intel?.safeMode) ? true : false;

  if (tookIt || safeNow || !intel) {
    delete empire.warTargetRoom;
    delete empire.warTargetPlayer;
    console.log(`[WarCouncil] War campaign against ${warRoom} ended - clearing war target.`);
  }
}

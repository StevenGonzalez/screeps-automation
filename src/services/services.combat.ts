import { isAlly } from "./services.allies";

export interface ThreatInfo {
  hostiles: Creep[];
  score: number;
}

const BOOST_TIMEOUT = 50;

export function seekBoost(creep: Creep): boolean {
  if (!creep.memory.boostCompound && creep.memory.boostQueue?.length) {
    creep.memory.boostCompound = creep.memory.boostQueue.shift();
    if (creep.memory.boostQueue.length === 0) delete creep.memory.boostQueue;
  }

  const compound = creep.memory.boostCompound as ResourceConstant | undefined;
  if (!compound) return false;

  if ((creep.ticksToLive ?? 0) < 1500 - BOOST_TIMEOUT) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  const ls = creep.room.memory.labSystem;
  if (!ls?.outputLabIds?.length) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  const boostLab = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null)
    .find((l) => (l.store.getUsedCapacity(compound) ?? 0) >= 30);

  if (!boostLab) {
    delete creep.memory.boostCompound;
    delete creep.memory.boostQueue;
    return false;
  }

  if (!creep.pos.isNearTo(boostLab)) {
    creep.moveTo(boostLab, { reusePath: 5 });
  }
  return true;
}

export function advanceBoost(creep: Creep): void {
  if (creep.memory.boostQueue?.length) {
    creep.memory.boostCompound = creep.memory.boostQueue.shift();
    if (creep.memory.boostQueue.length === 0) delete creep.memory.boostQueue;
  } else {
    creep.memory.boosted = true;
    delete creep.memory.boostCompound;
  }
}

export type ThreatSeverity = "none" | "low" | "medium" | "high";

const SEVERITY_MEDIUM = 80;
const SEVERITY_HIGH   = 160;

export function getThreatSeverity(room: Room): ThreatSeverity {
  const { score } = getThreatInfo(room);
  if (score === 0) return "none";
  if (score < SEVERITY_MEDIUM) return "low";
  if (score < SEVERITY_HIGH) return "medium";
  return "high";
}

const ATTACK_BOOST_MULT: Record<string, number> = { UH: 2, UH2O: 3, XUH2O: 4 };
const RANGED_BOOST_MULT: Record<string, number> = { KO: 2, KHO2: 3, XKHO2: 4 };
const HEAL_BOOST_MULT: Record<string, number> = { LO: 2, LHO2: 3, XLHO2: 4 };
const TOUGH_DAMAGE_MULT: Record<string, number> = { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 };
const DISMANTLE_BOOST_MULT: Record<string, number> = { ZH: 2, ZH2O: 3, XZH2O: 4 };

const THREAT_BASE_PER_CREEP = 10;
const DAMAGE_DIVISOR = 30;
const HEAL_WEIGHT = 0.10;
const EHP_DIVISOR = 1000;

let threatCacheTick = -1;
const threatCache: Record<string, ThreatInfo> = {};

function creepThreatScore(c: Creep): number {
  let attackPower = 0;
  let rangedPower = 0;
  let dismantlePower = 0;
  let healPower = 0;
  let effectiveHp = 0;

  for (const part of c.body) {
    if (part.hits <= 0) continue;
    switch (part.type) {
      case ATTACK:
        attackPower += ATTACK_POWER * (part.boost ? ATTACK_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case RANGED_ATTACK:
        rangedPower += RANGED_ATTACK_POWER * (part.boost ? RANGED_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case WORK:
        dismantlePower += DISMANTLE_POWER * (part.boost ? DISMANTLE_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case HEAL:
        healPower += HEAL_POWER * (part.boost ? HEAL_BOOST_MULT[part.boost] ?? 1 : 1);
        effectiveHp += 100;
        break;
      case TOUGH: {
        const dmgMult = part.boost ? TOUGH_DAMAGE_MULT[part.boost] ?? 1 : 1;
        effectiveHp += 100 / dmgMult;
        break;
      }
      default:
        effectiveHp += 100;
        break;
    }
  }

  return (
    THREAT_BASE_PER_CREEP +
    (attackPower + rangedPower + dismantlePower) / DAMAGE_DIVISOR +
    healPower * HEAL_WEIGHT +
    effectiveHp / EHP_DIVISOR
  );
}

export function structureDamagePerTick(hostiles: Creep[]): number {
  let dps = 0;
  for (const c of hostiles) {
    for (const p of c.body) {
      if (p.hits <= 0) continue;
      if (p.type === ATTACK) dps += ATTACK_POWER * (p.boost ? ATTACK_BOOST_MULT[p.boost] ?? 1 : 1);
      else if (p.type === RANGED_ATTACK)
        dps += RANGED_ATTACK_POWER * (p.boost ? RANGED_BOOST_MULT[p.boost] ?? 1 : 1);
      else if (p.type === WORK)
        dps += DISMANTLE_POWER * (p.boost ? DISMANTLE_BOOST_MULT[p.boost] ?? 1 : 1);
    }
  }
  return dps;
}

export function getThreatInfo(room: Room): ThreatInfo {
  if (threatCacheTick !== Game.time) {
    threatCacheTick = Game.time;
    for (const name in threatCache) delete threatCache[name];
  }
  const cached = threatCache[room.name];
  if (cached) return cached;

  const hostiles = room
    .find(FIND_HOSTILE_CREEPS)
    .filter((c) => !isAlly(c.owner?.username));
  let score = 0;
  for (const c of hostiles) {
    score += creepThreatScore(c);
  }

  const info: ThreatInfo = { hostiles, score };
  threatCache[room.name] = info;
  return info;
}

const BLOCKADE_STICKY_TICKS = 1500;
const BLOCKADE_BORDER_BAND = 3;

function isArmedHostile(c: Creep): boolean {
  if (!isPlayerCreep(c)) return false;
  return c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK));
}

function inBorderBandFacingHome(exitDir: string, x: number, y: number): boolean {
  const b = BLOCKADE_BORDER_BAND;
  switch (exitDir) {
    case "1":
      return y >= 49 - b;
    case "5":
      return y <= b;
    case "3":
      return x <= b;
    case "7":
      return x >= 49 - b;
    default:
      return false;
  }
}

function countExitGuards(room: Room): number {
  const exits = Game.map.describeExits(room.name) ?? {};
  let guards = 0;
  for (const dir in exits) {
    const adjName = exits[dir as unknown as keyof ExitsInformation];
    if (!adjName) continue;
    const adj = Game.rooms[adjName];
    if (!adj) continue;
    for (const c of adj.find(FIND_HOSTILE_CREEPS)) {
      if (isArmedHostile(c) && inBorderBandFacingHome(dir, c.pos.x, c.pos.y)) guards++;
    }
  }
  return guards;
}

export function refreshBlockade(room: Room): void {
  const guards = countExitGuards(room);
  const existing = room.memory.blockade;

  if (guards > 0) {
    if (existing) {
      existing.until = Game.time + BLOCKADE_STICKY_TICKS;
      existing.guards = guards;
    } else {
      room.memory.blockade = {
        detectedAt: Game.time,
        until: Game.time + BLOCKADE_STICKY_TICKS,
        guards,
      };
      console.log(
        `[Blockade] ${room.name}: ${guards} hostile(s) camping the exits - suppressing all outbound roles`
      );
    }
    return;
  }

  if (existing && !existing.manual && Game.time >= existing.until) {
    delete room.memory.blockade;
    console.log(`[Blockade] ${room.name}: exits clear - resuming outbound roles`);
  }
}

export function isBlockaded(room: Room): boolean {
  const b = room.memory.blockade;
  if (!b) return false;
  return b.manual === true || Game.time < b.until;
}

function hostileCombatTier(creep: Creep): number {
  const hasHeal = creep.body.some((p) => p.type === HEAL && p.hits > 0);
  if (hasHeal) return 0;
  const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK && p.hits > 0);
  if (hasRanged) return 1;
  const hasAttack = creep.body.some((p) => p.type === ATTACK && p.hits > 0);
  if (hasAttack) return 1;
  const hasWork = creep.body.some((p) => p.type === WORK && p.hits > 0);
  if (hasWork) return 2;
  return 3;
}

export function selectHostileTarget(fromPos: RoomPosition, hostiles: Creep[]): Creep | null {
  if (hostiles.length === 0) return null;

  let best: Creep | null = null;
  let bestScore = Infinity;
  for (const c of hostiles) {
    let tier = hostileCombatTier(c);
    if (c.hits < c.hitsMax * 0.3) tier = Math.max(0, tier - 1);
    const range = fromPos.getRangeTo(c);
    const score = tier * 1_000_000 + range * 1_000 + c.hits;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

const STRUCTURE_ATTACK_PRIORITY: Partial<Record<StructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 10,
  [STRUCTURE_TOWER]: 15,
  [STRUCTURE_NUKER]: 20,
  [STRUCTURE_TERMINAL]: 25,
  [STRUCTURE_LAB]: 30,
  [STRUCTURE_STORAGE]: 35,
  [STRUCTURE_POWER_SPAWN]: 40,
  [STRUCTURE_OBSERVER]: 45,
  [STRUCTURE_EXTENSION]: 60,
  [STRUCTURE_LINK]: 70,
  [STRUCTURE_EXTRACTOR]: 80,
  [STRUCTURE_CONTAINER]: 90,
};

let structureTargetCacheTick = -1;
const structureTargetCache: Record<string, AnyStructure[]> = {};

function getAttackableStructures(room: Room): AnyStructure[] {
  if (structureTargetCacheTick !== Game.time) {
    structureTargetCacheTick = Game.time;
    for (const name in structureTargetCache) delete structureTargetCache[name];
  }
  const cached = structureTargetCache[room.name];
  if (cached) return cached;

  const list = room.find(FIND_STRUCTURES, {
    filter: (s) => {
      if (s.structureType === STRUCTURE_CONTROLLER) return false;
      if (s.structureType === STRUCTURE_KEEPER_LAIR) return false;
      if (s.structureType === STRUCTURE_POWER_BANK) return false;
      if (s.structureType === STRUCTURE_WALL) return true;
      if (s.structureType === STRUCTURE_RAMPART) return (s as StructureRampart).hits > 0;
      const owned = (s as OwnedStructure).owner;
      if (owned) return !(s as OwnedStructure).my;
      return false;
    },
  }) as AnyStructure[];

  structureTargetCache[room.name] = list;
  return list;
}

export function selectStructureTarget(
  room: Room,
  fromPos: RoomPosition,
  tactic: SquadTactic
): AnyStructure | null {
  const all = getAttackableStructures(room);
  if (all.length === 0) return null;

  const priorityOf = (s: AnyStructure): number => {
    if (s.structureType === STRUCTURE_TOWER && tactic === "siege") return 0;
    return STRUCTURE_ATTACK_PRIORITY[s.structureType] ?? 999;
  };

  const valuable = all.filter(
    (s) => s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART
  );

  let chosen: AnyStructure | null = null;
  if (valuable.length > 0) {
    let bestScore = Infinity;
    for (const s of valuable) {
      const score = priorityOf(s) * 10_000 + fromPos.getRangeTo(s);
      if (score < bestScore) {
        bestScore = score;
        chosen = s;
      }
    }
  }

  if (chosen) {
    const shield = chosen.pos
      .lookFor(LOOK_STRUCTURES)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    if (shield && shield.hits > 0) return shield;
    return chosen;
  }

  const barriers = all.filter(
    (s) => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
  );
  if (barriers.length === 0) return null;
  return barriers.reduce((a, b) => (a.hits < b.hits ? a : b));
}

const TOWER_OPTIMAL_RANGE = 5;
const TOWER_FALLOFF_RANGE = 20;
const TOWER_MAX_PENALTY = 40;

function towerDamageFraction(range: number): number {
  if (range <= TOWER_OPTIMAL_RANGE) return 1;
  if (range >= TOWER_FALLOFF_RANGE) return 0.25;
  const span = TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE;
  return 1 - ((range - TOWER_OPTIMAL_RANGE) / span) * 0.75;
}

export function buildTowerCostMatrix(room: Room, towers: StructureTower[]): CostMatrix {
  const matrix = new PathFinder.CostMatrix();

  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      if (matrix.get(s.pos.x, s.pos.y) === 0) matrix.set(s.pos.x, s.pos.y, 1);
    } else if (
      s.structureType === STRUCTURE_RAMPART
        ? !(s as StructureRampart).my
        : (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)
    ) {
      matrix.set(s.pos.x, s.pos.y, 255);
    }
  }

  if (towers.length > 0) {
    for (let x = 1; x < 49; x++) {
      for (let y = 1; y < 49; y++) {
        const base = matrix.get(x, y);
        if (base >= 255) continue;
        let penalty = 0;
        for (const t of towers) {
          const range = Math.max(Math.abs(t.pos.x - x), Math.abs(t.pos.y - y));
          if (range > TOWER_FALLOFF_RANGE) continue;
          penalty += Math.round(TOWER_MAX_PENALTY * towerDamageFraction(range));
        }
        if (penalty > 0) matrix.set(x, y, Math.min(254, (base || 1) + penalty));
      }
    }
  }

  return matrix;
}

export interface BreachPlan {
  focusId: Id<AnyStructure>;
  focusPos: RoomPosition;
  pathBarriers: RoomPosition[];
}

function breachGoal(room: Room): AnyStructure | StructureController | null {
  const spawn = room.find(FIND_HOSTILE_SPAWNS)[0];
  if (spawn) return spawn;
  const target = selectStructureTarget(room, new RoomPosition(25, 25, room.name), "siege");
  if (target && target.structureType !== STRUCTURE_WALL && target.structureType !== STRUCTURE_RAMPART) {
    return target;
  }
  if (room.controller) return room.controller;
  return target;
}

export function planBreach(room: Room, fromPos: RoomPosition): BreachPlan | null {
  const goal = breachGoal(room);
  if (!goal) return null;

  const barrierAt = new Map<number, StructureWall | StructureRampart>();
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
      if ((s as StructureWall | StructureRampart).hits > 0) {
        barrierAt.set(s.pos.x * 50 + s.pos.y, s as StructureWall | StructureRampart);
      }
    }
  }
  if (barrierAt.size === 0) return null;

  const matrix = new PathFinder.CostMatrix();
  for (const [packed, b] of barrierAt) {
    const x = Math.floor(packed / 50);
    const y = packed % 50;
    const cost = Math.min(250, 5 + Math.floor(b.hits / 200_000));
    matrix.set(x, y, cost);
  }

  const result = PathFinder.search(
    fromPos,
    { pos: goal.pos, range: 1 },
    {
      maxRooms: 1,
      plainCost: 2,
      swampCost: 5,
      roomCallback: (rn) => (rn === room.name ? matrix : false),
    }
  );
  if (result.path.length === 0 && !fromPos.isNearTo(goal.pos)) return null;

  const pathBarriers: RoomPosition[] = [];
  let focus: StructureWall | StructureRampart | null = null;
  for (const pos of result.path) {
    const b = barrierAt.get(pos.x * 50 + pos.y);
    if (b) {
      if (!focus) focus = b;
      pathBarriers.push(pos);
    }
  }

  if (!focus) return null;
  return { focusId: focus.id, focusPos: focus.pos, pathBarriers };
}

export interface TowerStatus {
  count: number;
  totalEnergy: number;
  maxEnergy: number;
}

export function assessTowers(room: Room): TowerStatus {
  const towers = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }) as StructureTower[];
  let totalEnergy = 0;
  for (const t of towers) totalEnergy += t.store[RESOURCE_ENERGY];
  return {
    count: towers.length,
    totalEnergy,
    maxEnergy: towers.length * TOWER_CAPACITY,
  };
}

export function towersAreDrained(status: TowerStatus): boolean {
  if (status.count === 0) return true;
  return status.totalEnergy < status.count * TOWER_ENERGY_COST * 10;
}

const FORMATION_LAYOUTS: Record<SquadFormation, Array<[number, number]>> = {
  box: [
    [0, 0], [1, 0], [-1, 0],
    [0, 1], [1, 1], [-1, 1],
    [0, 2], [1, 2], [-1, 2],
  ],
  line: [
    [0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [3, 0], [-3, 0], [4, 0], [-4, 0],
  ],
  wedge: [
    [0, 0], [1, 1], [-1, 1], [2, 2], [-2, 2], [3, 3], [-3, 3], [0, 2], [0, 4],
  ],
  scatter: [
    [0, 0], [2, 0], [-2, 0], [0, 2], [2, 2], [-2, 2], [0, -2], [2, -2], [-2, -2],
  ],
};

export function formationOffset(formation: SquadFormation, slot: number): [number, number] {
  const layout = FORMATION_LAYOUTS[formation] ?? FORMATION_LAYOUTS.box;
  if (slot < layout.length) return layout[slot];
  const extra = slot - layout.length;
  return [extra % 2 === 0 ? 1 : -1, 3 + Math.floor(extra / 2)];
}

export function isSourceKeeperRoom(roomName: string): boolean {
  const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!m) return false;
  const x = parseInt(m[1], 10) % 10;
  const y = parseInt(m[2], 10) % 10;
  const inCluster = x >= 4 && x <= 6 && y >= 4 && y <= 6;
  const isCentre = x === 5 && y === 5;
  return inCluster && !isCentre;
}

export function isSourceKeeper(creep: Creep): boolean {
  return creep.owner?.username === "Source Keeper";
}

export function isInvaderCreep(creep: Creep): boolean {
  return creep.owner?.username === "Invader";
}

export function findInvaderCore(room: Room): StructureInvaderCore | null {
  const cores = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
  });
  return (cores[0] as StructureInvaderCore | undefined) ?? null;
}

export function isPlayerCreep(creep: Creep): boolean {
  const u = creep.owner?.username;
  return u !== undefined && u !== "Source Keeper" && u !== "Invader" && !isAlly(u);
}

export function evaluateRoomThreatLevel(room: Room): number {
  let level = 0;

  if (room.controller?.safeMode) return 10;

  const towers = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_TOWER,
  }).length;
  level += towers * 2;

  const rcl = room.controller?.level ?? 0;
  if (room.controller?.owner) level += Math.min(3, Math.ceil(rcl / 3));

  const { score } = getThreatInfo(room);
  level += Math.min(3, Math.floor(score / 100));

  return Math.min(10, level);
}

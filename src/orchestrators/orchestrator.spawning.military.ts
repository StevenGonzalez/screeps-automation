import {
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_DRAINER,
  ROLE_CONQUEROR,
  ROLE_SETTLER,
  ROLE_UNCLAIMER,
} from "../config/config.roles";
import { getThreatInfo, summarizeHostiles, meleeDefendersToWin, meleeDefendersWin } from "../services/services.combat";
import { castleName, chronicle, tally, wildsName } from "../services/services.chronicle";
import { towersCanHold } from "../roles/role.tower";
import { getDefenseOp, getDefenders, getDrainOpsForHome } from "./orchestrator.military";
import { MAX_BODY_PART_COUNT } from "../config/config.spawning";
import {
  buildScaledBody,
  calculateBodyPartCost,
  getCreepsByRole,
  getCreepsByRoleInRoom,
  getRoomSpawningCount,
  trackedSpawn,
  bodyBudget,
  waitForFullBody,
  buildBoostQueue,
  boostMemory,
} from "./orchestrator.spawning.shared";
import { getPickedRemoteRoomNames, sharedWithBiggerCastle } from "./orchestrator.spawning.remote";

// Damage eats body parts left to right. TOUGH soaks first, then the damage
// parts (ATTACK / RANGED_ATTACK / WORK), then MOVE, then HEAL. Losing MOVE
// early leaves a hurt creep unable to chase, kite or fall back to its healers,
// and a stranded creep is lost with every part it has left; keeping MOVE and
// HEAL to the end lets it limp home and heal.
// One MOVE per other part so a knight keeps full speed off-road: remote
// defence and offensive squads rarely have roads under them.
export function buildKnightBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[ATTACK] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups).fill(ATTACK),
    ...Array(groups * 2).fill(MOVE),
  ] as BodyPartConstant[];
}

export function buildWizardBody(availableEnergy: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[MOVE] + BODYPART_COST[RANGED_ATTACK];
  const maxPairs = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 2),
    Math.floor(availableEnergy / pairCost)
  );
  const pairs = Math.max(1, maxPairs);
  return [
    ...Array(pairs).fill(RANGED_ATTACK),
    ...Array(pairs).fill(MOVE),
  ] as BodyPartConstant[];
}

export function buildClericBody(availableEnergy: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE];
  const maxPairs = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 2),
    Math.floor(availableEnergy / pairCost)
  );
  const pairs = Math.max(1, maxPairs);
  return [
    ...Array(pairs).fill(MOVE),
    ...Array(pairs).fill(HEAL),
  ] as BodyPartConstant[];
}

export function buildDrainerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups * 2).fill(MOVE),
    ...Array(groups).fill(HEAL),
  ] as BodyPartConstant[];
}

export function buildSiegerBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[TOUGH] + 2 * BODYPART_COST[WORK] + 3 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 6),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  return [
    ...Array(groups).fill(TOUGH),
    ...Array(groups * 2).fill(WORK),
    ...Array(groups * 3).fill(MOVE),
  ] as BodyPartConstant[];
}

function countDefendersInRoom(role: string, room: Room): number {
  const present = getCreepsByRoleInRoom(role, room).filter(
    (c) => !c.spawning && !c.memory.offensiveTarget
  ).length;
  return present + getRoomSpawningCount(room, role);
}

// The hostiles are through when nothing can shoot them (no tower with energy)
// or a spawn or tower is already taking hits. Until then the towers and
// ramparts are buying time for a full-size defender.
function isBreached(room: Room): boolean {
  const core = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER,
  }) as (StructureSpawn | StructureTower)[];
  const armed = core.some(
    (s) => s.structureType === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST
  );
  return !armed || core.some((s) => s.hits < s.hitsMax);
}

// Towers that will kill the hostiles on their own need no creeps beside them.
function homeNeedsDefenders(room: Room): boolean {
  return !towersCanHold(room, getThreatInfo(room).hostiles);
}

// Full-size knights it takes to beat the hostiles here, towers aside.
function homeKnightsNeeded(room: Room, cap: number): number {
  const body = buildKnightBody(bodyBudget(room, "capacity"));
  return meleeDefendersToWin(summarizeHostiles(getThreatInfo(room).hostiles), body, cap);
}

// Wait for a full-energy body while the towers and ramparts hold; a breached
// room takes whatever the spawn can build right now.
function waitForDefenderBody(room: Room, key: string, needed: boolean): boolean {
  return waitForFullBody(room, key, needed && !isBreached(room));
}

const HOME_KNIGHT_CAP = 3;

export function shouldSpawnKnight(room: Room, threatScore: number): boolean {
  const target = Math.max(Math.ceil(threatScore / 40), homeKnightsNeeded(room, HOME_KNIGHT_CAP));
  const needed =
    homeNeedsDefenders(room) &&
    countDefendersInRoom(ROLE_KNIGHT, room) < Math.min(HOME_KNIGHT_CAP, target);
  if (waitForDefenderBody(room, ROLE_KNIGHT, needed)) return false;
  return needed;
}

export function spawnKnight(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, 'melee', attackParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_KNIGHT, ...boostMemory(queue) },
  });
  return res === OK;
}

export function shouldSpawnWizard(room: Room, threatScore: number): boolean {
  const needed =
    homeNeedsDefenders(room) &&
    countDefendersInRoom(ROLE_WIZARD, room) < Math.min(2, Math.ceil(threatScore / 60));
  if (waitForDefenderBody(room, ROLE_WIZARD, needed)) return false;
  return needed;
}

export function spawnWizard(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildWizardBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const rangedParts = body.filter((p) => p === RANGED_ATTACK).length;
  const queue = buildBoostQueue(room, 'ranged', rangedParts, 0);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_WIZARD, ...boostMemory(queue) },
  });
  return res === OK;
}

export function shouldSpawnCleric(room: Room, threatScore: number): boolean {
  if (threatScore < 100) return false;
  const fighters =
    countDefendersInRoom(ROLE_KNIGHT, room) + countDefendersInRoom(ROLE_WIZARD, room);
  if (fighters === 0) return false;
  const needed = homeNeedsDefenders(room) && countDefendersInRoom(ROLE_CLERIC, room) < 1;
  if (waitForDefenderBody(room, ROLE_CLERIC, needed)) return false;
  return needed;
}

export function spawnCleric(room: Room, spawn: StructureSpawn): boolean {
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildClericBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, 'healer', healParts, 0);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_CLERIC, ...boostMemory(queue) },
  });
  return res === OK;
}

export function shouldSpawnConqueror(): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "claiming") return false;
  return !getCreepsByRole(ROLE_CONQUEROR).some(
    (c) => c.memory.targetRoom === exp.roomName
  );
}

export function spawnConqueror(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const body: BodyPartConstant[] = [CLAIM, MOVE, MOVE, MOVE, MOVE];
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_CONQUEROR,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  if (res !== OK) return false;
  chronicle(`A conqueror rides out from ${castleName(room.name)} for the ${wildsName(exp.roomName)}.`);
  return true;
}

// Spawn the next unclaimer this long before the controller accepts another
// attack, to cover spawning and the walk over.
const UNCLAIMER_LEAD = 400;

export function findUnclaimTarget(room: Room): string | null {
  const targets = Memory.unclaimTargets;
  if (!targets) return null;
  for (const name in targets) {
    const t = targets[name];
    if (t.until <= Game.time) {
      delete targets[name];
      continue;
    }
    if (t.homeRoom !== room.name) continue;
    if ((t.blockedUntil ?? 0) - UNCLAIMER_LEAD > Game.time) continue;
    if (getCreepsByRole(ROLE_UNCLAIMER).some((c) => c.memory.targetRoom === name)) continue;
    return name;
  }
  return null;
}

export function buildUnclaimerBody(capacity: number): BodyPartConstant[] {
  const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  const pairs = Math.max(1, Math.min(Math.floor(MAX_BODY_PART_COUNT / 2), Math.floor(capacity / pairCost)));
  return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)] as BodyPartConstant[];
}

export function spawnUnclaimer(room: Room, spawn: StructureSpawn): boolean {
  const target = findUnclaimTarget(room);
  if (!target) return false;
  const body = buildUnclaimerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_UNCLAIMER, homeRoom: room.name, targetRoom: target },
  });
  return res === OK;
}

const MAX_SETTLERS = 3;
// Settlers sent while the last one is younger than this share one chronicle
// line; a settler lives 1500 ticks, so its replacement still counts.
const PILGRIM_WINDOW = 2000;

export function shouldSpawnSettler(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp || exp.phase !== "bootstrapping" || exp.homeRoom !== room.name) return false;

  if (exp.pausedUntil && exp.pausedUntil > Game.time) return false;

  const settlers = getCreepsByRole(ROLE_SETTLER).filter(
    (c) => c.memory.targetRoom === exp.roomName
  );
  const needed = settlers.length < MAX_SETTLERS;
  if (waitForFullBody(room, ROLE_SETTLER, needed)) return false;
  return needed;
}

export function spawnSettler(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildScaledBody(ROLE_SETTLER, allowedEnergy);
  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_SETTLER,
      homeRoom: room.name,
      targetRoom: exp.roomName,
    },
  });
  if (res !== OK) return false;
  const keep = castleName(exp.roomName);
  tally(
    `pilgrims:${exp.roomName}`,
    1,
    (n) => `${n === 1 ? "A pilgrim has" : `${n} pilgrims have`} set out from ${castleName(room.name)} to raise the keep of ${keep}.`,
    PILGRIM_WINDOW
  );
  return true;
}

function getOffensiveSquadMembers(op: MilitaryOp): Creep[] {
  return Object.values(Game.creeps).filter(
    (c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom
  );
}

function getOffensiveOpForRoom(room: Room): MilitaryOp | undefined {
  return Memory.militaryOps?.[room.name];
}

export function shouldSpawnOffensiveCreep(room: Room): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op || op.phase !== "forming") return false;
  const members = getOffensiveSquadMembers(op);
  return (
    members.filter((c) => c.memory.role === ROLE_KNIGHT).length < op.requiredMelee ||
    members.filter((c) => c.memory.role === ROLE_WIZARD).length < op.requiredRanged ||
    members.filter((c) => c.memory.role === ROLE_CLERIC).length < op.requiredHealers ||
    members.filter((c) => c.memory.role === ROLE_SIEGER).length < (op.requiredSiege ?? 0) ||
    members.filter((c) => c.memory.role === ROLE_DRAINER).length < (op.requiredDrainers ?? 0)
  );
}

function countDrainLeeches(targetRoom: string, homeRoom: string): number {
  return Object.values(Game.creeps).filter(
    (c) =>
      c.memory.role === ROLE_DRAINER &&
      c.memory.offensiveTarget === targetRoom &&
      c.memory.homeRoom === homeRoom
  ).length;
}

function firstUnderStrengthDrain(room: Room): DrainOp | null {
  for (const op of getDrainOpsForHome(room.name)) {
    if (countDrainLeeches(op.targetRoom, op.homeRoom) < op.drainers) return op;
  }
  return null;
}

export function shouldSpawnDrainLeech(room: Room): boolean {
  return firstUnderStrengthDrain(room) !== null;
}

export function spawnDrainLeech(room: Room, spawn: StructureSpawn): boolean {
  const op = firstUnderStrengthDrain(room);
  if (!op) return false;

  const body = buildDrainerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const healParts = body.filter((p) => p === HEAL).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const queue = buildBoostQueue(room, "drainer", healParts, toughParts);

  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_DRAINER,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...boostMemory(queue),
    },
  });
  if (res === OK) console.log(`[Drain] Spawning ${ROLE_DRAINER}: ${room.name} -> ${op.targetRoom}`);
  return res === OK;
}

export function spawnNextOffensiveCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getOffensiveOpForRoom(room);
  if (!op) return false;

  const members = getOffensiveSquadMembers(op);
  const melee = members.filter((c) => c.memory.role === ROLE_KNIGHT).length;
  const ranged = members.filter((c) => c.memory.role === ROLE_WIZARD).length;
  const healers = members.filter((c) => c.memory.role === ROLE_CLERIC).length;
  const siege = members.filter((c) => c.memory.role === ROLE_SIEGER).length;
  const drainers = members.filter((c) => c.memory.role === ROLE_DRAINER).length;

  let roleToSpawn: string | null = null;
  if (melee < op.requiredMelee) roleToSpawn = ROLE_KNIGHT;
  else if (drainers < (op.requiredDrainers ?? 0)) roleToSpawn = ROLE_DRAINER;
  else if (siege < (op.requiredSiege ?? 0)) roleToSpawn = ROLE_SIEGER;
  else if (ranged < op.requiredRanged) roleToSpawn = ROLE_WIZARD;
  else if (healers < op.requiredHealers) roleToSpawn = ROLE_CLERIC;
  if (!roleToSpawn) return false;

  const energy = room.energyCapacityAvailable;
  let body: BodyPartConstant[];
  let boostKey: string;
  let combatPartType: BodyPartConstant;

  if (roleToSpawn === ROLE_KNIGHT) {
    body = buildKnightBody(energy);
    boostKey = "melee";
    combatPartType = ATTACK;
  } else if (roleToSpawn === ROLE_SIEGER) {
    body = buildSiegerBody(energy);
    boostKey = "siege";
    combatPartType = WORK;
  } else if (roleToSpawn === ROLE_WIZARD) {
    body = buildWizardBody(energy);
    boostKey = "ranged";
    combatPartType = RANGED_ATTACK;
  } else if (roleToSpawn === ROLE_DRAINER) {
    body = buildDrainerBody(energy);
    boostKey = "drainer";
    combatPartType = HEAL;
  } else {
    body = buildClericBody(energy);
    boostKey = "healer";
    combatPartType = HEAL;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts =
    boostKey === "melee" || boostKey === "siege"
      ? body.filter((p) => p === MOVE).length
      : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);

  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      offensiveTarget: op.targetRoom,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Military] Spawning offensive ${roleToSpawn} for ${op.targetRoom}`);
  }
  return res === OK;
}

// Op defenders for targetRoom. When the op defends the home itself, the
// ad-hoc home defenders already standing there (spawnKnight and friends, which
// carry no target) count too, or the op would spawn its full count beside them.
function countDefendersByRole(targetRoom: string, role: string, homeRoom: Room): number {
  const live = getDefenders(targetRoom).filter(
    (c) => !c.spawning && c.memory.role === role
  ).length;
  const adHoc =
    targetRoom === homeRoom.name
      ? getCreepsByRoleInRoom(role, homeRoom).filter(
          (c) =>
            !c.spawning &&
            !c.memory.defensiveTarget &&
            !c.memory.offensiveTarget &&
            !c.memory.targetRoom
        ).length
      : 0;
  return live + adHoc + getRoomSpawningCount(homeRoom, role);
}

function needsChildRoomDefender(room: Room): boolean {
  const exp = Memory.expansion;
  if (!exp?.needsDefender || exp.homeRoom !== room.name) return false;
  const existing = getCreepsByRole(ROLE_KNIGHT).filter(
    (c) => c.memory.targetRoom === exp.roomName && c.memory.homeRoom === room.name
  );
  return existing.length === 0;
}

const DEFENSE_OP_KNIGHT_CAP = 6;

// The op's score-based count, raised to what it takes to beat the hostiles'
// healing and hit points.
function requiredOpMelee(room: Room, op: DefenseOp): number {
  return Math.max(op.requiredMelee, homeKnightsNeeded(room, DEFENSE_OP_KNIGHT_CAP));
}

const DEFENSE_OP_BODY_WAIT = "defenseOp";

export function shouldSpawnDefender(room: Room): boolean {
  if (needsChildRoomDefender(room)) return true;

  const op = getDefenseOp(room.name);
  if (!op) return false;
  const short =
    countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op) ||
    countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged ||
    countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers;
  if (waitForDefenderBody(room, DEFENSE_OP_BODY_WAIT, short)) return false;
  return short;
}

export function spawnNextDefender(room: Room, spawn: StructureSpawn): boolean {
  if (needsChildRoomDefender(room)) {
    return spawnChildRoomDefender(room, spawn);
  }

  const op = getDefenseOp(room.name);
  if (!op) return false;

  let roleToSpawn: string | null = null;
  let combatPartType: BodyPartConstant = ATTACK;
  let boostKey = "melee";
  let body: BodyPartConstant[];

  // shouldSpawnDefender already waited for a full body unless the room is breached.
  const allowedEnergy = bodyBudget(room, "available");

  if (countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op)) {
    roleToSpawn = ROLE_KNIGHT;
    combatPartType = ATTACK;
    boostKey = "melee";
    body = buildKnightBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged) {
    roleToSpawn = ROLE_WIZARD;
    combatPartType = RANGED_ATTACK;
    boostKey = "ranged";
    body = buildWizardBody(allowedEnergy);
  } else if (countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers) {
    roleToSpawn = ROLE_CLERIC;
    combatPartType = HEAL;
    boostKey = "healer";
    body = buildClericBody(allowedEnergy);
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const combatParts = body.filter((p) => p === combatPartType).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = boostKey === "melee" ? body.filter((p) => p === MOVE).length : 0;
  const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      defensiveTarget: room.name,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Defense] Spawning defensive ${roleToSpawn} for ${room.name}`);
  }
  return res === OK;
}

function spawnChildRoomDefender(room: Room, spawn: StructureSpawn): boolean {
  const exp = Memory.expansion;
  if (!exp) return false;
  const allowedEnergy = bodyBudget(room, "available");
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const attackParts = body.filter((p) => p === ATTACK).length;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "melee", attackParts, toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_KNIGHT,
      homeRoom: room.name,
      targetRoom: exp.roomName,
      ...boostMemory(queue),
    },
  });
  if (res === OK) {
    console.log(`[Defense] Spawning child-room defender for ${exp.roomName}`);
  }
  return res === OK;
}

const REMOTE_KNIGHT_CAP = 2;

// One knight unless the last look at the remote showed a force (healers, a
// group, a 100k-hit core) that one full-size knight cannot beat in good time.
// Infinity when REMOTE_KNIGHT_CAP of them could not beat it either: no knight
// is raised to die for nothing, and the vendors keep off the road until the
// raiders are gone.
function remoteKnightsNeeded(room: Room, remote: RemoteRoomData): number {
  if (!remote.invaderStrength) return 1;
  const body = buildKnightBody(bodyBudget(room, "capacity"));
  const n = meleeDefendersToWin(remote.invaderStrength, body, REMOTE_KNIGHT_CAP);
  return meleeDefendersWin(remote.invaderStrength, body, n) ? n : Infinity;
}

// A lone knight is raised only as big as the raid it rides against, taken at
// REMOTE_KNIGHT_MARGIN times its last-seen strength. Every remote knight was a
// full body: Dragon Knight Sybil, 48 parts, took 144 ticks to raise after a
// wait for a full purse, while a single ten-part raider of Zagra One-Eye's cut
// down four vendors in the Crow Glen. Sixteen parts would have beaten it.
// Null when the raid wants the biggest knight the castle can raise.
const REMOTE_KNIGHT_MARGIN = 2;

function remoteKnightBody(room: Room, roomName: string): BodyPartConstant[] | null {
  const remote = room.memory.remoteRooms?.find((r) => r.roomName === roomName);
  const s = remote?.invaderStrength;
  if (!s) return null;
  const enemy = {
    heal: s.heal * REMOTE_KNIGHT_MARGIN,
    damage: s.damage * REMOTE_KNIGHT_MARGIN,
    hits: s.hits * REMOTE_KNIGHT_MARGIN,
  };
  const groupCost = calculateBodyPartCost([TOUGH, ATTACK, MOVE, MOVE]);
  const full = buildKnightBody(bodyBudget(room, "capacity")).length / 4;
  for (let groups = 1; groups < full; groups++) {
    const body = buildKnightBody(groups * groupCost);
    if (meleeDefendersWin(enemy, body, 1)) return body;
  }
  return null;
}

const attackParts = (body: BodyPartConstant[]) => body.filter((p) => p === ATTACK).length;

function remoteKnights(homeName: string, roomName: string): Creep[] {
  return getCreepsByRole(ROLE_KNIGHT).filter((c) => c.memory.homeRoom === homeName && c.memory.targetRoom === roomName);
}

// Whether a castle's knights for a remote beat its raiders side by side, by
// the parts they have left. Counting heads took every knight for the biggest
// the castle can raise, but one raised after the wait for a full purse ran
// out is smaller: it rode out alone against raiders a full knight would beat
// and it could not, and no second knight was raised to ride with it.
function remoteKnightsWin(remote: RemoteRoomData, knights: Creep[]): boolean {
  if (!remote.invaderStrength) return knights.length > 0;
  const parts: BodyPartConstant[] = [];
  for (const c of knights) for (const p of c.body) if (p.hits > 0) parts.push(p.type);
  return meleeDefendersWin(remote.invaderStrength, parts, 1);
}

// Knights raised for one remote ride out together. Each used to set out the
// moment it left the spawn, and alone could not out-hit the healers of the
// Misty Thicket's raiders: Rohese, then Agnes, fell one after the other where
// the two side by side would have won.
export function awaitingRemoteKnights(creep: Creep): boolean {
  const homeName = creep.memory.homeRoom ?? "";
  const remote = Memory.rooms[homeName]?.remoteRooms?.find((r) => r.roomName === creep.memory.targetRoom);
  if (!remote?.invaderStrength) return false;
  const others = remoteKnights(homeName, remote.roomName).filter((c) => c !== creep && !c.spawning);
  return !remoteKnightsWin(remote, [creep, ...others]);
}

function findRemoteInvaderTarget(room: Room): string | null {
  // Below level 3 a castle sends no vendors out, so no remote earns it a
  // thing. Thornbarrow, at level 2, raised a knight it could ill afford for a
  // remote only Embercrag mines.
  if ((room.controller?.level ?? 0) < 3) return null;
  const remotes = room.memory.remoteRooms;
  if (!remotes) return null;
  // Only remotes this home works are worth a knight; the rest earn nothing.
  const worked = getPickedRemoteRoomNames(room);
  for (const r of remotes) {
    if (r.invaderUntil === undefined || r.invaderUntil <= Game.time) continue;
    if (!worked.has(r.roomName) || sharedWithBiggerCastle(room, r.roomName)) continue;
    if (remoteKnightsNeeded(room, r) > REMOTE_KNIGHT_CAP) continue;
    const knights = remoteKnights(room.name, r.roomName);
    if (knights.length < REMOTE_KNIGHT_CAP && !remoteKnightsWin(r, knights)) return r.roomName;
  }
  return null;
}

// A knight with less life than this left is not sent to a new remote: it
// would die on the road and, counted as that remote's defender, hold back the
// knight raised in its place.
const REMOTE_KNIGHT_MIN_TTL = 150;

// A remote knight standing watch at home, its own remote clear, rides out for
// another remote its castle works that raiders hold. Each knight was tied to
// the remote it was raised for, so a raid on another raised a second knight
// while the first stood idle behind the walls for the rest of its life.
export function sendIdleRemoteKnights(room: Room): void {
  const remotes = room.memory.remoteRooms;
  if (!remotes?.some((r) => (r.invaderUntil ?? 0) > Game.time)) return;
  const raided = (name: string) => (remotes.find((r) => r.roomName === name)?.invaderUntil ?? 0) > Game.time;
  for (const knight of getCreepsByRole(ROLE_KNIGHT)) {
    const m = knight.memory;
    if (m.homeRoom !== room.name || !m.targetRoom || m.offensiveTarget || m.defensiveTarget) continue;
    if (raided(m.targetRoom) || (knight.ticksToLive ?? 0) < REMOTE_KNIGHT_MIN_TTL) continue;
    const target = findRemoteInvaderTarget(room);
    if (!target) return;
    // A knight raised for a lesser raid is left at home, so as not to stand
    // in the way of the knight this raid calls for.
    const wanted = remoteKnightBody(room, target) ?? buildKnightBody(bodyBudget(room, "capacity"));
    if (attackParts(knight.body.map((b) => b.type)) < attackParts(wanted)) continue;
    m.targetRoom = target;
  }
}

const REMOTE_DEFENDER_BODY_WAIT = "remoteDefender";

// Nothing at home is at stake, so the defender waits for a full body, unless
// the raid wants a smaller knight than that and the purse already covers it.
export function shouldSpawnRemoteDefender(room: Room): boolean {
  const target = findRemoteInvaderTarget(room);
  const sized = target ? remoteKnightBody(room, target) : null;
  const ready = !!sized && room.energyAvailable >= calculateBodyPartCost(sized);
  if (waitForFullBody(room, REMOTE_DEFENDER_BODY_WAIT, target !== null && !ready)) return false;
  return target !== null;
}

export function spawnRemoteDefender(room: Room, spawn: StructureSpawn): boolean {
  const target = findRemoteInvaderTarget(room);
  if (!target) return false;
  const sized = remoteKnightBody(room, target);
  const allowedEnergy = Math.min(bodyBudget(room, "available"), sized ? calculateBodyPartCost(sized) : Infinity);
  const body = buildKnightBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const toughParts = body.filter((p) => p === TOUGH).length;
  const moveParts = body.filter((p) => p === MOVE).length;
  const queue = buildBoostQueue(room, "melee", attackParts(body), toughParts, moveParts);
  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: ROLE_KNIGHT,
      homeRoom: room.name,
      targetRoom: target,
      ...boostMemory(queue),
    },
  });
  if (res === OK) console.log(`[Defense] Spawning remote defender for ${target}`);
  return res === OK;
}

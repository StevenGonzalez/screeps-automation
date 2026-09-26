import {
  getThreatInfo,
  getThreatSeverity,
  selectHostileTarget,
  preferMassAttack,
  isPlayerCreep,
  canDealDamage,
  allyInMassAttackRange,
} from "../services/services.combat";
import { towersCanHold } from "../roles/role.tower";
import { getAllies, requestHelp } from "../services/services.allies";

export const KITE_RANGE = 3;

const DEFENSE_THREAT_SCORE = 150;

const DEFENSE_SCAN_INTERVAL = 2;

const DEFENSE_CLEAR_TICKS = 25;

const DEFENSE_HOLD_RADIUS = 6;

const DEFENSE_CHASE_RADIUS = 12;

let rampartCacheTick = -1;

const defensiveRampartCache: Record<string, StructureRampart[]> = {};

// Remembers which players have sent armed creeps into our rooms or remotes.
function recordHostilePlayers(hostiles: Creep[], ownRoom: boolean): void {
  const wc = Memory.warCouncil;
  if (!wc) return;
  for (const c of hostiles) {
    if (!isPlayerCreep(c)) continue;
    const armed = c.body.some(
      (p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === CLAIM)
    );
    if (!armed && !(ownRoom && canDealDamage(c))) continue;
    if (!wc.hostilePlayers) wc.hostilePlayers = {};
    wc.hostilePlayers[c.owner.username] = Game.time;
  }
}

export function runDefenseCouncil(): void {
  if (Game.time % DEFENSE_SCAN_INTERVAL !== 0) return;
  if (!Memory.defenseOps) Memory.defenseOps = {};
  const ops = Memory.defenseOps;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    const { score, hostiles } = getThreatInfo(room);
    const severity = getThreatSeverity(room);
    const existing = ops[roomName];
    recordHostilePlayers(hostiles, true);
    for (const remote of room.memory.remoteRooms ?? []) {
      const r = Game.rooms[remote.roomName];
      if (r) recordHostilePlayers(getThreatInfo(r).hostiles, false);
    }

    const controllerAttacker = hostiles.some((c) => c.body.some((p) => p.type === CLAIM));

    // Towers that will kill the lot on their own need no creeps beside them.
    const meaningful =
      (severity === "high" || score >= DEFENSE_THREAT_SCORE || controllerAttacker) &&
      !towersCanHold(room, hostiles);

    if (meaningful) {
      if (existing) {
        existing.lastThreatTick = Game.time;
        existing.threatScore = score;
        Object.assign(existing, recommendDefense(score));
      } else {
        ops[roomName] = {
          room: roomName,
          startedAt: Game.time,
          lastThreatTick: Game.time,
          threatScore: score,
          ...recommendDefense(score),
        };
        console.log(`[Defense] ${roomName}: threat detected (score ${score}) - raising defenders`);
      }
    } else if (existing && Game.time - existing.lastThreatTick >= DEFENSE_CLEAR_TICKS) {
      console.log(`[Defense] ${roomName}: threat cleared - standing down defenders`);
      clearDefenseOp(roomName);
    }
  }

  for (const roomName in ops) {
    const room = Game.rooms[roomName];
    if (room?.controller?.my) continue;
    if (!room && Game.time - ops[roomName].lastThreatTick < DEFENSE_CLEAR_TICKS) continue;
    clearDefenseOp(roomName);
  }
}

// Ask allies for help every tick a room is under a defense-op-sized threat.
// runAllies publishes these at the start of next tick.
export function requestAllyDefense(): void {
  const ops = Memory.defenseOps;
  if (!ops || getAllies().length === 0) return;
  for (const roomName in ops) {
    const op = ops[roomName];
    if (op.threatScore < DEFENSE_THREAT_SCORE) continue;
    if (Game.time - op.lastThreatTick > DEFENSE_SCAN_INTERVAL) continue;
    requestHelp({
      type: "defense",
      roomName,
      priority: Math.min(1, op.threatScore / (DEFENSE_THREAT_SCORE * 4)),
    });
  }
}

function recommendDefense(score: number): {
  requiredMelee: number;
  requiredRanged: number;
  requiredHealers: number;
} {
  const requiredMelee = Math.max(1, Math.min(6, 2 + Math.floor((score - DEFENSE_THREAT_SCORE) / 70)));
  const requiredHealers = Math.max(0, Math.min(3, 1 + Math.floor((score - DEFENSE_THREAT_SCORE) / 110)));
  const requiredRanged =
    score >= DEFENSE_THREAT_SCORE + 60
      ? Math.min(2, 1 + Math.floor((score - DEFENSE_THREAT_SCORE - 60) / 150))
      : 0;
  return { requiredMelee, requiredRanged, requiredHealers };
}

function clearDefenseOp(roomName: string): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.defensiveTarget === roomName) delete creep.memory.defensiveTarget;
  }
  if (Memory.defenseOps) delete Memory.defenseOps[roomName];
}

export function getDefenseOp(roomName: string): DefenseOp | undefined {
  return Memory.defenseOps?.[roomName];
}

export function getDefenders(roomName: string): Creep[] {
  return Object.values(Game.creeps).filter((c) => c.memory.defensiveTarget === roomName);
}

function defenseRallyPoint(roomName: string): RoomPosition {
  const room = Game.rooms[roomName];
  const spawn = room?.find(FIND_MY_SPAWNS)[0];
  if (spawn) return spawn.pos;
  return new RoomPosition(25, 25, roomName);
}

function isNearEdge(pos: RoomPosition): boolean {
  return pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48;
}

// The creep the towers last fired on, if it's within this creep's reach.
export function towerFocus(creep: Creep, hostiles: Creep[], reach: number): Creep | null {
  if (!creep.room.controller?.my) return null;
  const id = creep.room.memory?.lastTowerTargetId;
  if (!id) return null;
  const focus = hostiles.find((h) => h.id === id);
  return focus && creep.pos.getRangeTo(focus) <= reach ? focus : null;
}

function selectDefenseTarget(
  creep: Creep,
  rally: RoomPosition,
  hostiles: Creep[],
  reach: number
): Creep | null {
  const focus = towerFocus(creep, hostiles, reach);
  if (focus) return focus;
  const engageable = hostiles.filter(
    (h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS
  );
  const target = selectHostileTarget(creep.pos, engageable);
  if (target) return target;
  return creep.pos.findInRange(hostiles, 1)[0] ?? null;
}

function defenseMoveToward(creep: Creep, rally: RoomPosition, target: Creep, range: number): void {
  const toTarget = creep.pos.getRangeTo(target);
  if (toTarget <= range) {
    if (isNearEdge(creep.pos)) creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
    return;
  }
  if (rally.getRangeTo(target) > DEFENSE_CHASE_RADIUS) {
    defenseHold(creep, rally);
    return;
  }
  creep.moveTo(target, { range, reusePath: 1 });
}

function defenseHold(creep: Creep, rally: RoomPosition): void {
  if (creep.pos.getRangeTo(rally) > DEFENSE_HOLD_RADIUS || isNearEdge(creep.pos)) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
  }
}

function getDefensiveRamparts(room: Room): StructureRampart[] {
  if (rampartCacheTick !== Game.time) {
    rampartCacheTick = Game.time;
    for (const k in defensiveRampartCache) delete defensiveRampartCache[k];
  }
  if (!defensiveRampartCache[room.name]) {
    const terrain = room.getTerrain();
    defensiveRampartCache[room.name] = room.find(FIND_MY_STRUCTURES, {
      filter: (s): s is StructureRampart =>
        s.structureType === STRUCTURE_RAMPART &&
        !isNearEdge(s.pos) &&
        terrain.get(s.pos.x, s.pos.y) !== TERRAIN_MASK_WALL,
    }) as StructureRampart[];
  }
  return defensiveRampartCache[room.name];
}

function rampartIsStandable(rampart: StructureRampart, self: Creep): boolean {
  const blocked = rampart.pos
    .lookFor(LOOK_STRUCTURES)
    .some(
      (s) =>
        s.structureType !== STRUCTURE_RAMPART &&
        (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)
    );
  if (blocked) return false;
  return !rampart.pos.lookFor(LOOK_CREEPS).some((c) => c.name !== self.name);
}

function isOnRampart(creep: Creep): boolean {
  return creep.pos
    .lookFor(LOOK_STRUCTURES)
    .some((s) => s.structureType === STRUCTURE_RAMPART);
}

function anchorOnRampart(creep: Creep, anchorPos: RoomPosition, range: number): boolean {
  const ramparts = getDefensiveRamparts(creep.room);
  if (ramparts.length === 0) return false;

  if (isOnRampart(creep) && creep.pos.getRangeTo(anchorPos) <= range) return true;

  let best: StructureRampart | null = null;
  let bestDist = Infinity;
  for (const r of ramparts) {
    if (!rampartIsStandable(r, creep)) continue;
    const d = r.pos.getRangeTo(anchorPos);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  if (!best) return isOnRampart(creep);
  if (range > 0 && bestDist > range) return false;
  if (!creep.pos.isEqualTo(best.pos)) creep.moveTo(best, { range: 0, reusePath: 5 });
  return true;
}

function isBreaching(room: Room, hostile: Creep): boolean {
  return room
    .find(FIND_MY_STRUCTURES)
    .some((s) => s.structureType !== STRUCTURE_RAMPART && hostile.pos.getRangeTo(s) <= 1);
}

export function runDefensiveKnight(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);
  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const { hostiles } = getThreatInfo(creep.room);
  const target = selectDefenseTarget(creep, rally, hostiles, 1);
  if (target) {
    meleeStrike(creep, target, hostiles);
    if (!anchorOnRampart(creep, target.pos, 1)) {
      // No rampart next to the target. Only leave cover for an attacker already
      // at work on our base (a breach); one outside the wall is bait.
      if (getDefensiveRamparts(creep.room).length === 0 || isBreaching(creep.room, target)) {
        defenseMoveToward(creep, rally, target, 1);
      } else {
        anchorOnRampart(creep, target.pos, 0);
      }
    }
    return;
  }
  if (!anchorOnRampart(creep, rally, 0)) defenseHold(creep, rally);
}

export function runDefensiveWizard(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);
  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const { hostiles } = getThreatInfo(creep.room);

  rangedStrike(creep, selectDefenseTarget(creep, rally, hostiles, KITE_RANGE), hostiles);

  const nearest = creep.pos.findClosestByRange(
    hostiles.filter((h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS)
  );
  if (nearest) {
    if (anchorOnRampart(creep, nearest.pos, 3)) return;
    const range = creep.pos.getRangeTo(nearest);
    if (range < KITE_RANGE) {
      fleeFrom(creep, nearest.pos);
    } else if (range > KITE_RANGE) {
      defenseMoveToward(creep, rally, nearest, KITE_RANGE);
    } else if (isNearEdge(creep.pos)) {
      defenseHold(creep, rally);
    }
    return;
  }
  if (!anchorOnRampart(creep, rally, 0)) defenseHold(creep, rally);
}

export function runDefensiveCleric(creep: Creep, roomName: string): void {
  const rally = defenseRallyPoint(roomName);

  const allies = getDefenders(roomName).filter((c) => c.room.name === creep.room.name);
  const wounded = allies.filter((c) => c.hits < c.hitsMax);
  let healTarget: Creep | null = null;
  if (wounded.length > 0) {
    healTarget = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
    const range = creep.pos.getRangeTo(healTarget);
    if (range <= 1) creep.heal(healTarget);
    else if (range <= 3) creep.rangedHeal(healTarget);
  } else if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
  }

  if (creep.room.name !== roomName) {
    creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
    return;
  }

  const anchorPos = healTarget ? healTarget.pos : rally;
  if (anchorOnRampart(creep, anchorPos, 3)) return;
  if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && !isNearEdge(healTarget.pos)) {
    creep.moveTo(healTarget, { range: 1, reusePath: 1 });
    return;
  }
  defenseHold(creep, rally);
}

export function meleeStrike(creep: Creep, preferred: Creep, hostiles: Creep[]): void {
  if (creep.pos.isNearTo(preferred)) {
    creep.attack(preferred);
    return;
  }
  const fallback = selectHostileTarget(creep.pos, creep.pos.findInRange(hostiles, 1));
  if (fallback) creep.attack(fallback);
}

export function rangedStrike(creep: Creep, preferred: Creep | null, hostiles: Creep[]): boolean {
  const inRange = creep.pos.findInRange(hostiles, KITE_RANGE);
  if (inRange.length === 0) return false;
  if (preferMassAttack(creep.pos, inRange) && !allyInMassAttackRange(creep.pos)) {
    creep.rangedMassAttack();
    return true;
  }
  const target =
    preferred && creep.pos.getRangeTo(preferred) <= KITE_RANGE
      ? preferred
      : selectHostileTarget(creep.pos, inRange);
  if (target) creep.rangedAttack(target);
  return true;
}

export function fleeFrom(creep: Creep, threat: RoomPosition): void {
  const result = PathFinder.search(
    creep.pos,
    { pos: threat, range: KITE_RANGE + 1 },
    { flee: true, maxRooms: 1, plainCost: 2, swampCost: 5 }
  );
  if (result.path.length > 0) {
    creep.move(creep.pos.getDirectionTo(result.path[0]));
  } else {
    creep.move(threat.getDirectionTo(creep.pos));
  }
}
